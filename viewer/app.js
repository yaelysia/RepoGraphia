(() => {
  'use strict';
  const graph = JSON.parse(document.getElementById('graph-data').textContent);
  const $ = id => document.getElementById(id);
  const resolution = $('resolution-data') ? JSON.parse($('resolution-data').textContent) : null;
  const reasonOf = e => resolution?.groups.some(g => g.reason === e.evidence.reason) ? e.evidence.reason : 'unclassified';
  const names = { bound: '静态绑定', candidate: '候选绑定', unresolved: '未解析', external: '外部边界' };
  const kinds = { call: '调用', construct: '构造', tag: '模板调用', import: '导入', reexport: '再导出',
    extends: '继承', implements: '实现声明', callback: '回调传入（非调用）', jsx: 'JSX 引用（非调用）' };
  const colors = { bound: '#91b9fc', candidate: '#dfb772', unresolved: '#ee929e', external: '#8b97ac' };
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const files = new Map(graph.files.map(f => [f.path, f]));
  let projectView, featureView, initialized = false;
  const shell = createWorkbenchShell();
  let tab = 'files', selected = null, page = 60, edgePage = 50, zoom = 1;
  const make = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, action, cls) => { const b = make('button', text, cls); b.onclick = action; return b; };
  const short = (s, size = 32) => s.length > size ? s.slice(0, size - 1) + '…' : s;
  const loc = location => `${location.file}:${location.line}:${location.column}`;
  const testPath = file => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  const visible = n => $('show-tests').checked || !testPath(n.location.file);
  const fileNode = id => { const n = nodes.get(id); return n ? 'file:' + n.location.file : id; };
  const wanted = e => {
    const k = $('kind').value, s = $('status').value;
    return (visible(nodes.get(e.from)) && (s === 'all' || e.status === s) && (k === 'all' || (k === 'call' ? ['call','construct','tag'].includes(e.kind)
      : k === 'import' ? ['import','reexport'].includes(e.kind) : k === e.kind)));
  };
  const related = () => {
    if (!selected) return [];
    const isFile = nodes.get(selected)?.kind === 'file';
    return graph.relations.filter(e => wanted(e) && ((isFile ? fileNode(e.from) : e.from) === selected ||
      e.targets.some(t => (isFile ? fileNode(t) : t) === selected)));
  };
  $('project-name').textContent = graph.project.name;
  $('revision').textContent = `${graph.project.commit ? 'HEAD ' + graph.project.commit.slice(0, 10) : '非 Git 项目'} · 文件快照 / TS ${graph.project.compilerVersion}`;
  $('revision').textContent += ` · 分析规则 ${graph.project.analysisRevision ?? '未标注（旧报告）'}`;
  $('snapshot').textContent = 'SNAPSHOT ' + graph.project.snapshot.slice(0, 16);
  for (const [value, title] of [[graph.files.length,'索引文件'], [graph.nodes.filter(n => n.kind !== 'file').length,'代码实体'],
    [graph.coverage.syntaxCalls,'显式调用点'], [graph.coverage.callsByStatus.unresolved,'未解析调用']]) {
    const box = make('div', null, 'metric'); box.append(make('strong', value), make('span', title)); $('metrics').append(box);
  }
  $('nav-footer').textContent = `${graph.coverage.unindexed.length} 个源码文件未索引 · ${graph.diagnostics.length} 条编译诊断。查看「分析边界」了解范围。`;
  function setTab(next) {
    if (initialized && next === tab) return;
    const previous = tab;
    shell.remember();
    if (featureView?.active) featureView.leave();
    if (projectView?.active) projectView.leave();
    shell.prepare(next, ['files','symbols','gaps'].includes(next));
    tab = next; page = 60;
    for (const t of ['files','symbols','gaps']) $(t + '-tab').classList.toggle('active', tab === t);
    if (tab === 'features') featureView.enter();
    else if (tab === 'project') projectView.enter();
    else {
      $('feature-view').hidden = true; $('project-view').hidden = true; $('local-view').hidden = false;
      renderMap(); renderEdges(); if (selected) showNode(nodes.get(selected), false);
    }
    renderList(); shell.finish(previous, initialized);
    if (tab === 'gaps') shell.toggleNavigation(true, false);
  }
  function select(id) {
    if (!nodes.has(id)) return;
    if (projectView?.active || featureView?.active) setTab('files');
    selected = id; edgePage = 50; zoom = 1;
    renderList(); renderMap(); renderEdges(); showNode(nodes.get(id));
    shell.toggleNavigation(false, false);
  }
  function renderList() {
    const list = $('node-list'); list.replaceChildren();
    const search = $('search').value.trim().toLowerCase();
    if (tab === 'features') { featureView.renderList('',page); return; }
    if (tab === 'project') { projectView.renderList(search,page); return; }
    if (tab === 'gaps') {
      $('list-count').textContent = ''; $('more').hidden = true;
      if (resolution) {
        const box = make('div', null, 'gap');
        box.append(make('strong', `未解析原因 · ${resolution.counts.unresolved} 个调用点`),
          make('p', '统计覆盖整个选定程序，含测试路径；不是错误数或准确率。点击分类查看完整分页证据。'));
        for (const group of resolution.groups) {
          const entry = button(`${group.title} · ${group.count}`, () => showReason(group.reason), 'detail-link reason-group');
          entry.dataset.reason = group.reason; box.append(entry);
        }
        if (!resolution.groups.length) box.append(make('p', '当前快照没有未解析的显式调用记录，不代表运行时关系完整。'));
        list.append(box);
      }
      for (const text of graph.coverage.limitations) { const box = make('div', null, 'gap'); box.append(make('strong','范围限制'), make('p',text)); list.append(box); }
      for (const row of graph.coverage.unindexed.filter(x => x.path.toLowerCase().includes(search))) {
        const box = make('div', null, 'gap'); box.append(make('strong', row.path), make('p', row.reason)); list.append(box);
      }
      for (const row of graph.diagnostics.filter(x => `${x.file} ${x.message}`.toLowerCase().includes(search)).slice(0, 100)) {
        const box = make('div', null, 'gap'); box.append(make('strong', `${row.code} ${row.file || ''}:${row.line || ''}`), make('p', row.message)); list.append(box);
      }
      const info = make('div', null, 'gap');
      info.textContent = `忽略目录：${graph.coverage.ignoredDirectories.join(', ') || '无'}。跳过符号链接：${graph.coverage.skippedSymlinks.join(', ') || '无'}。诊断最多展示前 100 条，完整数据见 graph.json。`;
      list.append(info); return;
    }
    const matches = graph.nodes.filter(n => visible(n) && (tab === 'files' ? n.kind === 'file' : n.kind !== 'file') &&
      `${n.name} ${n.location.file}`.toLowerCase().includes(search)).sort((a,b) => a.location.file.localeCompare(b.location.file) || a.location.start - b.location.start);
    $('list-count').textContent = matches.length; $('more').hidden = matches.length <= page;
    for (const n of matches.slice(0, page)) {
      const row = button('', () => select(n.id), 'node-row' + (selected === n.id ? ' active' : ''));
      row.title = `${n.name} · ${loc(n.location)}`; row.dataset.node = n.id;
      row.append(make('strong', n.kind === 'file' ? n.name.split('/').pop() : n.name),
        make('small', n.kind === 'file' ? n.name : `${n.location.file}:${n.location.line} · ${n.kind}`)); list.append(row);
    }
    if (!matches.length) list.append(make('p','没有匹配项。'));
  }
  function svgEl(tag, attributes = {}, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,value] of Object.entries(attributes)) el.setAttribute(key,String(value));
    if (text != null) el.textContent = text;
    return el;
  }
  function renderMap() {
    const svg = $('map'); svg.replaceChildren();
    if (!selected) { $('map-note').textContent = '没有可索引的源文件。请查看分析边界或选择叶项目 tsconfig。'; return; }
    const focus = nodes.get(selected), edges = related(), isFile = focus.kind === 'file';
    $('map-title').textContent = focus.name;
    const incoming = new Map(), outgoing = new Map();
    for (const edge of edges) {
      const from = isFile ? fileNode(edge.from) : edge.from;
      if (from !== selected) { if (!incoming.has(from)) incoming.set(from, edge); continue; }
      for (const target of edge.targets.length ? edge.targets : ['unknown:' + edge.id]) {
        const id = isFile && nodes.has(target) ? fileNode(target) : target;
        if (!outgoing.has(id)) outgoing.set(id, edge);
      }
    }
    const left = [...incoming].slice(0, 7), right = [...outgoing].slice(0, 7);
    const allCount = incoming.size + outgoing.size, shown = left.length + right.length;
    const defs = svgEl('defs');
    for (const [status,color] of Object.entries(colors)) {
      const marker = svgEl('marker',{id:'arrow-'+status,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
      marker.append(svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:color})); defs.append(marker);
    }
    svg.append(defs);
    svg.append(svgEl('text',{x:170,y:35,'text-anchor':'middle',fill:'#8b99ad','font-size':13},'调用方 / 依赖方'));
    svg.append(svgEl('text',{x:830,y:35,'text-anchor':'middle',fill:'#8b99ad','font-size':13},'被调用 / 依赖 / 边界'));
    const drawNode = (id,x,y,edge,center=false) => {
      const n = nodes.get(id), name = n?.name || edge?.targetLabel || '未知目标';
      const status = edge?.status || 'bound', color = colors[status];
      const group = svgEl('g',{class:'node',tabindex:0,role:'button','aria-label':name});
      group.append(svgEl('rect',{x:x-128,y:y-33,width:256,height:66,rx:28,fill:center?'var(--accent-soft)':'var(--surface)',stroke:center?'var(--accent)':color,'stroke-width':center?2:1,'stroke-dasharray':status==='candidate'?'6 4':''}));
      group.append(svgEl('text',{x,y:y-4,'text-anchor':'middle',fill:'var(--text)','font-size':14},short(name.split('/').pop(),30)));
      group.append(svgEl('text',{x,y:y+18,'text-anchor':'middle',fill:'var(--muted)','font-size':11},n ? `${n.kind} · L${n.location.line}` : names[status]));
      group.append(svgEl('title',{},name));
      const activate = () => n ? select(id) : showEdge(edge);
      group.onclick = activate; group.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } };
      svg.append(group);
    };
    const drawSide = (items,inbound) => items.forEach(([id,edge],index) => {
      const y = 90 + index * (items.length === 1 ? 0 : 480/(items.length-1));
      const cy = items.length === 1 ? 325 : y, x = inbound ? 170 : 830;
      const d = inbound ? `M298 ${cy} C350 ${cy} 340 325 372 325` : `M628 325 C680 325 660 ${cy} 702 ${cy}`;
      const line = svgEl('path',{d,class:'edge',stroke:colors[edge.status],fill:'none','stroke-width':1.5,
        'stroke-dasharray':edge.status==='candidate'?'6 5':'','marker-end':'url(#arrow-'+edge.status+')'});
      line.append(svgEl('title',{},`${kinds[edge.kind]} · ${names[edge.status]}`)); line.onclick = () => showEdge(edge); svg.append(line);
      const hit = svgEl('path',{d,class:'edge-hit'}); hit.onclick = () => showEdge(edge); svg.append(hit);
      drawNode(id,x,cy,edge);
    });
    drawSide(left,true); drawSide(right,false); drawNode(selected,500,325,null,true);
    $('map-note').textContent = `局部一跳视图：展示 ${shown} / ${allCount} 个邻接目标，连线代表同目标的首条匹配关系；完整记录在下方。` +
      (allCount > shown ? ' 图已截断，可从下方记录继续探索。' : '') + (edges.length ? '' : ' 无匹配静态边不代表运行时没有关联。');
    applyZoom();
  }
  function renderEdges() {
    const list = $('edge-list'); list.replaceChildren();
    const edges = related(); $('edge-count').textContent = edges.length + ' 条'; $('more-edges').hidden = edges.length <= edgePage;
    for (const edge of edges.slice(0, edgePage)) {
      const row = button('', () => showEdge(edge), 'edge-row'); row.dataset.relation = edge.id;
      const text = make('div'); text.append(make('strong', `${nodes.get(edge.from)?.name || '?'} → ${edge.targetLabel}`),
        make('small', `${kinds[edge.kind]}${edge.typeOnly ? ' · 仅类型' : ''} · ${loc(edge.evidence.location)}`));
      row.append(text, make('span', names[edge.status], 'badge '+edge.status)); list.append(row);
    }
    if (!edges.length) list.append(make('p','当前筛选没有静态关系记录。'));
  }
  function sourceBlock(location, snippet) {
    const file = files.get(location.file), box = make('div');
    if (file?.source !== undefined) {
      const lines = file.source.split(/\r?\n/), start = Math.max(0, location.line-3), end = Math.min(lines.length, location.endLine+2, start+65);
      box.append(make('pre',lines.slice(start,end).map((line,i) => `${String(start+i+1).padStart(4)}  ${line}`).join('\n'),'code'));
      if (location.endLine > end) box.append(make('p','长代码块仅显示前 65 行；完整源码保存在报告数据中。'));
    } else { box.append(make('pre',snippet,'code'),make('p','源码节选；完整文件可在分析时使用 --include-source 嵌入。')); }
    return box;
  }
  function showNode(n, open = initialized) {
    if (open) shell.showDetails();
    const detail = $('detail'); detail.replaceChildren();
    detail.append(make('span',n.kind.toUpperCase(),'eyebrow'),make('h3',n.name),make('p',loc(n.location),'meta'));
    if (n.parent && nodes.has(n.parent)) detail.append(button('↑ ' + nodes.get(n.parent).name,() => select(n.parent),'detail-link'));
    detail.append(make('h4','源码快照'),sourceBlock(n.location,n.snippet));
    const children = graph.nodes.filter(child => child.parent === n.id);
    if (children.length) {
      detail.append(make('h4',`直接包含的代码实体 · ${children.length}`));
      for (const child of children.slice(0,60)) detail.append(button(`${child.name} · L${child.location.line}`,() => select(child.id),'detail-link'));
      if (children.length > 60) detail.append(make('p','仅展示前 60 个；其余可在导航中搜索。'));
    }
    featureView?.decorateNode(detail,n);
    detail.append(make('h4','定位信息'),make('p',n.id,'meta'),make('p','文件 SHA-256: '+files.get(n.location.file)?.hash,'meta'));
  }
  function showReason(reason, offset = 0) {
    const group = resolution.groups.find(g => g.reason === reason);
    if (!group) return;
    shell.showDetails(); shell.toggleNavigation(false, false);
    const rows = graph.relations.filter(e => ['call','construct','tag'].includes(e.kind) &&
      e.status === 'unresolved' && reasonOf(e) === reason).sort((a,b) =>
      Number(testPath(a.evidence.location.file)) - Number(testPath(b.evidence.location.file)) ||
      a.evidence.location.file.localeCompare(b.evidence.location.file) || a.evidence.location.start - b.evidence.location.start);
    const detail = $('detail'); detail.replaceChildren();
    detail.append(make('span', 'RESOLUTION DIAGNOSTICS', 'eyebrow'), make('h3', group.title),
      make('p', group.explanation), make('p', `${group.count} 条；其中 ${group.testPathCount} 条位于测试路径。`, 'meta'),
      make('p', `显示 ${rows.length ? offset + 1 : 0}–${Math.min(offset+25,rows.length)} / ${rows.length}`, 'diagnostic-range'));
    for (const edge of rows.slice(offset, offset + 25)) {
      const item = button(`${edge.targetLabel} · ${loc(edge.evidence.location)}`, () => {
        if (testPath(edge.evidence.location.file)) $('show-tests').checked = true;
        select(edge.from); showEdge(edge);
      }, 'detail-link diagnostic-example');
      item.dataset.relation = edge.id; detail.append(item);
    }
    if (offset > 0) detail.append(button('上一页', () => showReason(reason, Math.max(0,offset-25)), 'detail-link diagnostic-prev'));
    if (offset+25 < rows.length) detail.append(button('下一页', () => showReason(reason, offset+25), 'detail-link diagnostic-next'));
  }
  const originLabels = {
    reference: '符号引用', initializer: '常量初始化', destructure: '解构取值', property: '显式属性',
    'array-element': '数组元素', 'property-read': '属性读取', parameter: '形参',
    'parameter-property': '构造参数属性', 'direct-callsite': '已索引直接传参',
    'default-argument': '缺省实参', implementation: '候选实现', constructor: '显式构造函数',
    'open-callers': '不能排除未索引或动态调用方', 'unsupported-caller': '未追踪成员分派或框架回调',
    'heap-state': '对象变更或迭代器未求解，初始化值仅作候选',
    'written-value': '参数存在写入，停止传播', 'written-callee': '被调用函数存在重新赋值',
    'rest-binding': '未展开剩余绑定', 'default-binding': '未求解解构默认值',
    'spread-source': '来源包含展开表达式', 'spread-arguments': '实参包含展开表达式',
    'dynamic-key': '未求解动态键', 'getter-result': '未追踪 getter 返回值',
    'call-result': '未追踪调用返回值', 'mutable-binding': '来源绑定可变',
    'missing-property': '字面量未提供对应值', 'nonliteral-projection': '来源不是支持的字面量结构',
    'outside-index': '来源声明不在实现索引内', 'missing-initializer': '没有显式初始化',
    'missing-argument': '直接调用未提供此实参', 'unknown-value': '来源表达式未受支持',
    'unavailable-implementation': '实现不可导航', cycle: '递归或循环边界',
    budget: '达到步数或深度预算', 'caller-budget': '直接调用点数量已截断', 'source-budget': '候选来源数量已截断',
  };
  function originPoint(point, edge, text, cls) {
    const link = button(`${text} · ${loc(point.location)}`, () => {
      const detail = $('detail'); detail.replaceChildren();
      detail.append(button('← 返回调用证据', () => showEdge(edge), 'detail-link origin-back'),
        make('h3', text), make('p', loc(point.location), 'meta'), sourceBlock(point.location, point.excerpt),
        make('p', '文件 SHA-256: ' + point.fileHash, 'meta'));
    }, 'detail-link origin-point ' + (cls || ''));
    link.dataset.file = point.location.file; link.dataset.start = point.location.start;
    return link;
  }
  function showOrigins(edge, detail) {
    const trace = edge.evidence.valueOrigins;
    if (!trace) return;
    detail.append(make('h4', '值来源追踪'), make('div',
      '仅为有限的声明来源，不是完整运行时目标集合，也不证明整条路径能够实际执行。', 'callout origin-scope'),
      make('p', `${trace.sources.length} 条来源路径 · ${trace.visited}/${trace.limits.maxSteps} 个探索步骤` +
        (trace.truncated ? ' · 已截断：详见预算边界' : ' · 未耗尽预算，仍不保证完整'), 'meta origin-budget'));
    for (const source of trace.sources) {
      const box = make('details', null, 'origin-source');
      box.append(make('summary', `${nodes.get(source.target)?.name || source.target} · ${source.path.length} 个依据步骤`));
      box.append(button('定位候选实体', () => select(source.target), 'detail-link origin-target'));
      for (const point of source.path) box.append(originPoint(point, edge, originLabels[point.kind] || point.kind));
      detail.append(box);
    }
    if (trace.stops.length) detail.append(make('h4','停止原因 / 未覆盖边界'));
    for (const point of trace.stops) detail.append(originPoint(point, edge, originLabels[point.reason] || point.reason, 'origin-stop'));
  }
  function showEdge(edge, open = initialized) {
    if (open) shell.showDetails();
    const detail = $('detail'); detail.replaceChildren();
    if(projectView?.active) detail.append(projectView.backButton());
    detail.append(make('span',names[edge.status],'badge '+edge.status),make('h3',kinds[edge.kind]),
      make('p',edge.targetLabel),make('h4','解析依据 / RULE'),make('p',edge.evidence.rule,'meta'),make('p',edge.evidence.explanation));
    detail.append(make('div',edge.kind==='callback' ? '这里只证明函数作为参数传入，不证明发生了调用。' :
      edge.kind==='jsx' ? '这里只证明 JSX 组件被引用，不代表普通函数直接调用。' :
      '这是一条静态关系记录，不证明实际执行、运行顺序或完整的运行时目标集合。','callout'));
    if (edge.status === 'unresolved' && resolution) {
      const group = resolution.groups.find(g => g.reason === reasonOf(edge));
      if (group) detail.append(make('h4', '未解析分类'), make('p', group.title), make('p', group.explanation));
    }
    if (edge.evidence.declaration) {
      detail.append(make('h4', '已找到的声明（实现未索引）'),
        make('p', loc(edge.evidence.declaration.location), 'meta'),
        make('p', '声明文件 SHA-256: ' + edge.evidence.declaration.fileHash, 'meta'));
    }
    detail.append(make('h4','调用方 / 所属实体'),button(nodes.get(edge.from)?.name || edge.from,() => select(edge.from),'detail-link'));
    detail.append(make('h4','绑定目标 / 候选声明'));
    for (const target of edge.targets) detail.append(button(nodes.get(target)?.name || target,() => select(target),'detail-link'));
    if (!edge.targets.length) detail.append(make('p','没有可导航的项目内目标。保留边界，不猜测连线。'));
    showOrigins(edge, detail);
    detail.append(make('h4','来源代码'),make('p',loc(edge.evidence.location),'meta'),sourceBlock(edge.evidence.location,edge.evidence.excerpt),
      make('h4','证据版本'),make('p','文件 SHA-256: '+edge.evidence.fileHash,'meta'),make('p',edge.id,'meta'));
  }
  function applyZoom() {
    const w=1000/zoom,h=650/zoom; $('map').setAttribute('viewBox',`${500-w/2} ${325-h/2} ${w} ${h}`);
  }
  $('show-tests').onchange = () => { page=60; if(projectView.active) projectView.refresh(); else {renderMap();renderEdges();} renderList(); };
  for (const tabName of ['project','features','files','symbols','gaps']) $(tabName+'-tab').onclick = () => setTab(tabName);
  $('search').oninput = () => { page=60; renderList(); shell.toggleNavigation(true,false); };
  $('more').onclick = () => { page+=60; renderList(); };
  $('more-edges').onclick = () => { edgePage+=50; renderEdges(); };
  for (const id of ['kind','status']) $(id).onchange = () => { edgePage=50; if(projectView.active) {projectView.refresh();renderList();} else {renderMap();renderEdges();} };
  $('zoom-in').onclick = () => { zoom=Math.min(2.5,zoom*1.2); applyZoom(); };
  $('zoom-out').onclick = () => { zoom=Math.max(.5,zoom/1.2); applyZoom(); };
  $('fit').onclick = () => { zoom=1; applyZoom(); };
  // Prefer the most connected project file without assuming any project-specific paths.
  const degree = new Map();
  for (const edge of graph.relations) { const f=fileNode(edge.from); degree.set(f,(degree.get(f)||0)+1); }
  const first = graph.nodes.filter(n=>n.kind==='file' && visible(n)).sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0))[0];
  projectView = createProjectMapView({ graph, api:ProjectMap, make, button, svgEl,
    onFile:id=>select(id), onEvidence:(edge,options)=>showEdge(edge,initialized&&!options?.restore), onNavigation:()=>{page=60;renderList();}, onInspect:()=>{shell.showDetails();shell.toggleNavigation(false,false);}, onEnter:()=>shell.revealMap() });
  featureView = createFeatureMapView({ graph,api:FeatureMap,initial:JSON.parse($('feature-data').textContent),make,button,shell,
    onNode:id=>select(id),onEvidence:edge=>showEdge(edge),onActivate:()=>setTab('features') });
  $('return-project').onclick=()=>setTab('project');
  if (first) select(first.id); else { renderList(); renderMap(); }
  setTab('project'); initialized = true;
})();
