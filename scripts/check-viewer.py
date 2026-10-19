"""Optional Playwright smoke test. No target project code is executed."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('report')
parser.add_argument('--output', default='preview.png')
parser.add_argument('--chromium')
parser.add_argument('--set-content', action='store_true', help='Use only when the host blocks file:// navigation')
args = parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
    page = browser.new_page(viewport={'width': 1600, 'height': 1100})
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    report = Path(args.report).resolve()
    if args.set_content:
        page.set_content(report.read_text(encoding='utf-8'), wait_until='load')
    else:
        page.goto(report.as_uri())
    page.wait_for_selector('.node-row')
    embedded = page.locator('#graph-data').text_content()
    data = json.loads(embedded)
    revision = data['project'].get('analysisRevision', '未标注（旧报告）')
    assert f'分析规则 {revision}' in page.locator('#revision').inner_text()
    assert page.locator('#map .node').count() > 0
    page.screenshot(path=args.output, full_page=True)
    page.locator('#symbols-tab').click()
    assert page.locator('.node-row').count() > 0
    page.locator('.node-row').first.click()
    page.locator('#status').select_option('unresolved')
    page.locator('#status').select_option('all')
    page.locator('#search').fill('this-query-does-not-exist')
    assert page.locator('.node-row').count() == 0
    page.locator('#search').fill('')
    page.locator('#files-tab').click()
    page.locator('.node-row').first.click()
    if page.locator('.edge-row').count():
        page.locator('.edge-row').first.click()
        assert '解析依据' in page.locator('#detail').inner_text()
    page.locator('#zoom-in').click()
    page.locator('#fit').click()
    assert page.locator('#map').get_attribute('viewBox') == '0 0 1000 650'
    page.locator('#gaps-tab').click()
    assert page.locator('.gap').count() > 0
    page.set_viewport_size({'width': 430, 'height': 900})
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    assert page.evaluate('globalThis.pwned') is None
    # The current viewer must not assign its own analysis rules to older v1 data.
    data['project'].pop('analysisRevision', None)
    legacy_data = json.dumps(data, ensure_ascii=True).replace('<', '\\u003c')
    original = report.read_text(encoding='utf-8')
    assert embedded in original
    page.set_content(original.replace(embedded, legacy_data, 1), wait_until='load')
    assert '分析规则 未标注（旧报告）' in page.locator('#revision').inner_text()
    assert page.evaluate('globalThis.pwned') is None
    browser.close()
    assert not errors, errors
    assert not [url for url in requests if not url.startswith('file:')], requests
    print(json.dumps({'browserErrors': errors, 'networkRequests': 0, 'checks': 14}))
