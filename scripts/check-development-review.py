"""M3 acceptance through an actual loopback workspace and Chromium; target code is never run."""
import argparse
import json
import os
from pathlib import Path
import queue
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
args.output.mkdir(parents=True, exist_ok=True)
tool = Path(__file__).resolve().parents[1]
checks = []


def checked(label):
    checks.append(label)
    print('PASS: ' + label, flush=True)


def service(root, store):
    process = subprocess.Popen([args.node, str(tool / 'tests/helpers/development-review.mjs'), str(root), str(store)],
                               cwd=tool, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', env={**os.environ, 'NO_COLOR': '1'})
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        info = json.loads(lines.get(timeout=40))
    except Exception:
        process.kill()
        raise RuntimeError('Development-review fixture did not start: ' + process.stderr.read())
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


with tempfile.TemporaryDirectory(prefix='repographia-development-review-browser-') as temporary:
    temp = Path(temporary)
    project = temp / 'project'
    project.mkdir()
    store = temp / 'workspace'
    entry, audit, unowned = project / 'entry.ts', project / 'audit.ts', project / 'unowned.ts'
    entry.write_text('export function renderReport() { return "original"; }\n', encoding='utf-8')
    audit.write_text('export function auditLog() { return "audit"; }\n', encoding='utf-8')
    unowned.write_text('export function unrelated() { return 1; }\n', encoding='utf-8')
    (project / 'clean.ts').write_text('export function currentStatus() { return "ready"; }\n', encoding='utf-8')
    (project / 'excluded.ts').write_text('export const outside = true;\n', encoding='utf-8')
    (project / 'unsupported.py').write_text('# Inventory only; never execute.\n', encoding='utf-8')
    (project / 'tsconfig.json').write_text(json.dumps({'compilerOptions': {'target': 'ES2022', 'noLib': True},
                                                     'include': ['*.ts'], 'exclude': ['excluded.ts']}), encoding='utf-8')
    process, url = service(project, store)
    allowed_origins = {urlsplit(url).netloc}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
            context = browser.new_context(viewport={'width': 1440, 'height': 1080}, accept_downloads=True)
            page = context.new_page()
            errors, requests = [], []
            context.on('page', lambda opened: opened.on('pageerror', lambda error: errors.append(str(error))))
            page.on('pageerror', lambda error: errors.append(str(error)))
            context.on('request', lambda request: requests.append(request.url))
            page.goto(url)
            frame = page.frame_locator('#workspace-report')
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)
            expect(frame.locator('#viewer-startup')).to_have_count(0, timeout=30000)

            def api(route, data=None, status=200):
                address = urlsplit(url)
                headers = {'X-RepoGraphia-Token': parse_qs(address.fragment)['token'][0]}
                endpoint = address.scheme + '://' + address.netloc + route
                if data is None:
                    response = context.request.get(endpoint, headers=headers)
                else:
                    response = context.request.post(endpoint, headers={**headers, 'Content-Type': 'application/json'}, data=json.dumps(data))
                assert response.status == status, (response.status, response.text())
                return response.json()

            def current_review():
                state = api('/api/state')
                return api('/api/development-review?' + urlencode({'task': state['activeTaskId'],
                           'snapshot': state['latestSnapshot'], 'featureDigest': state['feature']['digest']}))

            def open_review():
                page.locator('#show-development-review').click()
                expect(page.locator('#review-context')).not_to_have_text('', timeout=20000)

            def category(name):
                page.locator('#review-categories [data-category="' + name + '"]').click()

            def item(kind, identifier):
                return page.locator(
                    '.review-list-item[data-item-kind="' + kind + '"][data-item-id="' + identifier + '"]')

            def save_review(reason, decision='reviewed'):
                page.locator('#review-record-kind').select_option('review')
                page.locator('#review-record-actor').fill('Browser human reviewer')
                page.locator('#review-record-decision').select_option(decision)
                page.locator('#review-record-reason').fill(reason)
                page.locator('#review-record-save').click()

            def edit_description(feature_id, summary):
                page.locator('#show-map').click()
                frame.locator('#features-tab').click()
                frame.locator('.feature-card[data-feature="' + feature_id + '"]').click()
                frame.locator('.feature-detail-tabs button[data-tab=review]').click()
                frame.get_by_role('button', name='编辑功能说明', exact=True).click()
                frame.get_by_label('编辑者（自述身份）', exact=True).fill('Browser annotation author')
                frame.get_by_label('本次修改理由', exact=True).fill('明确修改说明文字；没有宣称运行行为已经改变。')
                frame.get_by_label('一句解释（可选）', exact=True).fill(summary)
                frame.locator('.feature-save').click()
                expect(page.locator('#save-status')).to_contain_text('标注已保存', timeout=15000)

            def download_review(name):
                with page.expect_download() as event:
                    page.locator('#review-export').click()
                destination = args.output / name
                event.value.save_as(destination)
                return json.loads(destination.read_text(encoding='utf-8'))

            assert all(mapping['decision'] == 'accepted' for mapping in json.loads(frame.locator('#feature-data').text_content())['mappings'])
            page.locator('#start-task').click()
            page.locator('#task-title').fill('增加报告格式，并检查状态保持不变')
            page.locator('#task-intent-fields > summary').click()
            page.locator('#task-intent-goal').fill('让报告返回 CSV，同时保留状态显示。日志变化需另行核对。')
            page.locator('#task-intent-author').fill('Browser task author')
            page.locator('#task-intent-source').select_option('manual')
            page.locator('#task-target-features input[value="f-report"]').check()
            page.locator('#task-target-features input[value="f-clean"]').check()
            page.locator('#task-intent-checks').fill('报告格式需要人工核验\n状态显示需保持原含义')
            page.locator('#confirm-task').click()
            expect(page.locator('#task-dialog')).not_to_be_visible(timeout=30000)
            task = api('/api/state')['tasks'][-1]
            assert task['intent']['source'] == 'manual'
            assert task['intent']['author'] == 'Browser task author'
            assert set(task['intent']['featureIds']) == {'f-report', 'f-clean'}
            assert [check['id'] for check in task['intent']['checks']] == ['criterion-1', 'criterion-2']
            checked('a real development form freezes declared goal, exact feature scope, acceptance points and checked baseline')

            open_review()
            initial = current_review()
            assert initial['revision'] == 0 and not initial['records']
            assert initial['report']['summary']['changedFiles'] == 0
            expect(page.locator('#review-detail')).to_contain_text(task['intent']['goal'])
            assert page.locator('.review-layout').evaluate('(node) => getComputedStyle(node).gridTemplateColumns.split(" ").length') == 2
            assert page.evaluate('getComputedStyle(document.body).backgroundColor') != 'rgb(255, 255, 255)'
            checked('accepted feature mappings do not initialize development approval or verification; dark left/right overview remains readable')

            entry.write_text('export function renderReport() { return "CSV"; }\n', encoding='utf-8')
            audit.write_text('export function auditLog() { return "written"; }\n', encoding='utf-8')
            unowned.write_text('export function unrelated() { return 2; }\nexport function discovered() { return 3; }\n', encoding='utf-8')
            page.locator('#refresh-workspace').click()
            expect(page.locator('#open-latest')).to_be_visible(timeout=30000)
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == task['snapshot']
            page.locator('#open-latest').click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=15000)
            edit_description('f-report', '向调用者返回 CSV 格式的报告内容')
            open_review()
            changed = current_review()
            report = changed['report']
            assert report['before']['snapshot'] == task['snapshot']
            assert report['before']['featureDigest'] == task['featureDigest']
            assert report['after']['snapshot'] != task['snapshot']
            assert report['after']['featureDigest'] != task['featureDigest']
            features = {feature['id']: feature for feature in report['features']}
            assert features['f-report']['descriptionChanges']
            assert features['f-audit']['scope'] == 'outside-declared'
            assert features['f-audit']['affected']
            assert features['f-clean']['scope'] == 'declared' and not features['f-clean']['affected']
            assert any(file['path'] == 'unowned.ts' for file in report['unassigned'])
            assert changed['revision'] == 0 and not changed['records']
            category('features')
            item('feature', 'f-report').click()
            expect(page.locator('#review-detail')).to_contain_text('向调用者返回当前报告')
            expect(page.locator('#review-detail')).to_contain_text('向调用者返回 CSV 格式的报告内容')
            expect(page.locator('#review-detail')).to_contain_text('entry.ts')
            page.screenshot(path=str(args.output / 'development-review-feature.png'), full_page=True, animations='disabled')
            checked('fixed before/after code and annotation versions separate authored description changes from associated code changes')

            page.locator('#review-record-reason').fill('查看固定源码前写下、返回后需要继续填写的审阅草稿')
            page.locator('#review-detail').get_by_role('button', name='查看固定代码差异', exact=True).click()
            expect(page.locator('#changes-view')).to_be_visible()
            expect(page.locator('#change-detail .source-diff')).to_contain_text('original', timeout=15000)
            expect(page.locator('#change-detail .source-diff')).to_contain_text('CSV')
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == report['after']['snapshot']
            open_review()
            expect(page.locator('#review-record-reason')).to_have_value('查看固定源码前写下、返回后需要继续填写的审阅草稿')
            page.locator('#review-detail').get_by_role('button', name='查看起点功能', exact=True).click()
            expect(page.locator('#map-view')).to_be_visible()
            expect(page.locator('#save-status')).to_contain_text('只读', timeout=15000)
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == report['before']['snapshot']
            open_review()
            expect(page.locator('#review-record-reason')).to_have_value('查看固定源码前写下、返回后需要继续填写的审阅草稿')
            page.locator('#review-context').get_by_role('button', name='返回审阅版本继续记录', exact=True).click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=15000)
            expect(page.locator('#review-record-reason')).to_have_value('查看固定源码前写下、返回后需要继续填写的审阅草稿')
            expect(page.locator('#review-record-save')).to_be_enabled()
            page.locator('#review-record-cancel').click()
            category('features')
            checked('a review draft survives fixed source-diff and historical-feature navigation, then returns to its exact writable comparison')

            item('feature', 'f-audit').click()
            expect(page.locator('#review-detail')).to_contain_text('未在选定范围内')
            item('feature', 'f-clean').click()
            expect(page.locator('#review-detail')).to_contain_text('没有观察到记录变化')
            category('unassigned')
            item('file', 'unowned.ts').click()
            expect(page.locator('#review-detail')).to_contain_text('discovered')
            checked('explicit out-of-scope features, unchanged declared targets and unassigned code are visible without inferring task completion')

            category('features')
            item('feature', 'f-report').click()
            annotation_digest = api('/api/state')['feature']['digest']
            save_review('已看过这份固定差异；仍需单独核验 CSV 在实际场景中的表现。')
            expect(page.locator('#review-detail .review-records [data-record-kind=review]')).to_have_count(1, timeout=15000)
            saved = current_review()
            assert saved['revision'] == 1
            assert saved['records'][0]['kind'] == 'review'
            assert saved['records'][0]['target'] == {'kind': 'feature', 'id': 'f-report'}
            assert saved['records'][0]['comparisonDigest'] == report['comparisonDigest']
            assert api('/api/state')['feature']['digest'] == annotation_digest
            checked('manual development review appends only to its exact comparison and never changes feature mapping decisions')

            page.locator('#review-record-kind').select_option('verification')
            page.locator('#review-record-actor').fill('Browser human recorder')
            page.locator('#review-record-source').select_option('agent')
            page.locator('#review-record-author').fill('External fixture Agent (self-declared)')
            page.locator('#review-record-status').select_option('passed')
            method = 'node -e "require(\'fs\').writeFileSync(\'should-not-run\', \'1\')"'
            page.locator('#review-record-method').fill(method)
            page.locator('#review-record-evidence').fill('外部 Agent 自述通过；本条仅演示录入，没有执行命令，也没有独立复验。')
            page.locator('#review-record-save').click()
            expect(page.locator('#review-detail .review-records [data-record-kind=verification]')).to_have_count(1, timeout=15000)
            verified = current_review()
            assert verified['revision'] == 2
            assert verified['records'][-1]['kind'] == 'verification' and verified['records'][-1]['source'] == 'agent'
            assert verified['records'][-1]['method'] == method
            assert not (project / 'should-not-run').exists() and not (tool / 'should-not-run').exists()
            expect(page.locator('#review-detail')).to_contain_text('自述')
            checked('external verification is labeled as a declaration with preserved method/evidence and is never executed by the workspace')

            page.locator('#review-record-kind').select_option('note')
            page.locator('#review-record-actor').fill('Browser human recorder')
            page.locator('#review-record-source').select_option('agent')
            page.locator('#review-record-author').fill('External fixture Agent (self-declared)')
            inert_text = '<img src="https://invalid.example/m3.png" onerror="window.__m3Injected=true"> 这是 Agent 的解释，不是源代码事实。'
            page.locator('#review-record-text').fill(inert_text)
            page.locator('#review-record-save').click()
            expect(page.locator('#review-detail .review-records [data-record-kind=note]')).to_have_count(1, timeout=15000)
            assert current_review()['revision'] == 3
            expect(page.locator('#review-detail')).to_contain_text(inert_text)
            assert page.evaluate('window.__m3Injected === undefined')
            assert page.locator('#review-detail img').count() == 0
            checked('Agent explanations retain declared provenance and HTML-shaped content stays inert text')

            category('overview')
            item('criterion', 'criterion-1').click()
            expect(page.locator('#review-detail')).to_contain_text('报告格式需要人工核验')
            save_review('这个验收点仍需实际运行核验，记录与功能关联决定分开。', 'needs-work')
            expect(page.locator('#review-detail .review-records [data-record-kind=review]')).to_have_count(1, timeout=15000)
            criterion_review = current_review()
            assert criterion_review['revision'] == 4
            assert criterion_review['records'][-1]['target'] == {'kind': 'criterion', 'id': 'criterion-1'}
            assert criterion_review['records'][-1]['decision'] == 'needs-work'
            category('features')
            item('feature', 'f-report').click()
            checked('an acceptance point receives its own explicit human conclusion without changing feature review or external verification records')

            # Both pages inspect the same immutable comparison/revision. Only one append wins.
            page2 = context.new_page()
            page2.goto(url)
            expect(page2.locator('#save-status')).to_contain_text('标注已载入', timeout=20000)
            page2.locator('#show-development-review').click()
            expect(page2.locator('#review-context')).not_to_have_text('', timeout=20000)
            page2.locator('#review-categories [data-category=features]').click()
            page2.locator('.review-list-item[data-item-kind=feature][data-item-id=f-report]').click()
            page2.locator('#review-record-actor').fill('Second reviewer')
            page2.locator('#review-record-reason').fill('另页变化时要保留的审阅草稿')
            save_review('第一页面再次记录需要继续核验。', 'needs-work')
            expect(page.locator('#review-detail .review-records [data-record-kind=review]')).to_have_count(2, timeout=15000)
            assert current_review()['revision'] == 5
            page2.locator('#review-record-save').click()
            expect(page2.locator('#review-status')).to_contain_text('变化', timeout=15000)
            expect(page2.locator('#review-record-reason')).to_have_value('另页变化时要保留的审阅草稿')
            assert current_review()['revision'] == 5
            page2.close()
            checked('concurrent review appends use a comparison revision and preserve the losing page draft without overwriting history')

            old_review = current_review()
            page.locator('#review-record-actor').fill('Late reviewer')
            page.locator('#review-record-reason').fill('后台产生新版本时必须保留的旧版审阅草稿')
            entry.write_text('export function renderReport() { return "CSV next"; }\n', encoding='utf-8')
            page.locator('#refresh-workspace').click()
            expect(page.locator('#open-latest')).to_be_visible(timeout=30000)
            if page.locator('#review-record-save').is_enabled():
                page.locator('#review-record-save').click()
            expect(page.locator('#review-record-reason')).to_have_value('后台产生新版本时必须保留的旧版审阅草稿')
            assert not current_review()['records']
            stale = {'taskId': task['id'], 'snapshot': old_review['report']['after']['snapshot'],
                     'featureDigest': old_review['report']['after']['featureDigest'],
                     'comparisonDigest': old_review['report']['comparisonDigest'], 'expectedRevision': old_review['revision'],
                     'record': {'kind': 'review', 'target': {'kind': 'feature', 'id': 'f-report'},
                                'decision': 'reviewed', 'actor': 'Late reviewer', 'reason': '必须拒绝迟到的当前版本写入。'}}
            api('/api/development-review/records', stale, 409)
            page.screenshot(path=str(args.output / 'development-review-stale.png'), full_page=True, animations='disabled')
            checked('background code updates preserve the viewed review draft; stale API appends fail with 409 and do not approve newer code')

            page.locator('#review-record-cancel').click()
            page.locator('#open-latest').click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=15000)
            open_review()
            fresh_review = current_review()
            assert fresh_review['report']['comparisonDigest'] != report['comparisonDigest']
            assert fresh_review['revision'] == 0 and not fresh_review['records']
            category('features')
            item('feature', 'f-report').click()
            save_review('对新代码版本单独记录，旧结论没有自动沿用。', 'needs-work')
            expect(page.locator('#review-detail .review-records [data-record-kind=review]')).to_have_count(1, timeout=15000)
            assert current_review()['revision'] == 1
            second_digest = current_review()['report']['comparisonDigest']
            checked('a later code version starts unreviewed while its independently saved conclusion belongs to a new comparison')

            same_code = api('/api/state')['latestSnapshot']
            edit_description('f-clean', '保留原有状态返回，说明单独修订')
            open_review()
            annotations_changed = current_review()
            assert annotations_changed['report']['after']['snapshot'] == same_code
            assert annotations_changed['report']['comparisonDigest'] != second_digest
            assert annotations_changed['revision'] == 0 and not annotations_changed['records']
            checked('annotation-only changes also start a new unreviewed comparison even when the code snapshot is identical')

            # Hold a historical response while a new draft is entered in the current comparison.
            # Returning that response must neither replace nor strand the draft in another digest.
            held_history = []
            history_route = '**/api/development-reviews/' + report['comparisonDigest']
            def hold_history(route):
                held_history.append(route)
            page.route(history_route, hold_history)
            category('history')
            with page.expect_request(history_route):
                item('history', report['comparisonDigest']).click()
            category('features')
            page.locator('#review-record-reason').fill('历史读取尚未返回时新写下的草稿')
            assert held_history
            held_history[0].continue_()
            expect(page.locator('#review-status')).to_contain_text('读取历史记录期间出现了新的草稿', timeout=15000)
            expect(page.locator('#review-record-reason')).to_be_visible()
            expect(page.locator('#review-record-reason')).to_have_value('历史读取尚未返回时新写下的草稿')
            expect(page.locator('#review-context')).not_to_contain_text('只读')
            page.unroute(history_route, hold_history)
            page.locator('#review-record-cancel').click()
            checked('a delayed historical response cannot hide or rebind a draft entered after the request began')

            category('history')
            item('history', report['comparisonDigest']).click()
            expect(page.locator('#review-context')).to_contain_text('只读')
            expect(page.locator('#review-record-save')).to_have_count(0)
            historical = download_review('development-review-export.json')
            assert historical['report']['comparisonDigest'] == report['comparisonDigest']
            assert historical['report'] == old_review['report']
            assert historical['revision'] == 5 and len(historical['records']) == 5
            assert historical['records'][1]['source'] == 'agent'
            checked('historical reviews remain read-only and export the original fixed comparison plus distinct human and declared verification records')

            page.set_viewport_size({'width': 736, 'height': 980})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            assert page.locator('.review-layout').evaluate('(node) => getComputedStyle(node).gridTemplateColumns.split(" ").length') == 2
            page.set_viewport_size({'width': 390, 'height': 844})
            page.emulate_media(reduced_motion='reduce')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            assert page.locator('#review-detail').evaluate('(node) => node.getAnimations().every(animation => animation.playState !== "running")')
            page.screenshot(path=str(args.output / 'development-review-mobile.png'), full_page=True, animations='disabled')
            checked('the review keeps left/right reading at 736px, fits 390px and honors reduced-motion preferences')

            stop(process)
            process, url = service(project, store)
            allowed_origins.add(urlsplit(url).netloc)
            page.goto(url)
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)
            open_review()
            category('history')
            item('history', report['comparisonDigest']).click()
            expect(page.locator('#review-context')).to_contain_text('只读')
            restored = download_review('development-review-restored.json')
            assert restored['report'] == historical['report']
            assert restored['records'] == historical['records']
            assert api('/api/state')['tasks'][-1]['intent'] == task['intent']
            checked('service restart restores frozen task intent, immutable comparisons and append-only review records exactly')

            assert not errors, errors
            assert all(urlsplit(request).netloc in allowed_origins for request in requests if request.startswith('http')), requests
            assert not (project / 'should-not-run').exists() and not (tool / 'should-not-run').exists()
            checked('no browser exceptions, external requests, target execution or automatic Agent execution')
            context.close()
            browser.close()
    finally:
        stop(process)

result = {'checks': len(checks), 'passed': checks, 'browserExceptions': 0, 'externalRequests': 0}
(args.output / 'development-review-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
