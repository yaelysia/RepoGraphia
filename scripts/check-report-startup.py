"""Cross-platform offline startup, CRLF regression and CSP rejection checks."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--chromium')
parser.add_argument('--set-content', action='store_true', help='Only for hosts blocking file:// navigation')
args = parser.parse_args()
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
    for name in ['lf', 'crlf', 'cr', 'mixed', 'wrong-hash', 'tampered']:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors, console_errors, requests = [], [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('request', lambda r: requests.append(r.url) if not r.url.startswith('file:') else None)
        file = (args.directory / (name + '.html')).resolve()
        if args.set_content:
            # Preserve file bytes: read_text() masks the CRLF/hash regression.
            page.set_content(file.read_bytes().decode('utf-8'), wait_until='load')
        else:
            page.goto(file.as_uri(), wait_until='load')
        if name in ['wrong-hash', 'tampered']:
            assert page.locator('#project-name').inner_text() == '', name
            assert page.locator('#project-map .project-node').count() == 0, name
            assert page.locator('#viewer-startup').is_visible(), name
            assert any('Content Security Policy' in e for e in console_errors), console_errors
            assert page.evaluate('globalThis.reportTampered') is None
        else:
            assert page.locator('#project-name').inner_text() == 'newline-fixture', name
            assert page.locator('#project-map .project-node').count() == 2, name
            assert page.locator('#viewer-startup').count() == 0, name
            assert page.locator('#metrics .metric').count() == 4, name
            page.locator('#files-tab').click()
            assert page.locator('.node-row').count() == 2, name
            page.locator('.node-row').first.click()
            page.locator('#symbols-tab').click()
            assert page.locator('.node-row').count() == 2, name
            page.locator('.node-row').first.click()
            page.locator('#features-tab').click()
            assert page.locator('#feature-view').is_visible(), name
            page.locator('#project-tab').click()
            assert page.locator('#project-map .project-node').count() == 2, name
            assert not console_errors, console_errors
        assert page.evaluate('globalThis.repoGraphiaInjected') is None
        assert not errors, errors
        assert not requests, requests
        if name == 'crlf':
            page.screenshot(path=str(args.directory / 'crlf-startup.png'), full_page=True)
        results.append({'fixture': name, 'result': 'blocked-as-expected' if name in ['wrong-hash', 'tampered'] else 'pass'})
        page.close()
    browser.close()
print(json.dumps({'navigation': 'set-content' if args.set_content else 'file', 'results': results,
    'browserExceptions': 0, 'externalRequests': 0}))
