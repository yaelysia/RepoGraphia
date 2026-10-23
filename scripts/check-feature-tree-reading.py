"""M4 reading behavior in real file:// Chromium; no target code or model executes."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--chromium')
args = parser.parse_args()
root = args.directory.resolve()
fixture = json.loads((root / 'fixture.json').read_text(encoding='utf8'))
original = json.loads((root / 'features.json').read_text(encoding='utf8'))
features = {feature['id']: feature for feature in original['features']}
passed, errors, requests = [], [], []
pan_count = 0


def check(value, name):
    assert value, name
    passed.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('request', lambda request: requests.append(request.url))
    page.on('dialog', lambda dialog: dialog.accept())
    page.route('http://**/*', lambda route: route.abort())
    page.route('https://**/*', lambda route: route.abort())

    def world():
        # Navigation ghosts are inert snapshots, not currently available controls.
        return page.locator('.feature-scene-layer:not(.feature-motion-ghost) > .feature-world')

    def card(feature):
        return world().locator(f'.feature-card[data-feature="{feature}"]')

    def toggle(feature):
        return world().locator(f'.feature-branch-toggle[data-feature="{feature}"]')

    def ids():
        return world().locator('.feature-card').evaluate_all('nodes => nodes.map(node => node.dataset.feature)')

    def scope():
        return page.locator('#feature-view').get_attribute('data-scope')

    def camera():
        return page.locator('.feature-viewport').evaluate('node => [node.dataset.x, node.dataset.y, node.dataset.scale]')

    def settle():
        # All supported presentation transitions are finite and below 550 ms.
        page.wait_for_timeout(600)

    def load(name='reading.html'):
        page.goto((root / name).as_uri(), wait_until='load')
        page.locator('#features-tab').click()
        settle()

    def home():
        page.locator('#feature-breadcrumb button').first.click()
        settle()

    def reveal(selector):
        section = page.locator(selector)
        panel = section.locator('xpath=ancestor::*[@data-panel]').first
        if panel.count():
            page.locator(f'.feature-detail-tabs [data-tab="{panel.get_attribute("data-panel")}"]').click()
        if section.get_attribute('open') is None:
            section.locator('summary').first.click()

    def center_is_visible(locator):
        box, viewport = locator.bounding_box(), page.locator('.feature-viewport').bounding_box()
        if not box or not viewport:
            return False
        return (viewport['x'] + 12 <= box['x'] + box['width'] / 2 <= viewport['x'] + viewport['width'] - 12
                and viewport['y'] + 12 <= box['y'] + box['height'] / 2 <= viewport['y'] + viewport['height'] - 12)

    def bring_into_view(locator):
        """Pan using pointer input when a real tree is larger than the viewport."""
        global pan_count
        for _ in range(60):
            if center_is_visible(locator):
                return
            box, viewport = locator.bounding_box(), page.locator('.feature-viewport').bounding_box()
            assert box and viewport, 'requested reading control exists on the current canvas'
            dx = max(-180, min(180, viewport['x'] + viewport['width'] / 2 - box['x'] - box['width'] / 2))
            dy = max(-180, min(180, viewport['y'] + viewport['height'] / 2 - box['y'] - box['height'] / 2))
            point = page.locator('.feature-viewport').evaluate('''node => {
              const r = node.getBoundingClientRect();
              for (const fx of [.5, .12, .88]) for (const fy of [.12, .5, .88]) {
                const x = r.x + r.width * fx, y = r.y + r.height * fy, target = document.elementFromPoint(x, y);
                if (node.contains(target) && !target.closest('button,input,a')) return {x,y};
              }
              return null;
            }''')
            assert point, 'there is an unobstructed place to drag the canvas'
            page.mouse.move(point['x'], point['y'])
            page.mouse.down()
            page.mouse.move(point['x'] + dx, point['y'] + dy, steps=4)
            page.mouse.up()
            pan_count += 1
        raise AssertionError('canvas panning can reach the requested reading control')

    def select(feature):
        bring_into_view(card(feature))
        card(feature).click()
        settle()

    def expand(feature):
        control = toggle(feature)
        if control.get_attribute('aria-expanded') != 'true':
            bring_into_view(control)
            control.click()
            settle()

    def focus(feature):
        control = world().locator(f'.feature-enter[data-feature="{feature}"]')
        bring_into_view(control)
        control.click()
        settle()

    def show_code(feature):
        control = world().locator(f'.feature-open-code[data-feature="{feature}"]')
        bring_into_view(control)
        control.click()
        settle()

    def search(feature):
        page.locator('#feature-search').fill(features[feature]['title'])
        result = page.locator(f'.feature-search-result[data-feature="{feature}"]')
        expect(result).to_be_visible()
        result.click()
        settle()

    def motion():
        return page.locator('#feature-view').evaluate('''node => node.getAnimations({subtree:true})
          .filter(animation => animation.playState === 'running' && Number(animation.effect.getTiming().duration) >= 150)
          .map(animation => ({duration: animation.effect.getTiming().duration,
            iterations: animation.effect.getTiming().iterations, frames: animation.effect.getKeyframes()}))''')

    def overlaps():
        return world().locator('.feature-node-wrap').evaluate_all('''nodes => {
          const boxes = nodes.map(node => ({id:node.dataset.feature,x:node.offsetLeft,y:node.offsetTop,
            w:node.offsetWidth,h:node.offsetHeight})), collisions = [];
          for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
            const a=boxes[i], b=boxes[j];
            if (Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 &&
                Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1) collisions.push([a.id,b.id]);
          }
          return collisions;
        }''')

    def export_document(filename):
        reveal('.feature-document-tools')
        with page.expect_download() as download:
            page.locator('#feature-export').click()
        destination = root / filename
        download.value.save_as(destination)
        return json.loads(destination.read_text(encoding='utf8'))

    load()
    graph_before, annotations_before = page.locator('#graph-data').text_content(), page.locator('#feature-data').text_content()
    check(sorted(ids()) == sorted(fixture['rootIds']), 'default overview starts with explicit root features')
    check(toggle('window').get_attribute('aria-expanded') == 'false', 'branch state is exposed before expansion')
    text_sizes = card('window').evaluate('''node => ({title:parseFloat(getComputedStyle(node.querySelector('strong')).fontSize),
      summary:parseFloat(getComputedStyle(node.querySelector('.feature-node-summary')).fontSize)})''')
    check(float(camera()[2]) == 1 and text_sizes['title'] >= 16 and text_sizes['summary'] >= 14,
          'Chinese titles and explanations start at readable 1:1 size')
    card('window').focus()
    page.keyboard.press('Enter')
    check(card('window').get_attribute('aria-pressed') == 'true' and scope() == '',
          'keyboard selection opens the reader without entering the feature')
    check(card('window').locator('.feature-node-summary').inner_text() == features['window']['summary'],
          'default node explanation uses the original authored summary')
    settle()
    page.screenshot(path=str(root / 'reading-overview.png'), full_page=True)

    toggle('window').click()
    active_motion = motion()
    check(any(item['iterations'] == 1 and 150 <= item['duration'] <= 550
              and any(frame.get('transform') or frame.get('clipPath') for frame in item['frames'])
              for item in active_motion), 'in-place expansion has a finite spatial transition')
    settle()
    check(scope() == '' and {'window', 'shared', 'open', 'skip', fixture['wideBranch']}.issubset(ids()),
          'expansion retains its parent and sibling context in the same scope')
    check(toggle('window').get_attribute('aria-expanded') == 'true', 'expanded branch state is exposed to assistive technology')
    visible_before = ids()
    select('open')
    check(scope() == '' and ids() == visible_before and card('open').get_attribute('aria-pressed') == 'true',
          'selecting an expanded descendant does not change the reading scope or visible tree')
    check(world().locator('.feature-enter[data-feature="open"]').count() == 1,
          'focused entry remains a separate action from selecting or expanding')
    check(page.locator('.feature-call-line').count() == 0
          and world().locator('.feature-containment-line[marker-end]').count() == 0,
          'function containment and shared source do not create execution arrows')

    for feature in fixture['deepPath'][1:-1]:
        expand(feature)
    deep = fixture['deepTarget']
    check(all(card(feature).count() == 1 for feature in fixture['deepPath']),
          'thirteen authored levels remain reachable through repeated in-place expansion')
    check(scope() == '' and float(camera()[2]) == 1, 'deep expansion retains scope and readable scale instead of shrinking the whole tree')
    select(deep)
    check(page.locator('#detail h3').first.inner_text() == features[deep]['title'],
          'the reader exposes the complete long Chinese title')
    reveal('.feature-description')
    check(features[deep]['description'] in page.locator('#detail').inner_text(), 'deep reading preserves the complete original description')
    reveal('.feature-questions')
    check(features[deep]['questions'][0] in page.locator('#detail').inner_text(), 'deep reading preserves the original uncertainty')
    check(not overlaps(), 'deep and uneven visible branches do not overlap their reading controls')
    page.screenshot(path=str(root / 'reading-deep.png'), full_page=True)

    bring_into_view(toggle('window'))
    toggle('window').click()
    settle()
    check(card(deep).count() == 0 and page.locator('#detail h3').first.inner_text() == features[deep]['title'],
          'folding a branch retains the selected descendant in the reader')
    expect(page.locator('#feature-locate-selected')).to_be_visible()
    page.locator('#feature-locate-selected').click()
    settle()
    check(card(deep).get_attribute('aria-pressed') == 'true' and scope() == '' and center_is_visible(card(deep)),
          'locating the selected descendant reopens ancestors and returns it to view')

    # Focus can jump from a broad overview to a deep branch; return goes to the reading context.
    bring_into_view(world().locator('.feature-enter[data-feature="prepare"]'))
    prior_ids, prior_camera = ids(), camera()
    focus('prepare')
    check(scope() == 'prepare' and card('shared').count() == 0,
          'explicit focus narrows the canvas to the chosen subtree')
    check(features['prepare']['title'] in world().locator('.feature-parent-node').inner_text(),
          'focused reading retains the explicit parent context')
    page.locator('#feature-parent').click()
    settle()
    check(scope() == '' and ids() == prior_ids, 'focus return restores the prior overview and its expanded branches')
    check(card(deep).get_attribute('aria-pressed') == 'true' and camera() == prior_camera,
          'focus return restores the previous selected descendant and camera')

    # Existing code/source/evidence navigation must retain M4 reading state.
    prior_ids = ids()
    show_code(deep)
    page.locator('.feature-group-expand[data-role="support"]').click()
    page.locator('.feature-code-node[data-mapping="deep-entry"]').click()
    check('候选关系' in page.locator('#detail').inner_text(), 'candidate source evidence stays visibly uncertain')
    page.locator('.feature-source').click()
    expect(page.locator('#local-view')).to_be_visible()
    page.locator('.feature-back').first.click()
    settle()
    check(page.locator('.feature-code-node[data-mapping="deep-entry"]').get_attribute('aria-pressed') == 'true'
          and page.locator('.feature-code-node[data-role="support"]').count() == 1,
          'source return restores the mapping and expanded code group')
    reveal('.feature-evidence-details')
    page.locator('.feature-evidence').first.click()
    check('scene:call' in page.locator('#detail').inner_text(), 'evidence navigation still exposes the exact original relation')
    page.locator('.feature-back').first.click()
    settle()
    home()
    check(scope() == '' and ids() == prior_ids, 'code and evidence roundtrip retains the expanded functional tree')
    check(page.locator('#graph-data').text_content() == graph_before
          and page.locator('#feature-data').text_content() == annotations_before,
          'reading interactions never rewrite the embedded source or annotations')
    check(export_document('reading-export.json') == original,
          'export preserves every description, parent, review decision, evidence anchor and history record')

    load()
    focus('window')
    search(deep)
    check(scope() == 'window' and card(deep).get_attribute('aria-pressed') == 'true',
          'search reveals a deep target while retaining a containing focus scope')
    check(center_is_visible(card(deep)), 'search brings the selected deep target into the visible viewport')
    check(toggle(fixture['wideBranch']).get_attribute('aria-expanded') == 'false'
          and toggle('limits').get_attribute('aria-expanded') == 'false',
          'search leaves unrelated branches folded')
    search(fixture['outsideTarget'])
    check(scope() == '' and card(fixture['outsideTarget']).get_attribute('aria-pressed') == 'true',
          'search outside the focused subtree returns to the overview and reveals its real ancestry')

    load()
    expand('window')
    select('window')
    reveal('.feature-description')
    detail_box = page.locator('#detail').bounding_box()
    page.mouse.move(detail_box['x'] + detail_box['width'] / 2, detail_box['y'] + 120)
    page.mouse.wheel(0, 380)
    settle()
    before_search_camera, before_search_ids = camera(), ids()
    before_search_scroll = page.locator('#detail').evaluate('node => [node.scrollTop, node.closest(".inspector").scrollTop]')
    search(deep)
    check(scope() == '' and card(deep).get_attribute('aria-pressed') == 'true',
          'same-scope search creates a new reading location without replacing the overview')
    page.locator('#feature-parent').click()
    settle()
    check(scope() == '' and camera() == before_search_camera and ids() == before_search_ids,
          'returning from same-scope search restores its prior camera and expansion')
    restored_scroll = page.locator('#detail').evaluate('node => [node.scrollTop, node.closest(".inspector").scrollTop]')
    check(card('window').get_attribute('aria-pressed') == 'true'
          and page.locator('.feature-description').get_attribute('open') is not None
          and restored_scroll == before_search_scroll,
          'same-scope search return restores the selected explanation, open section and reading scroll')

    # Revisiting a scope must not overwrite an older visit's saved reading state.
    load()
    page.locator('#feature-zoom-in').click()
    settle()
    bring_into_view(world().locator('.feature-enter[data-feature="window"]'))
    first_visit_camera, first_visit_ids = camera(), ids()
    first_visit_selection = world().locator('.feature-card[aria-pressed="true"]').evaluate_all('nodes => nodes.map(node => node.dataset.feature)')
    focus('window')
    search(fixture['outsideTarget'])
    check(scope() == '' and toggle('shared').get_attribute('aria-expanded') == 'true',
          'a later overview visit can reveal a different root branch')
    page.locator('#feature-parent').click()
    settle()
    check(scope() == 'window', 'the first history return restores the focused visit')
    page.locator('#feature-parent').click()
    settle()
    check(scope() == '' and camera() == first_visit_camera and ids() == first_visit_ids,
          'a repeated scope visit restores its own earlier camera and folded branches')
    restored_selection = world().locator('.feature-card[aria-pressed="true"]').evaluate_all('nodes => nodes.map(node => node.dataset.feature)')
    check(restored_selection == first_visit_selection,
          'history return restores the earlier selection even when it was empty')

    load()
    expand('window')
    expand(fixture['wideBranch'])
    check(float(camera()[2]) == 1, 'wide expansion does not trade readable text for fitting every sibling')
    while not set(fixture['wideIds']).issubset(ids()):
        more = world().locator(f'.feature-branch-more[data-feature="{fixture["wideBranch"]}"]')
        check(more.count() == 1 and any(char.isdigit() for char in more.inner_text()),
              'the branch discloses that additional authored siblings remain')
        bring_into_view(more)
        more.click()
        settle()
    check(set(fixture['wideIds']).issubset(ids()), 'every sibling remains reachable beyond the initial display budget')
    check(not overlaps(), 'wide siblings and uneven branches have separate clickable areas')
    check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),
          'wide trees stay inside their pan area without page-level horizontal overflow')
    search(fixture['wideTarget'])
    check(scope() == '' and center_is_visible(card(fixture['wideTarget'])),
          'wide sibling search preserves the overview and moves the camera to the target')
    page.screenshot(path=str(root / 'reading-wide.png'), full_page=True)

    load()
    focus('window')
    focus(fixture['wideBranch'])
    root_more = world().locator(f'.feature-parent-node .feature-branch-more[data-feature="{fixture["wideBranch"]}"]')
    check(root_more.count() == 1 and not set(fixture['wideIds']).issubset(ids()),
          'a focused wide branch exposes remaining children from its parent context')
    bring_into_view(root_more)
    root_more.click()
    settle()
    check(scope() == fixture['wideBranch'] and set(fixture['wideIds']).issubset(ids()) and float(camera()[2]) == 1,
          'focused-root pagination preserves scope and text size while revealing every child')
    check(features[fixture['wideBranch']]['title'] in world().locator('.feature-parent-node').inner_text()
          and world().locator('.feature-parent-node .feature-branch-more').count() == 0,
          'focused-root pagination retains its parent context and clears the exhausted control')

    load()
    for feature in fixture['unevenPath'][:-1]:
        expand(feature)
    leaf = fixture['unevenPath'][-1]
    select(leaf)
    check(not overlaps(), 'uneven depth keeps a short side branch distinct from its deep neighbour')
    check('已完成分析' not in card(leaf).inner_text() and '100%' not in card(leaf).inner_text(),
          'a leaf with no mapped code is not presented as completed analysis')
    show_code(leaf)
    check('尚无代码映射' in page.locator('#feature-mappings').inner_text(), 'unmapped functional leaves retain the honest empty code state')

    load()
    toggle('window').focus()
    for _ in range(3):
        page.keyboard.press('Space')
        page.wait_for_timeout(60)
    settle()
    check(toggle('window').get_attribute('aria-expanded') == 'true' and card('open').count() == 1,
          'rapid keyboard expand-fold-expand ends in the requested state')
    check(not motion() and page.locator('.feature-motion-ghost').count() == 0,
          'rapid branch changes leave no looping animation or stale interaction layer')
    page.emulate_media(reduced_motion='reduce')
    toggle('window').focus()
    page.keyboard.press('Space')
    check(card('open').count() == 0 and not motion(), 'reduced-motion collapse completes without a spatial transition')
    toggle('window').focus()
    page.keyboard.press('Space')
    check(card('open').count() == 1 and not motion(), 'reduced-motion expansion completes without a spatial transition')
    page.emulate_media(reduced_motion='no-preference')

    for width in [1024, 736, 430]:
        page.set_viewport_size({'width': width, 'height': 1000})
        load()
        if width < 620 and page.locator('.inspector').is_visible():
            page.locator('#inspector-close').click()
        select('window')
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),
              f'{width}px reading has no page-level horizontal overflow')
        if width >= 736:
            graph_box, detail_box = page.locator('#feature-cards').bounding_box(), page.locator('#detail').bounding_box()
            check(detail_box['x'] >= graph_box['x'] + graph_box['width'] - 2,
                  f'{width}px reading retains the canvas-left inspector-right relationship')
        check(float(camera()[2]) == 1, f'{width}px initial tree retains readable text scale')
        page.screenshot(path=str(root / f'reading-{width}.png'), full_page=True)

    page.set_viewport_size({'width': 1440, 'height': 1000})
    load('stale.html')
    search(deep)
    show_code(deep)
    page.locator('.feature-code-node[data-mapping="deep-entry"]').click()
    check('已失效' in page.locator('#detail').inner_text() and page.locator('.feature-source').count() == 0,
          'tree navigation does not hide stale evidence or retarget it to current source')
    check(page.locator('.feature-review[data-decision="accepted"]').is_disabled(),
          'stale mapped evidence cannot be silently accepted')
    check(export_document('stale-reading-export.json') == original,
          'viewing stale code preserves original review decisions and evidence records')
    load('hostile.html')
    expand('window')
    check(page.locator('.feature-node-summary img').count() == 0 and page.evaluate('globalThis.treeReadingInjected') is None,
          'authored text remains inert through tree expansion')
    check(not errors, 'no browser exceptions or console errors during tree reading')
    check(not [url for url in requests if not url.startswith(('file:', 'blob:'))], 'offline reading makes no external requests')
    browser.close()

result = {'checks': len(passed), 'passed': passed, 'browserErrors': errors, 'navigation': 'file',
          'pointerPans': pan_count, 'featureCount': fixture['featureCount'],
          'scope': 'authored wide/deep/uneven tree reading; not runtime semantics or user usability acceptance'}
(root / 'tree-reading-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(result, ensure_ascii=False))
