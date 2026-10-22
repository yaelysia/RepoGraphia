"""Independent graph-membership checks plus project-to-source browser navigation."""
import re


def check_project_map(page, graph, check, output):
    def navigation():
        if not page.locator('.navigator').is_visible():
            page.locator('#feature-tree-toggle').click()

    def row(path=None):
        navigation()
        return page.locator(f'.project-row[data-path="{path}"]') if path else page.locator('.project-row').first

    test_path = re.compile(r'(^|/)(tests?|__tests__)/|\.(test|spec)\.[cm]?[jt]sx?$')
    files = {f['path'] for f in graph['files']} | {f['path'] for f in graph['coverage']['unindexed']}
    visible = {p for p in files if not test_path.search(p)}
    expected_groups = sorted({p.split('/')[0] for p in visible})
    nodes = {n['id']: n for n in graph['nodes']}
    pairs = {}
    for edge in graph['relations']:
        source = nodes[edge['from']]['location']['file']
        if source not in visible:
            continue
        source_group = source.split('/')[0]
        targets = {nodes[t]['location']['file'].split('/')[0] for t in edge['targets']
                   if t in nodes and nodes[t]['location']['file'] in visible}
        for target in targets - {source_group}:
            pairs.setdefault((source_group, target), set()).add(edge['id'])
    check('project is the default entry point', page.locator('#project-view').is_visible() and not page.locator('#local-view').is_visible())
    check('project root uses real indexed and unindexed paths',
          page.locator('.project-row').evaluate_all('(rows)=>rows.map(r=>r.dataset.path)') == expected_groups[:60])
    rows = page.locator('.project-link').evaluate_all('(rows)=>rows.map(r=>[r.dataset.from,r.dataset.to,Number(r.dataset.count)])')
    expected_links = [[a, b, len(ids)] for (a, b), ids in sorted(pairs.items())]
    check('independent root matrix preserves direction and unique relation counts', rows == expected_links[:30])
    check('project canvas is explicitly bounded', page.locator('.project-node').count() == min(12, len(expected_groups)))
    page.screenshot(path=str(output.with_name(output.stem + '-project.png')), full_page=True)
    if rows:
        a, b, count = rows[0]
        page.locator('.project-link').first.click()
        check('aggregate evidence has a 25-record budget', page.locator('.project-evidence').count() == min(count, 25))
        first_id = page.locator('.project-evidence').first.get_attribute('data-relation')
        check('aggregate evidence belongs to its original directed pair', first_id in pairs[(a, b)])
        if count > 25:
            page.locator('.project-next').click()
            check('aggregate next page advances', page.locator('.project-evidence').first.get_attribute('data-relation') != first_id)
            page.locator('.project-prev').click()
            check('aggregate previous page is stable', page.locator('.project-evidence').first.get_attribute('data-relation') == first_id)
        page.locator('.project-evidence').first.click()
        check('aggregate opens original evidence', first_id in page.locator('#detail').inner_text() and '解析依据' in page.locator('#detail').inner_text())
        page.locator('.project-back').click()
        check('aggregate return restores membership and page', page.locator('.project-evidence').first.get_attribute('data-relation') == first_id)
    navigation()
    page.locator('#show-tests').check()
    check('test opt-in restores recorded root paths',
          page.locator('.project-row').evaluate_all('(rows)=>rows.map(r=>r.dataset.path)') == sorted({p.split('/')[0] for p in files})[:60])
    page.locator('#show-tests').uncheck()
    page.locator('#status').select_option('unresolved')
    check('unknown-only filter retains paths rather than inventing destination nodes',
          page.locator('.project-row').count() == len(expected_groups) and page.locator('.project-link').count() == 0)
    page.locator('#status').select_option('all')
    page.locator('#kind').select_option('import')
    check('module-dependency filter does not label all relations as calls',
          all('调用 ·' not in t for t in page.locator('.project-link small').all_inner_texts()))
    page.locator('#kind').select_option('all')
    # The fixed sample supplies a nested production directory and an unindexed one.
    if 'src' in expected_groups:
        page.locator('.project-node[data-path="src"]').focus()
        page.locator('.project-node[data-path="src"]').press('Enter')
        check('project nodes support keyboard inspection', page.locator('.project-drill').count() == 1)
        page.locator('.project-drill').click()
        check('directory drilldown advances scope', page.locator('#project-summary').get_attribute('data-scope') == 'src')
        check('directory-outside relations remain accessible', page.locator('.project-count[data-category="outside"]').count() == 1)
        row('src/renderer').click()
        page.locator('.project-drill').click()
        row('src/renderer/App.tsx').click()
        page.locator('.project-drill').click()
        check('directory-to-file reaches the existing symbol explorer', page.locator('#local-view').is_visible() and 'src/renderer/App.tsx' in page.locator('#detail').inner_text())
        # A file's child links still enter symbols, not a different graph dataset.
        child = page.locator('#detail .detail-link').filter(has_text='App ·').first
        if child.count():
            child.click()
            check('file-to-function drilldown retains source evidence', '源码快照' in page.locator('#detail').inner_text())
        page.locator('#project-tab').click()
        check('return to project preserves last directory', page.locator('#project-summary').get_attribute('data-scope') == 'src/renderer')
        page.locator('#project-breadcrumb button').first.click()
    if 'electron' in expected_groups:
        row('electron').click()
        page.locator('.project-drill').click()
        before = page.locator('.project-node').count()
        page.locator('#project-expand').click()
        check('canvas expansion exposes more nodes without changing evidence totals', page.locator('.project-node').count() > before)
        page.screenshot(path=str(output.with_name(output.stem + '-directory.png')), full_page=True)
        page.locator('#project-breadcrumb button').first.click()
    if 'collector' in expected_groups:
        row('collector').click()
        page.locator('.project-drill').click()
        row().click()
        check('unindexed file is explicit and cannot navigate to fabricated code', page.locator('.project-drill').is_disabled() and 'unsupported-language' in page.locator('#detail').inner_text())
        page.locator('#project-breadcrumb button').first.click()
    page.set_viewport_size({'width': 430, 'height': 900})
    check('project map fits a narrow viewport', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    page.set_viewport_size({'width': 1600, 'height': 1100})
