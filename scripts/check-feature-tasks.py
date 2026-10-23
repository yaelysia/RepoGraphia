"""M2 tasks and M4 proposal reading through loopback; fixture sources and Agent text are data only."""
import argparse
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit
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
    process = subprocess.Popen([args.node, str(tool / 'tests/helpers/feature-tasks.mjs'), str(root), str(store)],
                               cwd=tool, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', env={**os.environ, 'NO_COLOR': '1'})
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        info = json.loads(lines.get(timeout=30))
    except Exception:
        process.kill()
        raise RuntimeError('Feature-task fixture did not start: ' + process.stderr.read())
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


def revision(bundle, batch, title='导出报告', revise=False, child=False, retract=False):
    task = bundle['task']
    node = next(item for item in bundle['graph']['nodes'] if item['kind'] == 'function' and item['name'] == 'renderReport')
    value = {'revisionProtocol': 1, 'taskId': task['id'], 'taskDigest': bundle['taskDigest'],
             'snapshot': task['basis']['snapshot'], 'baseDigest': task['featureDigest'], 'expectedRevision': task['featureRevision'],
             'batchId': batch, 'summary': title + '的可审阅功能提案', 'features': [], 'mappings': [], 'retractions': [],
             'checks': [], 'exploredFiles': ['entry.ts'], 'unexplored': ['未验证任何运行时行为，也未运行项目。']}
    if retract:
        value['retractions'] = [{'mappingId': 'm-report', 'reason': '人工演示撤销提案，保留原记录历史。'}]
        return value
    item = {'id': 'f-report', 'title': title, 'summary': '将当前报告内容交给调用者',
            'description': '依据固定源码中的返回值提出的有限功能解释。', 'questions': ['没有运行验证，实际场景需要另行确认。']}
    value['features'].append({'action': 'revise' if revise else 'add', 'feature': item, 'reason': '依据本次固定代码范围明确功能解释。'})
    value['mappings'].append({'action': 'replace' if revise else 'add', 'id': 'm-report', 'featureId': item['id'],
                             'nodeId': node['id'], 'role': 'implementation', 'rationale': '该声明包含报告返回实现。',
                             'relationIds': [], 'reason': '使用本次图中的精确声明锚点。'})
    touched = [item['id']]
    if child:
        value['features'].append({'action': 'add', 'feature': {'id': 'f-content', 'title': '准备报告内容',
                                  'summary': '整理要返回的内容', 'description': '仅对固定函数内的返回动作继续细分。',
                                  'parentId': 'f-report', 'questions': []}, 'reason': '沿已有功能继续拆分一层。'})
        value['mappings'].append({'action': 'add', 'id': 'm-content', 'featureId': 'f-content', 'nodeId': node['id'],
                                 'role': 'implementation', 'rationale': '精确关联同一函数，但没有推断功能依赖。',
                                 'relationIds': [], 'reason': '为子功能提供独立显式关联。'})
        touched.append('f-content')
    for feature_id in touched:
        value['checks'].extend([
            {'featureId': feature_id, 'nodeId': node['id'], 'kind': 'support', 'quote': 'return "original";',
             'explanation': '函数源码明确返回这段内容。'},
            {'featureId': feature_id, 'nodeId': node['id'], 'kind': 'limit', 'quote': 'function renderReport()',
             'explanation': '这里只引用函数声明和固定源码，不能证明调用后的运行结果。'}])
    return value


with tempfile.TemporaryDirectory(prefix='repographia-feature-task-browser-') as temporary:
    temp = Path(temporary)
    project = temp / 'project'
    project.mkdir()
    store = temp / 'workspace'
    (project / 'entry.ts').write_text('export function renderReport() { return "original"; }\nrenderReport();\n', encoding='utf-8')
    support = project / 'support.ts'
    support.write_text('export function helper() { return "support"; }\n', encoding='utf-8')
    (project / 'excluded.ts').write_text('export const outsideSelectedProgram = true;\n', encoding='utf-8')
    (project / 'unsupported.py').write_text('# Static inventory fixture; never executed.\n', encoding='utf-8')
    (project / 'tsconfig.json').write_text(json.dumps({'compilerOptions': {'target': 'ES2022'}, 'include': ['*.ts'], 'exclude': ['excluded.ts']}), encoding='utf-8')
    process, url = service(project, store)
    allowed_origins = {urlsplit(url).netloc}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
            context = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
            page = context.new_page()
            errors, requests = [], []
            def browser_error(error):
                record = {'after': checks[-1] if checks else 'startup', 'message': str(error), 'stack': error.stack}
                errors.append(record)
                print('BROWSER ERROR: ' + json.dumps(record, ensure_ascii=False), flush=True)

            page.on('pageerror', browser_error)
            page.on('request', lambda request: requests.append(request.url))
            page.goto(url)
            frame = page.frame_locator('#workspace-report')
            expect(frame.locator('#viewer-startup')).to_have_count(0, timeout=30000)
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)

            def api(path):
                address = urlsplit(url)
                token = parse_qs(address.fragment)['token'][0]
                response = context.request.get(address.scheme+'://'+address.netloc+path, headers={'X-RepoGraphia-Token': token})
                assert response.ok, response.text()
                return response.json()

            def work():
                state = api('/api/state')
                return api('/api/feature-work?snapshot='+state['latestSnapshot']+'&featureDigest='+state['feature']['digest'])

            def feature_card(feature_id):
                # Outgoing scenes retain their card markup only as inert visual copies.
                return frame.locator('.feature-scene-layer:not(.feature-motion-ghost) .feature-card[data-feature="'+feature_id+'"]')

            def map_draft(name):
                page.locator('#show-map').click()
                frame.locator('#features-tab').click()
                if not frame.locator('.feature-document-tools').evaluate('(node) => node.open'):
                    frame.locator('.feature-document-tools > summary').click()
                frame.locator('#feature-new').click()
                frame.get_by_label('功能名称', exact=True).fill(name)
                expect(page.locator('#save-status')).to_contain_text('尚未应用')

            def cancel_map_draft():
                page.locator('#show-map').click()
                frame.get_by_role('button', name='取消', exact=True).click()
                expect(page.locator('#save-status')).not_to_contain_text('尚未应用')
                page.locator('#show-feature-work').click()

            def download_task(name):
                with page.expect_download() as event:
                    page.get_by_role('button', name='下载任务包', exact=True).click()
                file = args.output / name
                event.value.save_as(file)
                return json.loads(file.read_text(encoding='utf-8'))

            def create_task(kind, feature_id=''):
                page.locator('#show-feature-work').click()
                page.locator('#feature-work-prepare').click()
                page.locator('[data-task-kind="'+kind+'"]').click()
                if kind == 'feature':
                    page.locator('#feature-task-feature').select_option(feature_id)
                page.locator('#feature-task-create').click()
                expect(page.get_by_role('button', name='下载任务包', exact=True)).to_be_visible(timeout=30000)
                return download_task(kind+'-task-'+str(len(checks))+'.json')

            def import_proposal(value, name):
                file = args.output / name
                file.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
                page.locator('#show-feature-work').click()
                page.locator('#feature-work-import').click()
                page.locator('#feature-result-file').set_input_files(file)
                page.locator('#feature-result-author').fill('Browser fixture Agent (declared)')
                page.locator('#feature-import-confirm').click()
                expect(page.locator('#feature-import-dialog')).not_to_be_visible(timeout=20000)
                expect(page.locator('#feature-work-detail')).to_contain_text(value['summary'])

            def original_proposal():
                original = page.locator('#feature-work-detail > details').filter(has=page.locator('summary', has_text='固定原始提案'))
                return json.loads(original.locator('pre').text_content())

            def open_proposal(batch_id):
                metadata = next(item for item in work()['proposals'] if item['batchId'] == batch_id)
                page.locator('#show-feature-work').click()
                page.locator('[data-category=proposals]').click()
                page.locator('.feature-work-item[data-item-kind=proposal][data-item-id="'+metadata['id']+'"]').click()
                expect(page.locator('#feature-work-detail > h3')).to_have_text(metadata['summary'])

            def decide(action, reason):
                page.locator('#feature-proposal-actor').fill('Browser reviewer (declared)')
                page.locator('#feature-proposal-reason').fill(reason)
                page.locator('#feature-proposal-'+action).click()

            def accept_mapping(reason):
                page.locator('#show-map').click()
                frame.locator('#features-tab').click()
                feature_card('f-report').click()
                frame.locator('.feature-detail-actions').get_by_role('button', name='关联代码', exact=True).click()
                frame.locator('.feature-code-node[data-mapping="m-report"]').click()
                frame.locator('.feature-detail-tabs button[data-tab=review]').click()
                if not frame.locator('.feature-review-details').evaluate('(node) => node.open'):
                    frame.locator('.feature-review-details > summary').click()
                frame.get_by_label('编辑者（自述身份）', exact=True).fill('Manual reviewer')
                frame.get_by_label('本次修改理由', exact=True).fill(reason)
                frame.locator('.feature-review[data-decision=accepted]').click()
                expect(page.locator('#save-status')).to_contain_text('标注已保存', timeout=15000)
                frame.locator('.feature-detail-tabs button[data-tab=about]').click()
                frame.get_by_role('button', name='返回功能说明', exact=True).click()

            page.locator('#show-feature-work').click()
            expect(page.locator('#feature-work-coverage [data-kind=indexed] strong')).to_have_text('2', timeout=20000)
            expect(page.locator('#feature-work-coverage [data-kind=explored] strong')).to_have_text('0')
            assert page.locator('.feature-work-layout').evaluate('(node) => getComputedStyle(node).gridTemplateColumns.split(" ").length') == 2
            assert page.evaluate('getComputedStyle(document.body).backgroundColor') != 'rgb(255, 255, 255)'
            page.locator('.feature-work-scope > summary').click()
            expect(page.locator('#feature-work-scope')).to_contain_text('另发现 2 个源码文件未进入当前索引')
            page.locator('#feature-work-scope summary').filter(has_text='发现但未索引的源码').click()
            expect(page.locator('#feature-work-scope')).to_contain_text('excluded.ts')
            expect(page.locator('#feature-work-scope')).to_contain_text('不在所选编译配置的范围内')
            expect(page.locator('#feature-work-scope')).to_contain_text('unsupported.py')
            expect(page.locator('#feature-work-scope')).to_contain_text('当前不支持这种语言的静态索引')
            page.locator('.feature-work-scope > summary').click()
            checked('dark horizontal feature-work panel separates actual indexing, exploration, and unindexed file reasons')

            map_draft('准备任务也不能丢的草稿')
            page.locator('#show-feature-work').click()
            page.locator('#feature-work-prepare').click()
            page.locator('#feature-task-create').click()
            expect(page.locator('#feature-work-status')).to_contain_text('编辑')
            assert len(work()['tasks']) == 0
            page.locator('#show-map').click()
            expect(frame.get_by_label('功能名称', exact=True)).to_have_value('准备任务也不能丢的草稿')
            cancel_map_draft()
            page.locator('#feature-task-create').click()
            expect(page.get_by_role('button', name='下载任务包', exact=True)).to_be_visible(timeout=30000)
            bundle = download_task('overview-task.json')
            assert bundle['task']['kind'] == 'overview'
            assert set(bundle['task']['allowed']['files']) == {'entry.ts', 'support.ts'}
            assert download_task('overview-task-again.json') == bundle
            checked('task preparation protects unapplied map forms; overview bundle is fixed and re-exportable')

            map_draft('导入和阅读时保留的草稿')
            value = revision(bundle, 'browser-overview')
            import_proposal(value, 'overview-revision.json')
            expect(page.locator('#feature-change-display')).to_contain_text('原内容')
            expect(page.locator('#feature-change-display')).to_contain_text('提议内容')
            warnings = page.locator('#feature-work-detail > details').filter(has=page.locator('summary', has_text='提案适用限制'))
            warnings.locator('summary').first.click()
            expect(warnings).to_contain_text('源码引用和节选已经核对；功能解释与探索记录仍来自 Agent 的声明')
            expect(warnings).to_contain_text('应用修订不会自动接受关联')
            expect(warnings).to_contain_text('撤销关联会保留原记录及历史')
            expect(warnings.locator('pre')).not_to_be_visible()
            warnings.get_by_text('原始系统提示', exact=True).click()
            expect(warnings.locator('pre')).to_contain_text('Applying a revision does not accept its mappings.')
            warnings.locator('summary').first.click()
            decide('apply', '应先保护未应用地图草稿。')
            expect(page.locator('#feature-work-status')).to_contain_text('编辑')
            assert len(work()['features']) == 0
            page.locator('#show-map').click()
            expect(frame.get_by_label('功能名称', exact=True)).to_have_value('导入和阅读时保留的草稿')
            checked('import preserves map drafts; system warnings are Chinese with original records; apply cannot bypass the draft guard')

            cancel_map_draft()
            decide('apply', '已查看固定前后内容，应用为待审功能关联。')
            expect(page.locator('#feature-work-status')).to_contain_text('本批修订已保存', timeout=20000)
            current = work()
            assert current['features'][0]['id'] == 'f-report'
            assert current['references']['mappings'][0]['decision'] == 'proposed'
            assert current['references']['mappings'][0]['status'] == 'matched'
            expect(page.locator('#feature-work-coverage [data-kind=explored] strong')).to_have_text('1')
            assert len(current['references']['unassignedNodes']) > 0
            checked('whole proposal applies atomically as proposed content; exploration and unassigned code remain distinct')

            # Keep the real outgoing visual copy present while interacting with the
            # new scene. A raw CSS card locator used to match both during this overlap.
            page.locator('#show-map').click()
            frame.locator('#features-tab').click()
            frame.locator('#feature-breadcrumb').evaluate('''nav => nav.addEventListener('click', () => {
                const ghost = document.querySelector('.feature-motion-ghost');
                if (ghost) for (const animation of ghost.getAnimations()) animation.pause();
            }, {once: true})''')
            frame.locator('#feature-breadcrumb button').click()
            ghost = frame.locator('.feature-motion-ghost')
            expect(ghost).to_have_count(1)
            assert ghost.evaluate('node => node.inert && node.getAttribute("aria-hidden") === "true" && getComputedStyle(node).pointerEvents === "none"')
            assert ghost.evaluate('node => node.getAnimations().some(animation => animation.playState === "paused")')
            expect(frame.locator('.feature-card[data-feature="f-report"]')).to_have_count(2)
            expect(feature_card('f-report')).to_have_count(1)
            feature_card('f-report').click()
            expect(feature_card('f-report')).to_have_attribute('aria-pressed', 'true')
            expect(frame.locator('#detail h3')).to_have_text('导出报告')
            expect(ghost).to_have_count(1)
            ghost.evaluate('node => { for (const animation of node.getAnimations()) animation.play(); }')
            expect(ghost).to_have_count(0)
            checked('real motion overlap keeps one interactive feature card while the inert visual copy remains, then removes the copy')

            accept_mapping('接受原固定依据上的关联，非代码验收。')
            frame.locator('.feature-continue-analysis').click()
            expect(page.locator('#feature-task-feature')).to_have_value('f-report')
            page.locator('#feature-task-create').click()
            expect(page.get_by_role('button', name='下载任务包', exact=True)).to_be_visible(timeout=30000)
            old_task = download_task('old-feature-task.json')
            assert old_task['features']['mappings'][0]['decision'] == 'accepted'
            assert old_task['task']['allowed']['parentId'] == 'f-report'
            checked('feature-node continue action carries the exact feature scope and preserves original human decision')

            implicit_reset = revision(old_task, 'browser-review-reset', title='导出固定报告', revise=True)
            implicit_reset['mappings'] = []
            import_proposal(implicit_reset, 'review-reset-revision.json')
            expect(page.locator('.feature-proposal-summary')).to_contain_text('1 项关联回到待审')
            expect(page.locator('#feature-change-select option')).to_have_count(2)
            page.locator('#feature-change-select').select_option('1')
            expect(page.locator('[data-change-action=review-reset]')).to_contain_text('功能说明变化，关联回到待审')
            expect(page.locator('#feature-change-display [data-side=before]')).to_contain_text('人工接受')
            expect(page.locator('#feature-change-display [data-side=after]')).to_contain_text('待审')
            decide('apply', '明确看到功能说明变化会撤回原接受，保留历史后重新审阅。')
            expect(page.locator('#feature-work-status')).to_contain_text('本批修订已保存', timeout=20000)
            assert work()['references']['mappings'][0]['decision'] == 'proposed'
            accept_mapping('按照变更后的功能说明重新审阅本条关联。')
            old_task = create_task('feature', 'f-report')
            checked('meaning-only revisions visibly expose implicit accepted-to-proposed review resets before application')

            support.write_text('export function helper() { return "changed unrelated support"; }\n', encoding='utf-8')
            page.locator('#refresh-workspace').click()
            expect(page.locator('#open-latest')).to_be_visible(timeout=30000)
            page.locator('#open-latest').click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=15000)
            import_proposal(revision(old_task, 'browser-late', title='旧版本返回的说明', revise=True), 'late-revision.json')
            expect(page.locator('#feature-proposal-apply')).to_be_disabled()
            expect(page.locator('#feature-proposal-eligibility')).to_contain_text('变化')
            assert work()['references']['mappings'][0]['decision'] == 'accepted'
            assert work()['references']['mappings'][0]['status'] == 'matched'
            page.screenshot(path=str(args.output / 'feature-work-stale.png'), full_page=True, animations='disabled')
            decide('reject', '旧基线结果可读，但不覆盖当前版本。')
            expect(page.locator('#feature-work-status')).to_contain_text('已记录拒绝', timeout=15000)
            assert work()['references']['mappings'][0]['decision'] == 'accepted'
            checked('unrelated code changes preserve matched old decisions; late results are readable, blocked from apply, and rejectable')

            task = create_task('feature', 'f-report')
            next_value = revision(task, 'browser-deepen', title='导出报告与内容', revise=True, child=True)
            for check in next_value['checks']:
                prefix = '父功能' if check['featureId'] == 'f-report' else '子功能'
                check['explanation'] = prefix + '：' + check['explanation']
            next_value['checks'].extend([
                {**next_value['checks'][0], 'quote': 'export function renderReport()', 'explanation': '父功能：这是导出的固定声明，不能据此推断所有使用者。'},
                {**next_value['checks'][0], 'quote': '"original"', 'explanation': '父功能：完整保留第三条检查，默认折叠并不删除原始记录。'}])
            import_proposal(next_value, 'deeper-revision.json')
            reading_digest = work()['featureDigest']
            expect(page.locator('#feature-proposal-feature-select option')).to_have_count(2)
            expect(page.locator('#feature-proposal-feature-context h4')).to_have_text('导出报告与内容')
            expect(page.locator('#feature-proposal-checks')).to_have_attribute('data-feature-id', 'f-report')
            expect(page.locator('.feature-proposal-check')).to_have_count(4)
            expect(page.locator('.feature-proposal-check[data-feature-id="f-content"]')).to_have_count(0)
            expect(page.locator('#feature-proposal-checks')).to_contain_text('以下检查只属于这份固定提案及其代码版本')
            extra_support = page.locator('.feature-proposal-check-kind[data-check-kind=support] > details')
            expect(extra_support.locator('summary').first).to_have_text('其余支持依据 · 1')
            expect(extra_support.locator('.feature-proposal-check')).not_to_be_visible()
            extra_support.locator('summary').first.click()
            expect(extra_support).to_contain_text('完整保留第三条检查')
            expect(extra_support.locator('.feature-proposal-check')).to_be_visible()
            expect(page.locator('#feature-change-select option')).to_have_count(4)
            assert sorted(page.locator('#feature-change-select option').evaluate_all('(items) => items.map(item => item.value)')) == ['0', '1', '2', '3']
            page.locator('#feature-proposal-feature-select').select_option('f-content')
            expect(page.locator('#feature-change-select')).to_have_value('1')
            expect(page.locator('#feature-proposal-feature-context h4')).to_have_text('准备报告内容')
            expect(page.locator('.feature-proposal-check')).to_have_count(2)
            expect(page.locator('.feature-proposal-check[data-feature-id="f-report"]')).to_have_count(0)
            expect(page.locator('#feature-proposal-checks')).not_to_contain_text('父功能：')
            child_source = page.locator('.feature-proposal-check').first.locator('details').first
            expect(child_source.locator('blockquote')).not_to_be_visible()
            child_source.locator('summary').first.click()
            expect(child_source.locator('blockquote')).to_have_text('return "original";')
            page.locator('#feature-change-display').get_by_role('button', name='下一项', exact=True).click()
            expect(page.locator('#feature-change-select')).to_have_value('3')
            expect(page.locator('#feature-change-display')).to_contain_text('本功能 2 / 2 项变更')
            expect(page.locator('#feature-change-display').get_by_role('button', name='下一项', exact=True)).to_be_disabled()
            expect(child_source.locator('blockquote')).to_be_visible()
            page.locator('#feature-proposal-feature-select').select_option('f-report')
            page.locator('#feature-change-display').get_by_role('button', name='下一项', exact=True).click()
            expect(page.locator('#feature-change-select')).to_have_value('2')
            expect(page.locator('#feature-proposal-checks')).to_have_attribute('data-feature-id', 'f-report')
            page.locator('#feature-change-select').select_option('1')
            expect(page.locator('#feature-proposal-feature-select')).to_have_value('f-content')
            expect(page.locator('#feature-change-display')).to_contain_text('准备报告内容')
            assert original_proposal() == next_value
            assert work()['featureDigest'] == reading_digest
            checked('feature grouping keeps each change with its own fixed-batch checks, original indexes, folded sources, and complete records without changing annotations')
            page.screenshot(path=str(args.output / 'feature-work-review.png'), full_page=True, animations='disabled')
            decide('apply', '对照前后说明，新增下一层并将改变的关联留待审阅。')
            expect(page.locator('#feature-work-status')).to_contain_text('本批修订已保存', timeout=20000)
            current = work()
            assert next(item for item in current['features'] if item['id'] == 'f-content')['parentId'] == 'f-report'
            assert all(item['decision'] == 'proposed' for item in current['references']['mappings'])
            page.locator('#show-map').click()
            frame.locator('#features-tab').click()
            feature_card('f-report').click()
            frame.locator('.feature-detail-actions .feature-enter').click()
            expect(feature_card('f-content')).to_be_visible()
            checked('scoped revision exposes before/after meaning and explicit hierarchy; changed accepted mappings return to proposed')

            support.write_text('export function helper() { return "changed again"; }\nexport function addedCode() { return 1; }\n', encoding='utf-8')
            page.locator('#refresh-workspace').click()
            expect(page.locator('#open-latest')).to_be_visible(timeout=30000)
            page.locator('#open-latest').click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=15000)
            changes_task = create_task('changes')
            assert 'support.ts' in changes_task['task']['allowed']['files']
            assert any(item['name'] == 'addedCode' for item in work()['references']['unassignedNodes'])
            checked('new code without feature ownership enters the exploration queue and changes-task scope')

            retraction_task = create_task('feature', 'f-report')
            retraction_value = revision(retraction_task, 'browser-retract', retract=True)
            import_proposal(retraction_value, 'retract-revision.json')
            expect(page.locator('#feature-change-display')).to_contain_text('原记录、依据和此前决定保留在历史中')
            expect(page.locator('#feature-proposal-feature-context h4')).to_have_text('导出报告与内容')
            expect(page.locator('#feature-proposal-checks')).to_contain_text('本功能仅撤销关联，本批无需新增支持／限制检查')
            expect(page.locator('.feature-proposal-check')).to_have_count(0)
            assert original_proposal() == retraction_value
            checked('retraction-only reading uses the fixed feature name and original reason without inventing new support or limit checks')
            decide('apply', '撤销当前不再使用的显式关联，保留历史记录。')
            expect(page.locator('#feature-work-status')).to_contain_text('本批修订已保存', timeout=20000)
            assert next(item for item in work()['references']['mappings'] if item['id'] == 'm-report')['decision'] == 'rejected'
            checked('applying a retraction retains its mapping record as inactive, distinct from rejecting an entire proposal')

            page.set_viewport_size({'width': 390, 'height': 844})
            page.emulate_media(reduced_motion='reduce')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            page.screenshot(path=str(args.output / 'feature-work-mobile.png'), full_page=True, animations='disabled')
            checked('feature-task and proposal workspace fits 390px and honors reduced-motion preferences')

            stop(process)
            process, url = service(project, store)
            allowed_origins.add(urlsplit(url).netloc)
            page.goto(url)
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)
            page.locator('#show-feature-work').click()
            expect(page.locator('[data-category=proposals] small')).to_have_text('5', timeout=20000)
            current = work()
            assert len(current['proposals']) == 5
            assert len(current['tasks']) == 6
            assert any(item['status'] == 'rejected' for item in current['proposals'])
            assert next(item for item in current['references']['mappings'] if item['id'] == 'm-report')['decision'] == 'rejected'
            checked('service restart restores fixed tasks, applied/rejected proposal history, and original inactive records')

            # M4 proposal reading cases use only synthetic fixture tasks and the
            # established import/decision UI; no Agent or target program runs.
            page.set_viewport_size({'width': 1440, 'height': 1050})
            mapping_task = create_task('feature', 'f-content')
            mapping_value = revision(mapping_task, 'browser-mapping-only', title='仅补充内容关联', revise=True)
            mapping_value['features'] = []
            mapping_value['mappings'][0].update({'id': 'm-content', 'featureId': 'f-content',
                                                 'rationale': '本批只明确固定返回语句的关联理由，不修改功能名称或说明。'})
            for check in mapping_value['checks']:
                check['featureId'] = 'f-content'
            before_mapping = work()
            import_proposal(mapping_value, 'mapping-only-revision.json')
            expect(page.locator('#feature-proposal-feature-select option')).to_have_count(1)
            expect(page.locator('#feature-change-select option')).to_have_count(1)
            expect(page.locator('#feature-proposal-feature-context h4')).to_have_text('准备报告内容')
            expect(page.locator('#feature-proposal-feature-context')).to_contain_text('功能说明来自固定任务，本批未修改')
            expect(page.locator('#feature-proposal-feature-context')).to_contain_text('整理要返回的内容')
            expect(page.locator('#feature-proposal-checks')).to_have_attribute('data-feature-id', 'f-content')
            expect(page.locator('.feature-proposal-check')).to_have_count(2)
            expect(page.locator('#feature-proposal-apply')).to_be_enabled()
            assert original_proposal() == mapping_value
            assert work()['featureDigest'] == before_mapping['featureDigest']
            checked('mapping-only proposals show fixed feature context and the same scoped checks without rewriting feature content')

            rename_task = create_task('feature', 'f-content')
            rename_value = revision(rename_task, 'browser-rename-content', title='内容功能改名的提案', revise=True)
            old_content = next(item for item in rename_task['features']['features'] if item['id'] == 'f-content')
            rename_value['features'] = [{'action': 'revise', 'feature': {**old_content, 'title': '整理待交付内容'},
                                         'reason': '用于核对历史提案始终使用固定任务中的名称。'}]
            rename_value['mappings'][0].update({'id': 'm-content', 'featureId': 'f-content'})
            for check in rename_value['checks']:
                check['featureId'] = 'f-content'
            import_proposal(rename_value, 'rename-content-revision.json')
            decide('apply', '明确应用功能改名，以验证另一批旧任务的名称不会跟着改变。')
            expect(page.locator('#feature-work-status')).to_contain_text('本批修订已保存', timeout=20000)
            renamed = work()
            assert next(item for item in renamed['features'] if item['id'] == 'f-content')['title'] == '整理待交付内容'
            open_proposal('browser-mapping-only')
            expect(page.locator('#feature-proposal-feature-context h4')).to_have_text('准备报告内容')
            expect(page.locator('#feature-proposal-feature-context')).not_to_contain_text('整理待交付内容')
            expect(page.locator('#feature-proposal-apply')).to_be_disabled()
            expect(page.locator('#feature-proposal-eligibility')).to_contain_text('变化')
            expect(page.locator('#feature-proposal-checks')).to_contain_text('这份固定提案及其代码版本')
            assert original_proposal() == mapping_value
            assert work()['featureDigest'] == renamed['featureDigest']
            page.screenshot(path=str(args.output / 'feature-work-fixed-name.png'), full_page=True, animations='disabled')
            checked('reopened mapping proposals retain the original task name after a later rename, remain stale, and leave current annotations unchanged')

            exploration_task = create_task('feature', 'f-content')
            exploration_value = revision(exploration_task, 'browser-exploration-only', title='仅记录已探索文件')
            for field in ['features', 'mappings', 'retractions', 'checks']:
                exploration_value[field] = []
            exploration_value['unexplored'] = ['本批未提出新的功能解释，也未核对返回内容的运行结果。']
            before_exploration = work()
            import_proposal(exploration_value, 'exploration-only-revision.json')
            expect(page.locator('#feature-proposal-feature-select')).to_have_count(0)
            expect(page.locator('#feature-change-display')).to_have_count(0)
            expect(page.locator('#feature-proposal-checks')).to_have_count(0)
            expect(page.locator('#feature-work-detail')).to_contain_text('本批没有功能内容改动')
            expect(page.locator('#feature-work-detail')).to_contain_text(exploration_value['unexplored'][0])
            expect(page.locator('#feature-work-detail')).to_contain_text('以下事项属于整批范围，没有自动归入当前选中的功能')
            exploration_files = page.locator('#feature-work-detail > details').filter(has=page.locator('summary', has_text='本批探索文件'))
            exploration_files.locator('summary').first.click()
            expect(exploration_files).to_contain_text('entry.ts')
            expect(exploration_files).to_contain_text('SHA-256')
            expect(page.locator('#feature-proposal-apply')).to_be_enabled()
            assert original_proposal() == exploration_value
            assert work()['featureDigest'] == before_exploration['featureDigest']
            checked('exploration-only proposals retain batch unknowns and exact explored files without fabricating feature groups or behavior proof')

            assert not errors, errors
            assert all(urlsplit(request).netloc in allowed_origins for request in requests if request.startswith('http')), requests
            checked('no browser exceptions, external network requests, target execution, or automatic Agent execution')
            context.close()
            browser.close()
    finally:
        stop(process)

result = {'checks': len(checks), 'passed': checks, 'browserExceptions': 0, 'externalRequests': 0}
(args.output / 'feature-task-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
