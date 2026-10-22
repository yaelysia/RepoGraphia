"""Offline shared-shell regression: dark surfaces, stable layout, motion and navigation.

Uses the existing authored hierarchy fixture; no model calls or target execution.
The feature and project suites retain the detailed relation-membership assertions.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--chromium')
parser.add_argument('--set-content', action='store_true', help='Only for hosts blocking file:// navigation')
args = parser.parse_args()
root = args.directory.resolve()
passed, errors, requests = [], [], []


def check(value, name):
    assert value, name
    passed.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True,
                            color_scheme='light', reduced_motion='no-preference')
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))

    def load():
        report = root / 'workbench.html'
        if args.set_content:
            page.set_content(report.read_bytes().decode('utf8'), wait_until='load')
        else:
            page.goto(report.as_uri(), wait_until='load')
        expect(page.locator('.project-node').first).to_be_visible()

    def settle():
        page.wait_for_timeout(600)

    def motion(selector):
        return page.locator(selector).evaluate('''node => node.getAnimations({subtree:true})
            .filter(a => a.playState === 'running' && Number(a.effect.getTiming().duration) >= 150)
            .map(a => ({duration:Number(a.effect.getTiming().duration),
                        iterations:a.effect.getTiming().iterations, frames:a.effect.getKeyframes()}))''')

    def spatial_motion(selector):
        animations = motion(selector)
        return any(a['iterations'] == 1 and 150 <= a['duration'] <= 550
                   and any(f.get('transform') or f.get('clipPath') for f in a['frames'])
                   for a in animations)

    def shell_geometry():
        return {selector: page.locator(selector).bounding_box()
                for selector in ['.topbar', '.workbench-bar', '.workspace', '.inspector']}

    def same_shell(before, after):
        # Content may scroll independently; the frame and right reading pane should not jump.
        return all(before[s] is not None and after[s] is not None
                   and all(abs(before[s][key] - after[s][key]) <= 2 for key in ['x', 'y', 'width', 'height'])
                   for s in before)

    def dark_theme(surface):
        # Composite translucent surfaces over their ancestors before measuring luminance.
        # This deliberately accepts different palettes instead of pinning exact CSS values.
        return page.evaluate('''selector => {
            const rgba = value => {
                const parts = value.match(/[\\d.]+/g)?.map(Number) || [];
                return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] ?? 1];
            };
            const composite = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1-front[3]));
            const background = node => {
                const ancestors = []; for (let n = node; n; n = n.parentElement) ancestors.unshift(n);
                return ancestors.reduce((base, n) => composite(rgba(getComputedStyle(n).backgroundColor), base), [255,255,255]);
            };
            const luminance = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
                .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const body = document.body, node = document.querySelector(selector), style = getComputedStyle(body);
            const bg = luminance(background(body)), fg = luminance(rgba(style.color));
            return {scheme:style.colorScheme, body:bg, surface:luminance(background(node)),
                    contrast:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)};
        }''', surface)

    def navigation(opened):
        if page.locator('.navigator').is_visible() != opened:
            page.locator('#feature-tree-toggle' if opened else '#feature-tree-close').click()
        if opened:
            expect(page.locator('.navigator')).to_be_visible()
        else:
            expect(page.locator('.navigator')).to_be_hidden()

    def control_position(selector):
        return page.locator(selector).evaluate('''button => {
            const b = button.getBoundingClientRect(), p = document.querySelector('.map-panel').getBoundingClientRect();
            const x = b.left + b.width / 2, y = b.top + b.height / 2;
            return {x, y, reachable:b.width > 0 && b.height > 0
                && b.left >= Math.max(0,p.left) && b.right <= Math.min(innerWidth,p.right)
                && b.top >= Math.max(0,p.top) && b.bottom <= Math.min(innerHeight,p.bottom)
                && button.contains(document.elementFromPoint(x,y))};
        }''')

    def controls_reachable(prefix):
        selectors = [f'#{prefix}-zoom-out', f'#{prefix}-zoom-in', f'#{prefix}-fit']
        return all(control_position(selector)['reachable'] for selector in selectors)

    def canvas_controls(prefix):
        check(controls_reachable(prefix),
              f'{prefix} zoom and fit controls are reachable within the initial visible map panel')

        def click_control(selector):
            position = control_position(selector)
            assert position['reachable'], f'{selector} is clipped or covered'
            # A coordinate click cannot silently scroll a hidden toolbar into view.
            page.mouse.click(position['x'], position['y']); settle()

        viewport = page.locator(f'.{prefix}-viewport')
        initial = float(viewport.get_attribute('data-scale'))
        scroll = page.locator('.map-panel').evaluate('node => node.scrollTop')
        click_control(f'#{prefix}-zoom-in')
        enlarged = float(viewport.get_attribute('data-scale'))
        click_control(f'#{prefix}-zoom-out')
        reduced = float(viewport.get_attribute('data-scale'))
        click_control(f'#{prefix}-zoom-in')
        click_control(f'#{prefix}-fit')
        fitted = float(viewport.get_attribute('data-scale'))
        check(enlarged > initial and reduced < enlarged and fitted < enlarged
              and page.locator('.map-panel').evaluate('node => node.scrollTop') == scroll,
              f'{prefix} zoom and fit controls work without scrolling the panel')

    # System appearance must not silently change the authored dark workbench.
    for scheme in ['light', 'dark']:
        page.emulate_media(color_scheme=scheme)
        load(); settle()
        check(page.locator('body').get_attribute('data-view') == 'project'
              and not page.locator('.navigator').is_visible(),
              f'{scheme} system appearance starts in project mode with optional navigation closed')
        project_theme = dark_theme('.map-panel')
        check(project_theme['scheme'] == 'dark' and project_theme['body'] < .12
              and project_theme['surface'] < .16 and project_theme['contrast'] >= 4.5,
              f'{scheme} system appearance keeps project surfaces dark and body text readable')
        frame = shell_geometry()
        check(page.locator('#project-tab').is_visible() and page.locator('#features-tab').is_visible(),
              f'{scheme} system appearance exposes both primary modes without opening navigation')
        if scheme == 'light':
            page.screenshot(path=str(root / 'shell-project-dark.png'), full_page=True)
            canvas_controls('project')
        page.locator('#features-tab').click()
        if scheme == 'light':
            check(spatial_motion('#feature-view'), 'mode entry has a finite spatial transition')
        settle()
        feature_theme = dark_theme('.feature-card')
        check(feature_theme['scheme'] == 'dark' and feature_theme['body'] < .12
              and feature_theme['surface'] < .16 and feature_theme['contrast'] >= 4.5,
              f'{scheme} system appearance keeps feature cards dark and body text readable')
        check(same_shell(frame, shell_geometry()),
              f'{scheme} system appearance preserves header, toolbar, workspace and inspector positions across modes')
        check(not motion('#feature-view'), f'{scheme} system appearance leaves no running mode animation')
        if scheme == 'light':
            page.screenshot(path=str(root / 'shell-features-dark.png'), full_page=True)
            canvas_controls('feature')

    graph_before = page.locator('#graph-data').text_content()
    feature_before = page.locator('#feature-data').text_content()
    graph = json.loads(graph_before)

    # A mode visit is not a request to reset the selected directory or evidence filters.
    page.locator('#project-tab').click(); settle()
    page.locator('#kind').select_option('call')
    page.locator('#status').select_option('bound')
    page.locator('.project-node[data-path="src"]').focus()
    page.locator('.project-node[data-path="src"]').press('Enter')
    check(page.locator('.project-node[data-path="src"]').get_attribute('aria-pressed') == 'true'
          and page.evaluate('document.activeElement?.dataset.path') == 'src',
          'keyboard project selection retains focus after the selected node is redrawn')
    page.locator('.project-drill').click()
    check(spatial_motion('#project-view'), 'project directory entry has a finite spatial transition')
    settle()
    check(page.locator('#project-summary').get_attribute('data-scope') == 'src',
          'project directory entry uses the original directory scope')
    page.locator('#search').fill('start')
    page.locator('.project-node[data-path="src/start.ts"]').click(); settle()
    selection = page.locator('#detail h3').first.inner_text()
    membership = page.locator('.project-evidence').evaluate_all('rows => rows.map(row => row.dataset.relation)')
    page.locator('#features-tab').click(); settle()
    page.locator('#project-tab').click(); settle()
    check(page.locator('#project-summary').get_attribute('data-scope') == 'src'
          and page.locator('#detail h3').first.inner_text() == selection
          and page.locator('.project-node[data-path="src/start.ts"]').get_attribute('aria-pressed') == 'true',
          'returning from features restores the project scope and selected group')
    check(page.locator('#kind').input_value() == 'call' and page.locator('#status').input_value() == 'bound'
          and page.locator('#search').input_value() == 'start'
          and page.locator('.project-evidence').evaluate_all('rows => rows.map(row => row.dataset.relation)') == membership,
          'returning from features retains search, relation filters and the selected evidence membership')
    relation = next(edge for edge in graph['relations'] if edge['id'] == 'edge:start-finish')
    page.locator('.project-evidence[data-relation="edge:start-finish"]').click()
    detail = page.locator('#detail').inner_text()
    check(relation['id'] in detail and relation['evidence']['location']['file'] in detail
          and relation['evidence']['fileHash'] in detail and '解析依据' in detail,
          'project evidence still opens the exact original relation, source location and hash')
    page.locator('.project-back').click()
    check(page.locator('#detail h3').first.inner_text() == selection,
          'returning from original evidence restores the selected project group')
    page.locator('.project-drill').click(); settle()
    check(page.locator('#local-view').is_visible() and 'src/start.ts' in page.locator('#detail').inner_text(),
          'project-to-file navigation retains the original local source explorer')
    page.locator('#project-tab').click(); settle()
    check(page.locator('#project-summary').get_attribute('data-scope') == 'src',
          'returning from local source restores the current project directory')
    page.locator('#project-parent').click()
    check(spatial_motion('#project-view'), 'project parent return has a finite spatial transition')
    settle()
    check(page.locator('#project-summary').get_attribute('data-scope') == '' and not motion('#project-view'),
          'project parent return finishes at root without a leftover transition')

    # Rapid mode reversals cancel obsolete transitions instead of leaving overlay layers.
    page.locator('#features-tab').dispatch_event('click'); page.wait_for_timeout(55)
    page.locator('#project-tab').dispatch_event('click'); page.wait_for_timeout(55)
    page.locator('#features-tab').dispatch_event('click'); settle()
    check(page.locator('body').get_attribute('data-view') == 'features'
          and page.locator('#feature-view').is_visible() and not page.locator('#project-view').is_visible()
          and not motion('.workspace'),
          'rapid mode reversals end in the requested mode without running transition layers')
    page.emulate_media(reduced_motion='reduce')
    page.locator('#project-tab').click()
    check(page.locator('#project-view').is_visible() and not motion('.workspace'),
          'reduced-motion mode changes finish immediately')
    page.locator('.project-node[data-path="src"]').click()
    page.locator('.project-drill').click()
    check(page.locator('#project-summary').get_attribute('data-scope') == 'src' and not motion('#project-view'),
          'reduced-motion project directory entry finishes immediately')
    page.locator('#project-parent').click()
    check(page.locator('#project-summary').get_attribute('data-scope') == '' and not motion('#project-view'),
          'reduced-motion project parent return finishes immediately')
    page.emulate_media(reduced_motion='no-preference')

    for width in [1024, 736, 430]:
        page.set_viewport_size({'width': width, 'height': 900})
        load(); settle()
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),
              f'{width}px project shell has no page-level horizontal overflow')
        check(controls_reachable('project'),
              f'{width}px project zoom and fit controls remain fully reachable in the visible panel')
        if width < 620:
            check(not page.locator('.inspector').is_visible(),
                  'narrow project view leaves the canvas available until a detail is requested')
            page.locator('.project-node[data-path="src"]').click()
            expect(page.locator('.inspector')).to_be_visible()
            page.locator('#features-tab').click(); page.locator('#project-tab').click(); settle()
            check(page.locator('.inspector').is_visible()
                  and page.locator('.project-node[data-path="src"]').get_attribute('aria-pressed') == 'true',
                  'narrow mode return retains an explicitly opened project detail')
            page.locator('#inspector-close').click()
            check(not page.locator('.inspector').is_visible(), 'narrow project details open and close without losing the canvas')
            page.locator('#inspector-toggle').click()
            page.locator('.project-drill').click(); settle()
            check(page.locator('#project-summary').get_attribute('data-scope') == 'src'
                  and not page.locator('.inspector').is_visible(),
                  'narrow explicit directory entry reveals the new map by closing the detail drawer')
            page.locator('#features-tab').click(); page.locator('#project-tab').click(); settle()
            check(page.locator('#project-summary').get_attribute('data-scope') == 'src'
                  and not page.locator('.inspector').is_visible(),
                  'narrow mode return retains the directory and its closed-detail preference')
        navigation(True)
        page.locator('#files-tab').click()
        check(page.locator('body').get_attribute('data-view') == 'files'
              and page.locator('#search').is_visible(),
              f'{width}px navigation can reach the original file explorer and search')
        navigation(False)
        page.locator('#features-tab').click(); settle()
        check(page.locator('#feature-search').is_visible() and page.locator('#features-tab').is_visible()
              and page.locator('#project-tab').is_visible(),
              f'{width}px features retain global search and both primary mode controls')
        check(controls_reachable('feature'),
              f'{width}px feature zoom and fit controls remain fully reachable in the visible panel')
        page.locator('.feature-card[data-feature="window"]').click(); settle()
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),
              f'{width}px selected feature has no page-level horizontal overflow')
        if width >= 736:
            canvas = page.locator('.map-panel').bounding_box()
            detail = page.locator('.inspector').bounding_box()
            check(detail['x'] >= canvas['x'] + canvas['width'] - 2,
                  f'{width}px keeps the shared reading pane to the right of the canvas')
        else:
            expect(page.locator('.inspector')).to_be_visible()
            page.locator('#inspector-close').click()
            check(not page.locator('.inspector').is_visible(), 'narrow feature details can return to the same graph')
            page.locator('#inspector-toggle').click()
            check(page.locator('.inspector').is_visible() and '窗口' in page.locator('#detail h3').first.inner_text(),
                  'narrow reading-pane toggle restores the selected feature')
            page.locator('#inspector-close').click()
            page.locator('#project-tab').click(); page.locator('#features-tab').click(); settle()
            check(not page.locator('.inspector').is_visible()
                  and page.locator('.feature-card[data-feature="window"]').get_attribute('aria-pressed') == 'true',
                  'narrow mode return retains the selected feature and its closed-detail preference')
        navigation(True); navigation(False)
        check(not page.locator('.navigator').is_visible(), f'{width}px optional navigation opens and closes in feature mode')
        page.screenshot(path=str(root / f'shell-{width}.png'), full_page=True)

    # Save reading position before a destination mode hides the shared inspector.
    page.set_viewport_size({'width': 736, 'height': 800})
    load(); settle()
    page.locator('#inspector-close').click()
    page.locator('#features-tab').click()
    page.locator('.feature-card[data-feature="window"]').click()
    description = page.locator('.feature-description')
    if description.get_attribute('open') is None:
        description.locator('summary').click()
    reading_position = page.locator('.inspector').evaluate('''node => {
        node.scrollTop = Math.min(160, node.scrollHeight - node.clientHeight);
        return node.scrollTop;
    }''')
    assert reading_position > 0, 'the long-description fixture must exercise a real reading scroll'
    page.locator('#project-tab').click()
    destination_closed = not page.locator('.inspector').is_visible()
    page.locator('#features-tab').click(); settle()
    check(destination_closed and abs(page.locator('.inspector').evaluate('node => node.scrollTop') - reading_position) <= 2
          and page.locator('.feature-description').get_attribute('open') is not None
          and page.locator('.feature-card[data-feature="window"]').get_attribute('aria-pressed') == 'true',
          'long feature reading position survives a mode whose inspector is closed')

    # Exercise mode navigation against exported state as well as inert embedded JSON.
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.locator('#project-tab').click(); page.locator('#features-tab').click(); settle()
    check(page.locator('#graph-data').text_content() == graph_before,
          'shared-shell navigation never mutates embedded code graph data')
    check(page.locator('#feature-data').text_content() == feature_before,
          'shared-shell navigation never rewrites embedded feature annotations')
    if not page.locator('.inspector').is_visible():
        page.locator('#inspector-toggle').click()
    documents = page.locator('.feature-document-tools')
    if documents.get_attribute('open') is None:
        documents.locator('summary').first.click()
    with page.expect_download() as download:
        page.locator('#feature-export').click()
    exported = root / 'shell-export.json'
    download.value.save_as(exported)
    check(json.loads(exported.read_bytes().decode('utf8')) == json.loads((root / 'features.json').read_bytes().decode('utf8')),
          'export after shared-shell navigation retains authored hierarchy, review state and history')
    check(not errors, 'shared-shell interactions produce no browser exceptions')
    check(not [url for url in requests if not url.startswith(('file:', 'blob:'))],
          'shared-shell interactions make no external requests')
    browser.close()

result = {'checks': len(passed), 'passed': passed, 'browserErrors': errors,
          'navigation': 'set-content' if args.set_content else 'file',
          'scope': 'offline shared-shell appearance, motion and navigation; not runtime semantics'}
(root / 'shell-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(result, ensure_ascii=False))
