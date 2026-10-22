"""Exercise authored function hierarchy, navigation and offline UI state; no target execution."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--chromium')
parser.add_argument('--set-content', action='store_true')
args = parser.parse_args()
root = args.directory.resolve()
fixture = json.loads((root / 'fixture.json').read_bytes().decode('utf8'))
chain = fixture['chain']
passed, errors, requests = [], [], []

def check(value, name):
    assert value, name
    passed.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path':args.chromium} if args.chromium else {}))
    page = browser.new_page(viewport={'width':1440,'height':1000}, accept_downloads=True)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.on('dialog', lambda dialog: dialog.accept())

    def load(name='workbench.html'):
        html = root / name
        if args.set_content:
            page.set_content(html.read_bytes().decode('utf8'), wait_until='load')
        else:
            page.goto(html.as_uri(), wait_until='load')
        page.locator('#features-tab').click()

    def card(feature):
        return page.locator(f'.feature-card[data-feature="{feature}"]')

    def enter(feature):
        page.locator(f'.feature-enter[data-feature="{feature}"]').click()

    def home():
        button = page.locator('#feature-breadcrumb button').first
        if button.count():
            button.click()

    def show_code(feature):
        page.locator(f'.feature-open-code[data-feature="{feature}"]').click()

    def settle():
        page.wait_for_timeout(600)

    def reveal(selector):
        section=page.locator(selector)
        parent=section.locator('xpath=ancestor::*[@data-panel]').first
        if parent.count():
            page.locator(f'.feature-detail-tabs [data-tab="{parent.get_attribute("data-panel")}"]').click()
        if section.get_attribute('open') is None:
            section.locator('summary').first.click()

    def documents():
        reveal('.feature-document-tools')

    def camera():
        return page.locator('.feature-world').evaluate('(node) => getComputedStyle(node).transform')

    def running_motion():
        return page.locator('#feature-view').evaluate('''node => node.getAnimations({subtree:true})
          .filter(a=>a.playState==='running' && Number(a.effect.getTiming().duration)>=200)
          .map(a=>({duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations,
                    frames:a.effect.getKeyframes()}))''')

    load()
    graph_before = page.locator('#graph-data').text_content()
    feature_before = page.locator('#feature-data').text_content()
    check(sorted(page.locator('.feature-card').evaluate_all('nodes=>nodes.map(n=>n.dataset.feature)')) == sorted(fixture['rootIds']),
          'overview shows only authored root features')
    check(card('window').locator('.feature-node-summary').inner_text() == '按明确条件处理窗口的显示与恢复',
          'node displays the authored one-line explanation')
    card('window').focus();page.keyboard.press('Enter')
    check(card('window').get_attribute('aria-pressed') == 'true', 'native keyboard selection opens the inspector')
    check(card('shared').count() == 1 and page.locator('.feature-code-node').count() == 0,
          'selecting a feature does not replace the current level with code')
    reveal('.feature-description')
    check('完整说明仅在阅读区出现' in page.locator('#detail').inner_text(), 'full original description remains readable')
    page.screenshot(path=str(root / 'workbench-overview.png'), full_page=True)

    # Store a visible camera change, then confirm returning to the same scope restores it.
    page.locator('#feature-zoom-in').click();settle()
    before_camera = camera()
    enter('window')
    movement = running_motion()
    check(any(any(frame.get('transform') or frame.get('clipPath') for frame in item['frames']) for item in movement),
          'entering a level has a spatial transition')
    settle()
    check(sorted(page.locator('.feature-card').evaluate_all('nodes=>nodes.map(n=>n.dataset.feature)')) == sorted(fixture['windowChildren']),
          'entering reveals only explicit direct children')
    check(page.locator('.feature-call-line').count() == 0, 'containment does not invent code or function call arrows')
    page.locator('#feature-parent').click();settle()
    check(camera() == before_camera, 'returning restores the parent camera')
    check(card('window').get_attribute('aria-pressed') == 'true', 'returning selects the feature just exited')

    # Five further entries exercise real depth, without a special two-level path.
    for index, feature in enumerate(chain[:-1]):
        enter(feature['id']);settle()
        child=chain[index+1]
        check(card(child['id']).count() == 1, 'hierarchy depth '+str(index+1)+' is reachable')
        expect(page.locator('#feature-breadcrumb')).to_contain_text(feature['title'])
    card('final').click()
    reveal('.feature-questions')
    check('静态关系没有证明' in page.locator('#detail').inner_text(), 'deep feature retains its original question and limits')
    page.screenshot(path=str(root / 'workbench-deep.png'), full_page=True)

    # Search locates the feature in its parent scope, rather than skipping its own node.
    home();page.locator('#feature-search').fill('最终确认')
    result = page.locator('.feature-search-result[data-feature="final"]')
    expect(result).to_be_visible();result.click();settle()
    check(card('final').get_attribute('aria-pressed') == 'true', 'global search selects a deep feature in its parent scope')
    expect(page.locator('#feature-breadcrumb')).to_contain_text(chain[-2]['title'])
    check(page.locator('#detail').locator('h3').first.inner_text() == chain[-1]['title'], 'search exposes the complete long title')

    # Source and evidence return to the same explicit mapping and expanded support group.
    show_code('final');settle()
    page.locator('.feature-group-expand[data-role="support"]').click()
    page.locator('.feature-code-node[data-mapping="level-final"]').click()
    page.locator('.feature-detail-tabs [data-tab="about"]').click();page.locator('.feature-source').click()
    expect(page.locator('#local-view')).to_be_visible()
    page.locator('.feature-back').first.click();settle()
    check(page.locator('.feature-code-node[data-mapping="level-final"]').get_attribute('aria-pressed') == 'true',
          'source return restores the selected mapping')
    check(page.locator('.feature-code-node[data-role="support"]').count() == 1,
          'source return retains the expanded support group')
    reveal('.feature-evidence-details');page.locator('.feature-evidence').first.click()
    check('scene:call' in page.locator('#detail').inner_text(), 'deep mapping opens exact original relation evidence')
    page.locator('.feature-back').first.click();settle()
    check(page.locator('.feature-code-node[data-mapping="level-final"]').get_attribute('aria-pressed') == 'true',
          'evidence return restores the selected mapping')

    home();show_code('window')
    page.locator('.feature-group-expand[data-role="support"]').click()
    page.locator('#feature-show-calls').check()
    page.locator('#feature-map-mode [data-mode="features"]').click();enter('open');settle()
    page.locator('#feature-parent').click();settle()
    page.locator('#feature-map-mode [data-mode="code"]').click()
    check(page.locator('.feature-code-node[data-role="support"]').count() == 5 and page.locator('#feature-show-calls').is_checked(),
          'changing feature scopes preserves parent code expansion and call-overlay preference')
    page.locator('.feature-mode[data-mode="list"]').click();page.locator('.feature-list-more').click()
    page.locator('#feature-map-mode [data-mode="features"]').click();enter('open');settle()
    page.locator('#feature-parent').click();settle()
    page.locator('#feature-map-mode [data-mode="code"]').click()
    check(page.locator('.feature-code-node').count() == 34, 'parent full-list pagination survives a child visit')

    # Navigation must not silently rewrite annotations, review decisions, history or source text.
    check(page.locator('#graph-data').text_content() == graph_before, 'browsing never mutates embedded code data')
    check(page.locator('#feature-data').text_content() == feature_before, 'browsing never rewrites embedded authored annotations')
    documents()
    with page.expect_download() as download:
        page.locator('#feature-export').click()
    exported=root/'workbench-export.json';download.value.save_as(exported)
    original=json.loads((root/'features.json').read_bytes().decode('utf8'))
    check(json.loads(exported.read_bytes().decode('utf8')) == original, 'export after browsing retains hierarchy, decisions and full history')
    page.locator('#feature-import').set_input_files(str(root/'invalid-cycle.json'))
    expect(page.locator('#feature-notice')).to_contain_text('导入失败')
    with page.expect_download() as download:
        page.locator('#feature-export').click()
    preserved=root/'after-invalid-import.json';download.value.save_as(preserved)
    check(json.loads(preserved.read_bytes().decode('utf8')) == original, 'cyclic hierarchy import preserves the current valid document')
    page.locator('#feature-import').set_input_files(str(exported))
    expect(page.locator('#feature-notice')).to_contain_text('已载入')
    enter('window');settle()
    check(card('open').count() == 1 and card('skip').count() == 1, 'exported hierarchy imports without flattening')
    show_code('skip')
    check('尚无代码映射' in page.locator('#feature-mappings').inner_text(), 'unmapped child has an honest empty code state')

    # Fast reversals should finish at the requested scope without stale transition layers.
    home();page.locator('.feature-enter[data-feature="window"]').dispatch_event('click');page.wait_for_timeout(65)
    page.locator('#feature-parent').dispatch_event('click');page.wait_for_timeout(65)
    page.locator('.feature-enter[data-feature="window"]').dispatch_event('click');settle()
    check(card('open').count() == 1 and card('shared').count() == 0, 'rapid enter-return-enter ends at the requested level')
    check(not running_motion(), 'navigation leaves no running or looping transition')
    page.emulate_media(reduced_motion='reduce')
    page.locator('#feature-parent').click();enter('window')
    check(card('open').count() == 1 and not running_motion(), 'reduced-motion navigation completes immediately')

    # A result outside the initial twelve siblings must be rendered and brought into view.
    page.emulate_media(reduced_motion='no-preference')
    load('wide-hierarchy.html');enter('window');settle()
    target=fixture['wideTarget']
    check(card(target['id']).count() == 0, 'wide hierarchy initially keeps the sibling display budget')
    page.locator('#feature-search').fill(target['title'])
    page.locator(f'.feature-search-result[data-feature="{target["id"]}"]').click();settle()
    check(card(target['id']).get_attribute('aria-pressed') == 'true',
          'search materializes and selects a sibling beyond the first page')
    box=card(target['id']).bounding_box();viewport=page.locator('.feature-viewport').bounding_box()
    check(viewport['x'] <= box['x']+box['width']/2 <= viewport['x']+viewport['width']
          and viewport['y'] <= box['y']+box['height']/2 <= viewport['y']+viewport['height'],
          'search moves the camera to a distant sibling inside the visible viewport')
    page.screenshot(path=str(root/'workbench-wide-search.png'), full_page=True)

    # A real reparent edit must not leave a previously selected child in its old scope.
    load();enter('window');settle();show_code('open');settle()
    page.locator('.feature-code-node[data-mapping="level-open"]').click()
    reveal('.feature-review-details')
    page.get_by_label('编辑者（自述身份）').fill('workbench-test-reviewer')
    page.get_by_label('本次修改理由').fill('Test-only review before unchanged feature edit')
    page.locator('.feature-review[data-decision="accepted"]').click()
    page.locator('.feature-detail-tabs [data-tab="about"]').click()
    page.get_by_role('button', name='返回功能说明', exact=True).click()
    page.locator('.feature-detail-tabs [data-tab="review"]').click()
    page.get_by_role('button', name='编辑功能说明', exact=True).click()
    page.locator('.feature-save').click();settle();show_code('open');settle()
    check(page.locator('.feature-code-node[data-mapping="level-open"]').get_attribute('data-decision') == 'accepted',
          'saving an unchanged hierarchy feature preserves its accepted mapping')
    page.locator('.feature-code-node[data-mapping="level-open"]').click()
    page.locator('.feature-detail-tabs [data-tab="about"]').click()
    page.get_by_role('button', name='返回功能说明', exact=True).click()
    page.locator('.feature-detail-tabs [data-tab="review"]').click()
    page.get_by_role('button', name='编辑功能说明', exact=True).click()
    page.get_by_label('编辑者（自述身份）').fill('workbench-test-reviewer')
    page.get_by_label('本次修改理由').fill('Test-only explicit hierarchy correction')
    page.get_by_label('父功能（可选）', exact=True).select_option('shared')
    page.locator('.feature-save').click();settle()
    check(card('open').get_attribute('aria-pressed') == 'true'
          and page.locator('#feature-breadcrumb [aria-current="page"]').get_attribute('data-feature') == 'shared',
          'reparenting moves the selected feature to its explicit new parent')
    home();enter('window');settle()
    check(card('open').count() == 0 and card('skip').count() == 1,
          'returning to the former parent reflects the edited direct children')
    check(page.locator('#detail h3').first.inner_text() != chain[1]['title'],
          'former parent does not retain an inspector selection outside its scope')
    load();enter('window');settle()

    # Layout checks assert the reading relationship rather than exact pixel styling.
    for width in [1024,736,430]:
        page.set_viewport_size({'width':width,'height':1000});settle()
        if width < 620:
            page.get_by_role('button', name='收起阅读区', exact=True).click()
        card('open').click()
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{width}px has no page-level horizontal overflow')
        if width >= 736:
            graph_box=page.locator('#feature-cards').bounding_box();detail_box=page.locator('#detail').bounding_box()
            check(detail_box['x'] >= graph_box['x']+graph_box['width']-2,
                  f'{width}px keeps the inspector to the right of the graph')
        page.screenshot(path=str(root/f'workbench-{width}.png'), full_page=True)
    load('hostile.html')
    check(page.locator('.feature-node-summary img').count() == 0 and page.evaluate('globalThis.workbenchInjected') is None,
          'authored summaries stay inert even with HTML-shaped text')
    check(not errors, 'no workbench browser exceptions')
    check(not [url for url in requests if not url.startswith(('file:','blob:'))], 'workbench makes no external requests')
    browser.close()

result={'checks':len(passed),'passed':passed,'browserErrors':errors,
        'navigation':'set-content' if args.set_content else 'file','scope':'authored hierarchy and UI regression, not runtime semantics'}
(root/'workbench-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False))
