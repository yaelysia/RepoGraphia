"""Read-only browser checks for the CLI-generated proposal report. No model is invoked."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('directory')
parser.add_argument('--chromium')
parser.add_argument('--set-content', action='store_true')
a = parser.parse_args()
root = Path(a.directory).resolve()
passed, errors, requests = [], [], []

def check(condition, name):
    assert condition, name
    passed.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': a.chromium} if a.chromium else {}))
    page = browser.new_page(viewport={'width': 1650, 'height': 1100})
    def reveal(selector):
        section = page.locator(selector)
        panel = section.locator('xpath=ancestor::*[@data-panel]').first
        if panel.count():
            page.locator(f'.feature-detail-tabs [data-tab="{panel.get_attribute("data-panel")}"]').click()
        if section.count() and section.get_attribute('open') is None:
            section.locator('summary').first.click()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    html = root / 'index.html'
    if a.set_content:
        page.set_content(html.read_bytes().decode('utf8'), wait_until='load')
    else:
        page.goto(html.as_uri())
    graph_before = page.locator('#graph-data').text_content()
    page.locator('#features-tab').click()
    check(page.locator('.feature-card').count() == 5, 'original three proposals and two new capabilities coexist')
    reveal('.feature-document-tools')
    check('13 条映射' in page.locator('#feature-summary').inner_text(), 'append adds seven mappings without replacing the original six')
    page.locator('.feature-card[data-feature="desktop-alert-interaction"]').click()
    reveal('.feature-description')
    check('第0个动作按钮' in page.locator('#detail').inner_text() and '正文点击' in page.locator('#detail').inner_text(), 'different actions have explicit behavioral boundaries')
    page.locator('.feature-open-code[data-feature="desktop-alert-interaction"]').click()
    page.locator('.feature-mode[data-mode="list"]').click()
    check(page.locator('.feature-mapping').count() == 5, 'notification includes trigger, implementation and navigation support')
    page.screenshot(path=str(root / 'preview-agent-features.png'), full_page=True)
    page.locator('.feature-mapping[data-mapping="desktop-click"]').click()
    check('待审提案' in page.locator('#detail').inner_text(), 'agent cannot self-accept')
    reveal('.feature-warning-details')
    check('候选关系' in page.locator('#detail').inner_text() and '来源集合不完整' in page.locator('#detail').inner_text(), 'candidate provenance survives proposal publication')
    page.screenshot(path=str(root / 'preview-agent-evidence.png'), full_page=True)
    reveal('.feature-evidence-details')
    page.locator('.feature-evidence').last.click()
    check('bounded-value-origin' in page.locator('#detail').inner_text(), 'original value-origin evidence remains inspectable')
    page.locator('.feature-back').first.click()
    page.locator('.feature-mapping[data-mapping="desktop-dispatch"]').click()
    page.locator('.feature-detail-tabs [data-tab="about"]').click()
    page.locator('.feature-source').click()
    check(page.locator('#local-view').is_visible(), 'proposal-to-source uses existing exact entity navigation')
    check(page.locator('.feature-reverse').count() == 2, 'shared dispatch maps to both capabilities without a synthetic feature dependency')
    page.locator('#features-tab').click()
    page.locator('#feature-breadcrumb button').first.click()
    page.locator('.feature-card[data-feature="foreground-popup-gate"]').click()
    reveal('.feature-description')
    check('抛出异常时放行' in page.locator('#detail').inner_text(), 'important failure condition is in the capability description')
    check(page.locator('#graph-data').text_content() == graph_before, 'inspection does not mutate the code graph')
    page.set_viewport_size({'width': 430, 'height': 900})
    check(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'proposal view fits narrow viewport')
    check(not errors, 'no browser exceptions')
    check(not [u for u in requests if not u.startswith('file:')], 'no external network requests')
    browser.close()
result = {'checks': len(passed), 'passed': passed, 'browserErrors': errors, 'externalRequests': 0,
          'navigation': 'set-content' if a.set_content else 'file', 'scope': 'frozen-author-proposal replay, not a model run'}
(root / 'browser-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(result, ensure_ascii=False))
