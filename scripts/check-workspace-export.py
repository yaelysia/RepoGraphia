"""Workspace reference export regression through real loopback and file:// browsers; no target runs."""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, urlencode, urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('--chromium')
parser.add_argument('--node', default='node')
args = parser.parse_args()
args.output = args.output.resolve()
args.output.mkdir(parents=True, exist_ok=True)
tool = Path(__file__).resolve().parents[1]
checks = []


def checked(label):
    checks.append(label)
    print('PASS: '+label, flush=True)


def service(root, store):
    process = subprocess.Popen([args.node, str(tool / 'tests/helpers/workspace-export.mjs'), str(root), str(store)],
                               cwd=tool, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', env={**os.environ, 'NO_COLOR':'1'})
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        info = json.loads(lines.get(timeout=30))
    except Exception:
        process.kill()
        raise RuntimeError('Export fixture did not start: '+process.stderr.read())
    return process, info['url']


def stop(process):
    if process.poll() is not None:
        return
    process.stdin.close()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def embedded(html, identifier):
    match = re.search(r'<script id="'+identifier+r'" type="application/json">(.*?)</script>', html, re.S)
    assert match, 'Missing embedded '+identifier
    return json.loads(match.group(1))


def tools_open(surface):
    if not surface.locator('.feature-document-tools').evaluate('(node) => node.open'):
        surface.locator('.feature-document-tools > summary').click()


def feature_card(surface, identifier):
    return surface.locator('.feature-scene-layer:not(.feature-motion-ghost) .feature-card[data-feature="'+identifier+'"]')


def mapping_open(surface, identifier='entry'):
    surface.locator('#features-tab').click()
    surface.locator('#feature-breadcrumb').get_by_role('button', name='全部功能', exact=True).click()
    # The overview retains its camera after paging or a scope visit. Locate the
    # requested feature through the same global search available to readers.
    surface.locator('#feature-search').fill('f-'+identifier)
    surface.locator('.feature-search-result[data-feature="f-'+identifier+'"]').click()
    feature_card(surface, 'f-'+identifier).click()
    surface.locator('.feature-detail-actions').get_by_role('button', name='关联代码', exact=True).click()
    card = surface.locator('.feature-code-node[data-mapping="m-'+identifier+'"]')
    card.click()
    return card


def annotation_download(page, name):
    tools_open(page)
    with page.expect_download() as downloaded:
        page.locator('#feature-export').click()
    file = args.output / name
    downloaded.value.save_as(file)
    return json.loads(file.read_text(encoding='utf-8'))


with tempfile.TemporaryDirectory(prefix='repographia-export-browser-') as temporary:
    temp = Path(temporary)
    project = temp / 'project'
    project.mkdir()
    unrelated = project / 'a-unrelated.ts'
    unrelated_text = 'export function unrelated() { return "unrelated"; }\n'
    unrelated.write_text(unrelated_text, encoding='utf-8')
    (project / 'b-leaf.ts').write_text('export function leaf() { return 1; }\n', encoding='utf-8')
    entry = project / 'c-entry.ts'
    entry_text = 'import { leaf } from "./b-leaf";\nexport function entry(handler: () => number) { return handler(); }\nentry(leaf);\n'
    entry.write_text(entry_text, encoding='utf-8')
    (project / 'd-support.ts').write_text('export function support() { return "stored"; }\n', encoding='utf-8')
    (project / 'tsconfig.json').write_text(json.dumps({'compilerOptions':{'target':'ES2022', 'module':'ESNext',
        'moduleResolution':'Bundler', 'strict':True, 'types':[]}, 'include':['*.ts']}), encoding='utf-8')
    process, url = service(project, temp / 'workspace')
    address = urlsplit(url)
    token = parse_qs(address.fragment)['token'][0]
    origin = address.scheme+'://'+address.netloc
    errors, live_requests, offline_requests = [], [], []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, **({'executable_path':args.chromium} if args.chromium else {}))
            context = browser.new_context(viewport={'width':1440, 'height':1050}, accept_downloads=True)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: live_requests.append(request.url))
            page.goto(url)
            frame = page.frame_locator('#workspace-report')
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)
            expect(frame.locator('#viewer-startup')).to_have_count(0)
            original = json.loads(frame.locator('#feature-data').text_content())
            original_graph = json.loads(frame.locator('#graph-data').text_content())
            assert all(item['decision'] == 'proposed' for item in original['mappings'])

            def api(route):
                response = context.request.get(origin+route, headers={'X-RepoGraphia-Token':token})
                assert response.ok, response.text()
                return response.json()

            def refresh_selected():
                page.locator('#refresh-workspace').click()
                expect(page.locator('#open-latest')).to_be_visible(timeout=30000)
                state = api('/api/state')
                selected_snapshot = state['latestSnapshot']
                page.locator('#open-latest').click()
                # The old frame already satisfies the generic ready conditions while
                # /api/report is in flight. Wait for the requested graph identity first.
                page.wait_for_function('''snapshot => {
                    const data = document.querySelector('#workspace-report')?.contentDocument?.getElementById('graph-data');
                    try { return !!data && JSON.parse(data.textContent).project.snapshot === snapshot; }
                    catch { return false; }
                }''', arg=selected_snapshot, timeout=30000)
                expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)
                expect(frame.locator('#viewer-startup')).to_have_count(0)
                graph = json.loads(frame.locator('#graph-data').text_content())
                assert graph['project']['snapshot'] == selected_snapshot
                work = api('/api/feature-work?'+urlencode({'snapshot':selected_snapshot,
                                                        'featureDigest':state['feature']['digest']}))
                return graph, work['references']

            def export_report(name):
                with page.expect_download() as downloaded:
                    page.locator('#export-report').click()
                file = args.output / name
                downloaded.value.save_as(file)
                html = file.read_text(encoding='utf-8')
                assert 'id="workspace-data"' not in html
                assert 'function createWorkspaceBridge(' not in html
                assert token not in html
                assert "connect-src 'none'" in html
                return file, html

            unrelated.write_text(unrelated_text+'unrelated();\n', encoding='utf-8')
            matched_graph, matched_refs = refresh_selected()
            assert matched_graph['project']['snapshot'] != original['basis']['snapshot']
            assert matched_refs['summary']['matched'] == 2
            candidate = next(item for item in matched_refs['mappings'] if item['id'] == 'm-entry')
            assert 'evidence-candidate' in candidate['warnings']
            assert 'incomplete-value-origins' in candidate['warnings']
            original_edge = next(item for item in original['mappings'] if item['id'] == 'm-entry')['evidence'][0]['relationId']
            assert candidate['current']['relationIds'][0] != original_edge, 'Fixture must exercise real relation ID churn.'
            checked('unrelated saved code changes the snapshot and relation IDs while exact candidate references remain matched')

            matched_file, matched_html = export_report('workspace-export-matched.html')
            assert embedded(matched_html, 'feature-reference-data') == matched_refs
            assert embedded(matched_html, 'feature-data') == original
            assert embedded(matched_html, 'graph-data') == matched_graph
            checked('UI export pins checked references to the selected graph and preserves original proposals and history')

            graph_file, feature_file, strict_file = temp / 'graph.json', temp / 'features.json', temp / 'strict.html'
            graph_file.write_text(json.dumps(matched_graph), encoding='utf-8')
            feature_file.write_text(json.dumps(original), encoding='utf-8')
            subprocess.run([args.node, str(tool / 'dist/cli.js'), 'features', 'render', str(graph_file), str(feature_file),
                            '--out', str(strict_file)], cwd=tool, check=True, capture_output=True, text=True, encoding='utf-8')

            entry.write_text(entry_text.replace('return handler();', 'return handler() + 1;'), encoding='utf-8')
            changed_graph, changed_refs = refresh_selected()
            assert changed_graph['project']['snapshot'] != matched_graph['project']['snapshot']
            assert changed_refs['summary']['matched'] == 1 and changed_refs['summary']['needsReview'] == 1
            changed = next(item for item in changed_refs['mappings'] if item['id'] == 'm-entry')
            assert changed['status'] == 'needs-review' and 'current' not in changed
            changed_file, changed_html = export_report('workspace-export-needs-review.html')
            assert embedded(changed_html, 'feature-reference-data') == changed_refs
            assert embedded(changed_html, 'feature-data') == original
            checked('mapped source changes export a real needs-review result without a current navigation target')
            assert api('/api/state')['feature']['digest'] == matched_refs['featureDigest']
            page.close()
            stop(process)
            assert process.poll() == 0, f'Workspace fixture exited {process.poll()}: {process.stderr.read()}'
            checked('workspace service is stopped before standalone file browsing')

            offline = context.new_page()
            offline.on('pageerror', lambda error: errors.append(str(error)))
            offline.on('request', lambda request: offline_requests.append(request.url))

            def open_offline(file):
                offline.goto(file.as_uri())
                expect(offline.locator('#viewer-startup')).to_have_count(0)
                offline.locator('#features-tab').click()
                tools_open(offline)

            open_offline(matched_file)
            expect(offline.locator('#feature-summary')).to_contain_text('导出版本引用核对')
            expect(offline.locator('#feature-summary')).to_contain_text('2 条匹配')
            expect(offline.locator('#feature-summary')).not_to_contain_text('失效')
            expect(feature_card(offline, 'f-entry')).to_contain_text('引用已核对')
            expect(feature_card(offline, 'f-support')).to_have_count(0)
            offline.get_by_role('button', name=re.compile(r'^显示更多功能')).click()
            expect(feature_card(offline, 'f-support')).to_contain_text('引用已核对')
            expect(feature_card(offline, 'f-entry')).to_contain_text('引用已核对')
            expect(feature_card(offline, 'f-support')).not_to_contain_text('失效')
            checked('feature pagination retains checked reference labels on both existing and newly displayed cards')
            card = mapping_open(offline)
            expect(card).to_contain_text('依据匹配')
            expect(card).not_to_contain_text('已失效')
            expect(card).to_have_attribute('data-current', 'false')
            expect(card).to_have_attribute('data-reference-status', 'matched')
            expect(offline.locator('#detail')).to_contain_text('依据匹配')
            expect(offline.locator('#detail')).to_contain_text('待审提案')
            expect(offline.locator('#detail')).to_contain_text('依赖候选关系')
            offline.locator('.feature-detail-tabs button[data-tab=evidence]').click()
            offline.locator('.feature-warning-details > summary').click()
            expect(offline.locator('.feature-warning-details')).to_contain_text('来源集合不完整')
            offline.locator('.feature-evidence-details > summary').click()
            offline.locator('.feature-evidence-details .feature-evidence').click()
            expect(offline.locator('#detail')).to_contain_text(candidate['current']['relationIds'][0])
            expect(offline.locator('#detail .badge.candidate')).to_have_count(1)
            offline.locator('.feature-back').click()
            offline.locator('.feature-detail-tabs button[data-tab=review]').click()
            offline.locator('.feature-review-details > summary').click()
            expect(offline.locator('.feature-review[data-decision=accepted]')).to_be_disabled()
            offline.locator('.feature-detail-tabs button[data-tab=about]').click()
            checked('offline summary, feature cards, code nodes and inspector agree while candidate limits and stale acceptance protection remain')

            offline.get_by_role('button', name='查看核对后的代码依据', exact=True).click()
            expect(offline.locator('#detail h3')).to_have_text('entry')
            expect(offline.locator('#detail')).to_contain_text(candidate['current']['nodeId'])
            expect(offline.locator('#detail .code')).to_contain_text('return handler();')
            offline.locator('.feature-back').click()
            expect(offline.locator('#detail')).to_contain_text('依据匹配')
            offline.screenshot(path=str(args.output / 'workspace-export-matched.png'), full_page=True, animations='disabled')
            assert annotation_download(offline, 'offline-original-features.json') == original
            checked('checked-code navigation uses the pinned current target, returns to the mapping and exports unchanged annotation JSON')

            invalid_file = temp / 'invalid.json'
            invalid_file.write_text('{"schemaVersion":999}', encoding='utf-8')
            offline.locator('#feature-import').set_input_files(invalid_file)
            expect(offline.locator('#feature-notice')).to_contain_text('导入失败')
            expect(offline.locator('#feature-summary')).to_contain_text('导出版本引用核对')
            assert annotation_download(offline, 'offline-after-invalid-import.json') == original
            checked('failed annotation import preserves both the existing document and its frozen reference check')

            replacement = json.loads(json.dumps(original))
            replacement['features'][0]['title'] = '导入后的独立说明'
            replacement_file = temp / 'replacement.json'
            replacement_file.write_text(json.dumps(replacement, ensure_ascii=False), encoding='utf-8')
            offline.locator('#feature-import').set_input_files(replacement_file)
            expect(offline.locator('#feature-notice')).to_contain_text('已导入')
            expect(offline.locator('#feature-summary')).not_to_contain_text('导出版本引用核对')
            expect(offline.locator('#feature-summary')).to_contain_text('2 条失效')
            mapping_open(offline)
            expect(offline.get_by_role('button', name='查看核对后的代码依据', exact=True)).to_have_count(0)
            assert annotation_download(offline, 'offline-after-import.json') == replacement
            checked('successful import with reused mapping IDs invalidates frozen checks and cannot retain checked-code navigation')

            open_offline(matched_file)
            feature_card(offline, 'f-entry').click()
            offline.locator('.feature-detail-tabs button[data-tab=review]').click()
            offline.get_by_role('button', name='编辑功能说明', exact=True).click()
            offline.get_by_label('编辑者（自述身份）', exact=True).fill('offline browser reviewer')
            offline.get_by_label('本次修改理由', exact=True).fill('Change this exported annotation only.')
            offline.get_by_label('功能名称', exact=True).fill('离线修改后的说明')
            offline.locator('.feature-save').click()
            expect(offline.locator('#feature-summary')).not_to_contain_text('导出版本引用核对')
            expect(offline.locator('#feature-summary')).to_contain_text('2 条失效')
            modified = annotation_download(offline, 'offline-edited-features.json')
            assert modified['revision'] == original['revision'] + 1
            assert modified['basis'] == original['basis']
            assert all(item['decision'] == 'proposed' for item in modified['mappings'])
            assert modified['history'][:-1] == original['history']
            checked('offline edits clear frozen checks, preserve original basis and proposed decisions, and append ordinary history')

            open_offline(matched_file)
            old_graph_file = temp / 'original-graph.json'
            old_graph_file.write_text(json.dumps(original_graph), encoding='utf-8')
            offline.locator('#feature-migrate').click()
            offline.locator('#migration-old-graph').set_input_files(old_graph_file)
            expect(offline.locator('#feature-notice')).to_contain_text('已生成只读迁移计划')
            support_row = offline.locator('.migration-row[data-mapping="m-support"]')
            expect(support_row).to_have_attribute('data-status', 'reusable')
            support_row.click()
            offline.get_by_label('编辑者（自述身份）', exact=True).fill('offline migration reviewer')
            offline.get_by_label('本次修改理由', exact=True).fill('Carry the independent support anchor; defer the candidate mapping.')
            offline.get_by_label('迁移动作', exact=True).select_option('carry')
            offline.locator('.migration-record').click()
            offline.locator('.migration-prepare').click()
            assert offline.locator('.migration-confirm').count(), offline.locator('#feature-notice').inner_text()
            offline.locator('.migration-confirm').click()
            expect(offline.locator('#feature-notice')).to_contain_text('迁移已确认')
            expect(offline.locator('#feature-summary')).not_to_contain_text('导出版本引用核对')
            migrated = annotation_download(offline, 'offline-migrated-features.json')
            assert migrated['revision'] == original['revision'] + 1
            assert migrated['basis']['snapshot'] == matched_graph['project']['snapshot']
            assert next(item for item in migrated['mappings'] if item['id'] == 'm-entry')['basis'] == original['basis']
            assert next(item for item in migrated['mappings'] if item['id'] == 'm-support')['basis']['snapshot'] == matched_graph['project']['snapshot']
            assert all(item['decision'] == 'proposed' for item in migrated['mappings'])
            checked('explicit migration invalidates exported reference context while deferred original evidence remains unchanged')

            open_offline(changed_file)
            expect(offline.locator('#feature-summary')).to_contain_text('1 条匹配')
            expect(offline.locator('#feature-summary')).to_contain_text('1 条需复核')
            card = mapping_open(offline)
            expect(card).to_contain_text('需要复核')
            expect(offline.locator('#detail')).to_contain_text('需要复核')
            expect(offline.get_by_role('button', name='查看核对后的代码依据', exact=True)).to_have_count(0)
            expect(offline.locator('.feature-source')).to_have_count(0)
            offline.screenshot(path=str(args.output / 'workspace-export-needs-review.png'), full_page=True, animations='disabled')
            checked('standalone changed-source report keeps review-needed status and blocks guessed source navigation')

            open_offline(strict_file)
            expect(offline.locator('#feature-summary')).to_contain_text('2 条失效')
            expect(offline.locator('#feature-summary')).not_to_contain_text('导出版本引用核对')
            assert offline.locator('#feature-reference-data').count() == 0
            checked('ordinary graph-plus-annotations CLI rendering retains strict snapshot validity without exported reference context')

            assert not errors, errors
            assert all(urlsplit(request).netloc == address.netloc for request in live_requests if request.startswith('http')), live_requests
            assert not [request for request in offline_requests if urlsplit(request).scheme not in ('file', 'data', 'blob')], offline_requests
            checked('all reports run without browser exceptions, external requests, live bridge or workspace credentials')
            context.close()
            browser.close()
    finally:
        stop(process)

result = {'checks':len(checks), 'passed':checks, 'navigation':'file', 'browserExceptions':0, 'externalRequests':0}
(args.output / 'workspace-export-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
