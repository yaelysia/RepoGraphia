"""Project navigation smoke test; the separate legacy explorer suite still runs."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from project_map_checks import check_project_map

parser = argparse.ArgumentParser()
parser.add_argument('report')
parser.add_argument('--output', default='preview.png')
parser.add_argument('--chromium')
parser.add_argument('--set-content', action='store_true')
args = parser.parse_args()
checks, errors, requests = [], [], []

def check(name, condition):
    assert condition, name
    checks.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
    page = browser.new_page(viewport={'width': 1600, 'height': 1100})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    report = Path(args.report).resolve()
    if args.set_content:
        page.set_content(report.read_text(encoding='utf-8'), wait_until='load')
    else:
        page.goto(report.as_uri())
    page.wait_for_selector('.project-row')
    graph = json.loads(page.locator('#graph-data').text_content())
    check_project_map(page, graph, check, Path(args.output))
    browser.close()
    check('project browser has no exceptions', not errors)
    check('project browser makes no external requests', not [u for u in requests if not u.startswith('file:')])
    print(json.dumps({'checks': len(checks), 'passed': checks, 'browserErrors': errors,
        'externalRequests': 0, 'navigation': 'set-content' if args.set_content else 'file'}))
