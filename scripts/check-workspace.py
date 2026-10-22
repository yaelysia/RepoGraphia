"""Real loopback browser acceptance for persistent M1 workspaces (no target code runs)."""
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
tool = Path(__file__).resolve().parents[1]
args.output.mkdir(parents=True, exist_ok=True)
checks = []


def checked(label):
    checks.append(label)
    print('PASS: ' + label, flush=True)


def service(root, store):
    process = subprocess.Popen([args.node, str(tool / 'tests/helpers/workspace.mjs'), str(root), str(store)],
                               cwd=tool, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', env={**os.environ, 'NO_COLOR': '1'})
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        line = lines.get(timeout=30)
        info = json.loads(line)
    except Exception:
        process.kill()
        raise RuntimeError('Workspace service did not start: ' + process.stderr.read())
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


with tempfile.TemporaryDirectory(prefix='repographia-workspace-browser-') as temporary:
    temp = Path(temporary)
    project = temp / 'project'
    project.mkdir()
    store = temp / 'saved-workspace'
    entry = project / 'entry.ts'
    entry.write_text('export function renderReport() { return "original"; }\nrenderReport();\n', encoding='utf-8')
    (project / 'tsconfig.json').write_text(json.dumps({'compilerOptions': {'target': 'ES2022'}, 'include': ['*.ts']}), encoding='utf-8')
    process, url = service(project, store)
    allowed_origins = {urlsplit(url).netloc}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
            context = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
            page = context.new_page()
            errors, network = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: network.append(request.url))
            page.goto(url)
            expect(page.locator('#workspace-report')).to_be_visible(timeout=30000)
            frame = page.frame_locator('#workspace-report')
            expect(frame.locator('#viewer-startup')).to_have_count(0, timeout=30000)
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=10000)
            assert not urlsplit(page.url).fragment
            assert frame.locator('#project-map .project-node').count() > 0
            assert page.evaluate('getComputedStyle(document.body).backgroundColor') != 'rgb(255, 255, 255)'
            checked('strict-CSP live report starts inside same-origin frame; token removed from URL; dark shell')
            first_snapshot = frame.locator('#graph-data').text_content()
            first_snapshot = json.loads(first_snapshot)['project']['snapshot']

            frame.locator('#features-tab').click()
            if not frame.locator('.feature-document-tools').evaluate('(node) => node.open'):
                frame.locator('.feature-document-tools > summary').click()
            frame.locator('#feature-new').click()
            frame.get_by_label('编辑者（自述身份）', exact=True).fill('browser-reviewer')
            frame.get_by_label('本次修改理由', exact=True).fill('Create a reviewable feature')
            frame.get_by_label('功能名称', exact=True).fill('导出报告')
            frame.get_by_label('一句解释（可选）', exact=True).fill('将当前结果写入文件')
            frame.get_by_label('功能说明', exact=True).fill('测试夹具明确提供的功能描述。')
            expect(page.locator('#save-status')).to_contain_text('尚未应用', timeout=5000)
            frame.locator('.feature-save').click()
            expect(page.locator('#save-status')).to_contain_text('标注已保存', timeout=10000)
            checked('applied feature edits receive real disk-save acknowledgement; unapplied form state visible')

            page.locator('#start-task').click()
            page.locator('#task-title').fill('增加 CSV 导出')
            page.locator('#confirm-task').click()
            expect(page.locator('#task-dialog')).not_to_be_visible(timeout=30000)
            expect(page.locator('#comparison-subtitle')).to_contain_text('增加 CSV 导出', timeout=10000)
            expect(page.locator('#change-detail')).to_contain_text('没有变化')
            checked('task start creates fresh pinned baseline and initial empty code comparison')

            page.locator('#show-map').click()
            frame.locator('#features-tab').click()
            if not frame.locator('.feature-document-tools').evaluate('(node) => node.open'):
                frame.locator('.feature-document-tools > summary').click()
            frame.locator('#feature-new').click()
            frame.get_by_label('功能名称', exact=True).fill('保留中的草稿')
            entry.write_text('export function renderReport() { return "CSV"; }\nrenderReport();\n', encoding='utf-8')
            page.locator('#refresh-workspace').click()
            expect(page.locator('#open-latest')).to_be_visible(timeout=30000)
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == first_snapshot
            page.locator('#open-latest').click()
            expect(page.locator('#workspace-notice')).to_contain_text('尚未应用')
            expect(frame.get_by_label('功能名称', exact=True)).to_have_value('保留中的草稿')
            checked('background code rebuild preserves pinned review and draft; version switch blocks unapplied form')
            frame.get_by_role('button', name='取消', exact=True).click()
            expect(page.locator('#save-status')).not_to_contain_text('尚未应用')
            page.locator('#open-latest').click()
            expect(page.locator('#feature-basis-notice')).to_be_visible(timeout=10000)
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=10000)
            second_snapshot = json.loads(frame.locator('#graph-data').text_content())['project']['snapshot']
            assert second_snapshot != first_snapshot
            checked('explicit latest switch loads new code while old feature basis remains clearly disclosed')

            page.locator('#show-changes').click()
            expect(page.locator('#changed-files .file-change')).to_have_count(1, timeout=10000)
            expect(page.locator('#change-detail .source-diff')).to_contain_text('CSV')
            expect(page.locator('#change-detail .source-diff')).to_contain_text('original')
            assert page.locator('#change-detail tr[data-kind=added]').count() > 0
            assert page.locator('#change-detail tr[data-kind=removed]').count() > 0
            page.screenshot(path=str(args.output / 'workspace-comparison.png'), full_page=True, animations='disabled')
            checked('left file list and right before/after source diff show changed records with fixed versions')

            page.locator('#open-task-start').click()
            expect(page.locator('#save-status')).to_contain_text('只读', timeout=10000)
            frame.locator('#features-tab').click()
            expect(frame.locator('#feature-new')).to_be_disabled()
            expect(frame.locator('#feature-import')).to_be_disabled()
            expect(frame.locator('#feature-migrate')).to_be_disabled()
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == first_snapshot
            checked('task-start graph uses its historical annotation version and disables mutation controls')

            page.reload()
            expect(page.locator('#save-status')).to_contain_text('只读', timeout=15000)
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == first_snapshot
            checked('reload restores exact pinned historical code and annotation context')
            page.locator('#open-latest').click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=10000)
            with page.expect_download() as downloaded:
                page.locator('#export-report').click()
            artifact = downloaded.value
            artifact.save_as(args.output / 'workspace-export.html')
            exported = (args.output / 'workspace-export.html').read_text(encoding='utf-8')
            assert 'id="workspace-data"' not in exported
            assert "connect-src 'none'" in exported
            checked('export produces standalone fixed offline HTML without live bridge')

            # A second tab edits the same saved version. The first cannot silently overwrite it.
            page2 = context.new_page()
            page2.on('pageerror', lambda error: errors.append(str(error)))
            page2.goto(url)
            expect(page2.locator('#save-status')).to_contain_text('标注已载入', timeout=15000)
            frame2 = page2.frame_locator('#workspace-report')
            frame2.locator('#features-tab').click()
            if not frame2.locator('.feature-document-tools').evaluate('(node) => node.open'):
                frame2.locator('.feature-document-tools > summary').click()
            frame2.locator('#feature-new').click()
            frame2.get_by_label('编辑者（自述身份）', exact=True).fill('second-reviewer')
            frame2.get_by_label('本次修改理由', exact=True).fill('Concurrent edit')
            frame2.get_by_label('功能名称', exact=True).fill('第二窗口的功能')
            frame2.get_by_label('功能说明', exact=True).fill('Concurrent saved annotation')
            frame2.locator('.feature-save').click()
            expect(page2.locator('#save-status')).to_contain_text('标注已保存', timeout=10000)
            frame.locator('#features-tab').click()
            if not frame.locator('.feature-document-tools').evaluate('(node) => node.open'):
                frame.locator('.feature-document-tools > summary').click()
            frame.locator('#feature-new').click()
            frame.get_by_label('编辑者（自述身份）', exact=True).fill('first-reviewer')
            frame.get_by_label('本次修改理由', exact=True).fill('Must conflict')
            frame.get_by_label('功能名称', exact=True).fill('冲突草稿仍保留')
            frame.get_by_label('功能说明', exact=True).fill('Keep this draft for review')
            frame.locator('.feature-save').click()
            expect(page.locator('#save-status')).to_contain_text('保存冲突', timeout=10000)
            expect(page.locator('#export-draft')).to_be_visible()
            with page.expect_download() as downloaded:
                page.locator('#export-draft').click()
            downloaded.value.save_as(args.output / 'conflict-draft.json')
            conflict = json.loads((args.output / 'conflict-draft.json').read_text(encoding='utf-8'))
            assert any(feature['title'] == '冲突草稿仍保留' for feature in conflict['features'])
            checked('concurrent save conflict preserves editable draft and provides JSON export')

            page.on('dialog', lambda dialog: dialog.accept())
            page.locator('#reload-saved').click()
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=10000)
            frame.locator('#features-tab').click()
            expect(frame.locator('#feature-view')).to_contain_text('第二窗口的功能')
            checked('explicit conflict reload fetches persisted winner without overwriting it')
            page2.close()

            stop(process)
            process, url = service(project, store)
            allowed_origins.add(urlsplit(url).netloc)
            page.goto(url)
            expect(page.locator('#save-status')).to_contain_text('标注已载入', timeout=30000)
            assert json.loads(frame.locator('#graph-data').text_content())['project']['snapshot'] == second_snapshot
            frame.locator('#features-tab').click()
            expect(frame.locator('#feature-view')).to_contain_text('第二窗口的功能')
            expect(page.locator('#task-select')).to_contain_text('增加 CSV 导出')
            page.screenshot(path=str(args.output / 'workspace-map.png'), full_page=True, animations='disabled')
            checked('service restart restores saved annotations, task baseline and pinned reading version')

            page.set_viewport_size({'width': 390, 'height': 844})
            page.emulate_media(reduced_motion='reduce')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            page.locator('#show-changes').click()
            expect(page.locator('#change-detail .source-diff')).to_be_visible(timeout=10000)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            page.screenshot(path=str(args.output / 'workspace-mobile.png'), full_page=True, animations='disabled')
            checked('mobile layout has no page overflow and reduced-motion mode remains usable')
            assert not errors, errors
            assert all(urlsplit(request).netloc in allowed_origins for request in network if request.startswith('http')), network
            checked('no browser exceptions or external network requests')
            context.close()
            browser.close()
    finally:
        stop(process)

result = {'checks': len(checks), 'passed': checks, 'browserExceptions': 0, 'externalRequests': 0}
(args.output / 'workspace-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
