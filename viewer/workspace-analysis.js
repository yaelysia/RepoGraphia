/** External feature-analysis tasks. This panel never launches an Agent or target code. */
'use strict';
function createFeatureWorkView({api, context, guardCurrent, onApplied, navigate, sendReferences, openPanel, openLatest, download}) {
  const $ = id => document.getElementById(id);
  const make = (tag, text, className) => {const node = document.createElement(tag);if (text != null) node.textContent = text;if (className) node.className = className;return node;};
  const button = (label, action, className) => {const node = make('button', label, className);node.type = 'button';node.onclick = action;return node;};
  const short = value => String(value || '').slice(0, 10);
  const time = value => value ? new Date(value).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '时间未记录';
  const kindLabels = {overview:'建立项目粗图',feature:'深入一个功能',changes:'按变化续分析'};
  const statusLabels = {matched:'当前依据匹配','needs-review':'需要复核',unmatched:'原引用未匹配',unverified:'依据尚未核实',unmapped:'尚无代码关联',pending:'待审提案',ready:'待审提案',stale:'旧基线结果',applied:'已应用',rejected:'已拒绝',unexplored:'尚无探索记录',declared:'有探索记录',changed:'探索依据已变化'};
  const decisionLabels = {accepted:'原决定：人工接受',rejected:'原决定：已拒绝',proposed:'原决定：待审'};
  const reasons = {
    'changed-source':'关联源码内容已变化','changed-static-neighborhood':'相关静态关系或上下文已变化',
    'missing-file':'原文件不在当前索引中','missing-node':'原实体未匹配','missing-relation':'原关系未匹配',
    'changed-node-anchor':'实体的位置或类型已变化','changed-relation-anchor':'原关系依据已变化',
    'changed-analysisRevision':'分析规则版本已变化','changed-compilerVersion':'编译器版本已变化',
    'changed-config':'所选编译配置已变化','changed-analysis-inputs':'相关分析输入已变化',
    'old-reference-unverified':'旧依据本身尚未核实','missing-history':'缺少原快照，不能核对',
    'missing-inputs':'缺少原始输入记录，不能核对','snapshot-conflict':'当前代码版本已变化',
    'revision-conflict':'功能标注已变化','feature-conflict':'功能标注已变化',
    'saved-inputs-changed':'已保存的代码输入发生变化，请先刷新代码图','workspace-closed':'本地工作区已关闭，不能再应用修订',
    'original-reference-unverified':'旧引用本身尚未核实','analysis-inputs-unavailable':'缺少可核对的分析输入或配置读取用途记录',
    'missing-indexed-file':'原文件不在当前索引内','exact-anchor-recheck-required':'源码变化后需要重新核对精确位置',
    'ambiguous-node-anchor':'有多个可能位置，不能确定原实体','missing-node-anchor':'没有匹配到原实体位置',
    'changed-node-context':'实体所属上下文已变化','ambiguous-relation-anchor':'原关系无法唯一匹配',
    'changed-relation-evidence':'关系依据已变化','missing-baseline-graph':'缺少原依据代码图',
    'baseline-basis-mismatch':'保存的代码图与原依据版本不一致','unversioned-analysis':'旧分析规则没有版本记录','changed-project-name':'原依据与当前项目名称不同',
    'reference-check-not-semantic-review':'引用核对不等于功能或代码验收','neighborhood-candidate':'相关静态关系包含候选目标',
    'neighborhood-unresolved':'相关关系仍有未解析部分','neighborhood-external':'相关关系触及外部边界',
    'type-only-neighborhood':'相关记录包含仅类型关系','non-call-neighborhood':'相关记录包含非调用关系',
    'incomplete-value-origins':'值来源集合并不完整','truncated-value-origins':'值来源追踪已截断'
  };
  const systemMessages = {
    'Source references and quotes are checked; semantic claims and exploration are declared by the Agent, not independently proved.':'源码引用和节选已经核对；功能解释与探索记录仍来自 Agent 的声明，未经独立证明。',
    'Applying a revision does not accept its mappings. Untouched decisions retain their original basis; changed associations are proposed.':'应用修订不会自动接受关联。未受影响的决定保留原依据；改变的关联进入待审。',
    'A retraction preserves the old record and its history as inactive. Its semantic reason still requires human review.':'撤销关联会保留原记录及历史，并将它停用。撤销理由仍需人工判断。',
    'Static bindings are not runtime proof or a complete call graph.':'静态绑定不是运行结果的证明，也不是完整调用图。',
    'Bounded direct-argument/initializer origins are not whole-program points-to analysis; no reflection, implicit framework callback invocation, or cross-process/IPC/HTTP bridging.':'来源追踪仅涵盖限定范围内的直接参数与初始化值；不覆盖反射、框架隐式回调调用或跨进程、IPC、HTTP 关联。',
    'Function bodies in dependencies and declaration files are outside the index; diagnostics can reduce resolution quality.':'依赖项和声明文件中的函数体不在索引内；编译诊断可能降低解析质量。',
    'Single selected tsconfig; referenced projects require separate analysis. JavaScript follows allowJs in that configuration.':'一次只分析所选 tsconfig；引用的其他项目需要单独分析。JavaScript 是否纳入由该配置的 allowJs 决定。',
    'Getters, setters, decorators, implicit coercions and implicit constructor calls are not exhaustively modeled.':'不会完整建模属性读写方法、装饰器、隐式类型转换和隐式构造调用。',
    'Full rebuild only; node offsets are snapshot-local identities. No incremental-update claims.':'代码图按已保存输入重新构建；源码位置和实体标识仅在各自快照内有效，不能视为稳定的跨版本身份。'
  };
  const textReason = value => typeof value === 'string' ? reasons[value] || value : value?.message || value?.code || '依据需要复核';
  const detail = $('feature-work-detail');
  let data = null, dataKey = '', request = 0, inFlight = null, lastLoaded = 0, visible = false, busy = false;
  let category = 'review', selected = {kind:'home'}, detailRequest = 0, proposalView = null, listLimit = 60;
  let preparation = {kind:'overview',featureId:'',goal:''}, decisionDraft = {actor:'本地审阅者',reason:''};
  const preparationDrafts = new Map(),decisionDrafts = new Map();
  let preparationDirty = false;
  let signature = '', scopeSignature = '', statusOwned = false;

  function message(text, kind = 'info') {
    $('feature-work-status').textContent = text;$('feature-work-status').dataset.kind = kind;statusOwned = !!text;
  }
  function badge(text, status) {const node = make('span', text, 'feature-work-badge');if (status) node.dataset.status = status;return node;}
  function fold(box, title, text) {const node = make('details', null, 'evidence-fold');node.append(make('summary', title));if (text) node.append(make('p', text));box.append(node);return node;}
  function feature(id) {return data?.features?.find(item => item.id === id);}
  function featureTitle(id) {return feature(id)?.title || id || '未命名功能';}
  function featurePath(id) {
    const parts = [],seen = new Set();let item = feature(id);
    while(item && !seen.has(item.id)){parts.unshift(item.title);seen.add(item.id);item = item.parentId ? feature(item.parentId) : null;}
    return parts.join(' / ') || id;
  }
  function taskSnapshot(task) {return task?.basis?.snapshot;}
  function taskDigest(task) {return task?.featureDigest;}
  function taskTitle(task) {return task?.goal || kindLabels[task?.kind] || '功能分析任务';}
  function proposalTaskId(item) {return item?.taskId;}
  function itemStatus(item) {
    if (item?.status !== 'pending') return item?.status || 'pending';
    const task = data?.tasks?.find(task=>task.id === item.taskId),ctx = context();
    return task && (taskSnapshot(task) !== ctx.state?.latestSnapshot || taskDigest(task) !== ctx.state?.feature?.digest) ? 'stale' : 'pending';
  }
  function keyOf(ctx) {return ctx.snapshot && ctx.featureDigest ? ctx.snapshot + ':' + ctx.featureDigest : '';}
  function isCurrent(ctx = context()) {return !!ctx.snapshot && !ctx.readOnly && ctx.snapshot === ctx.state?.latestSnapshot && ctx.featureDigest === ctx.state?.feature?.digest;}
  function reviewFeatures() {return (data?.references?.features || []).filter(item => ['needs-review','unmatched','unverified'].includes(item.status));}
  function explorationRows() {
    const unassigned = new Map();
    for (const node of data?.references?.unassignedNodes || []) unassigned.set(node.file, (unassigned.get(node.file) || 0) + 1);
    return (data?.exploration?.files || []).filter(file => file.status !== 'declared' || unassigned.has(file.path))
      .map(file => ({...file,unassigned:unassigned.get(file.path) || 0}));
  }
  function header(eyebrow, title, summary) {
    detail.replaceChildren(make('span', eyebrow, 'eyebrow'),make('h3', title));
    if (summary) detail.append(make('p', summary, 'feature-work-subtitle'));
  }
  function versions(box, snapshot, digest) {
    const row = make('div', null, 'version-pair');
    for (const [label,value] of [['固定代码版本',snapshot],['固定标注版本',digest]]) {
      const card = make('div', null, 'version-card');card.append(make('strong',label),make('small',short(value) || '未记录'));row.append(card);
    }
    box.append(row);
  }
  function exactDetails(box, label, value) {const node = fold(box, label);node.append(make('pre', JSON.stringify(value, null, 2)));return node;}
  function scopeFiles(box, title, rows) {
    const section = fold(box,`${title} · ${rows.length}`),list = make('ul',null,'feature-work-scope-list');let shown = 0;
    const more = button('',()=>append());section.append(list,more);
    function append() {
      const next = Math.min(shown+60,rows.length);
      for (const row of rows.slice(shown,next)) {const item = make('li');item.append(make('span',row.path));if(row.label)item.append(make('small',row.label));list.append(item);}
      shown = next;more.hidden = shown === rows.length;more.textContent = `再显示 ${Math.min(60,rows.length-shown)} 项（共 ${rows.length} 项）`;
    }
    append();return section;
  }
  function renderCoverage() {
    if (!data) return;
    const files = data.exploration?.files || [], refs = data.references || {}, coverage = $('feature-work-coverage');
    coverage.replaceChildren();
    for (const [label,count,kind] of [['已索引文件',files.length,'indexed'],['有当前探索记录',files.filter(file => file.status === 'declared').length,'explored'],
      ['尚无探索记录',files.filter(file => file.status === 'unexplored').length,'unexplored'],['待复核功能',reviewFeatures().length,'review'],['未归属代码项',refs.unassignedNodes?.length || 0,'unassigned']]) {
      const item = make('div', null, 'feature-work-metric');item.dataset.kind = kind;item.append(make('strong',String(count)),make('span',label));coverage.append(item);
    }
    $('feature-work-count').textContent = reviewFeatures().length ? String(reviewFeatures().length) : '';
    const scope = $('feature-work-scope'),ctx = context(),counts = data.exploration?.summary;
    const nextScopeSignature = JSON.stringify([keyOf(ctx),files.map(file=>[file.path,file.status]),data.coverage,refs.limitations,counts?.limitations]);
    if(scopeSignature === nextScopeSignature)return;
    scopeSignature = nextScopeSignature;scope.replaceChildren(
      make('p',`当前范围：${ctx.state?.workspace.project || '所选项目配置'} · TS/JS 静态索引 · 代码 ${short(refs.snapshot)}。这不是全仓库或运行行为的完成度。`),
      make('p','探索记录来自已应用提案的声明及对应文件版本，不证明 Agent 阅读了所有实现。映射数量不能代替探索记录。'),
      make('p',`另有 ${files.filter(file => file.status === 'changed').length} 个文件保留旧版探索记录。未归属与未探索可能重叠，文件级映射不会自动覆盖其全部函数。`));
    scopeFiles(scope,'已纳入静态索引的文件',files.map(file=>({path:file.path,label:statusLabels[file.status] || file.status})));
    if(data.coverage) {
      const unindexed = data.coverage.unindexed || [],skipped = data.coverage.skippedSymlinks || [],ignored = data.coverage.ignoredDirectories || [];
      scope.append(make('p',`另发现 ${unindexed.length} 个源码文件未进入当前索引，略过 ${skipped.length} 个符号链接、${ignored.length} 个目录。未索引部分不计入上方探索记录。`));
      if(unindexed.length)scopeFiles(scope,'发现但未索引的源码',unindexed.map(file=>({path:file.path,label:{'outside-selected-program':'不在所选编译配置的范围内','unsupported-language':'当前不支持这种语言的静态索引'}[file.reason] || file.reason})));
      if(skipped.length)scopeFiles(scope,'略过的符号链接',skipped.map(path=>({path})));
      if(ignored.length)scopeFiles(scope,'扫描中忽略的目录',ignored.map(path=>({path})));
      if(data.coverage.limitations?.length){const limits = fold(scope,'静态索引的规则与限制');for(const limitation of data.coverage.limitations)limits.append(make('p',systemMessages[limitation] || limitation));exactDetails(limits,'原始索引限制',data.coverage.limitations);}
    }
    for (const limitation of refs.limitations || []) scope.append(make('p', limitation));
    if (counts?.limitations) for (const text of counts.limitations) scope.append(make('p',text));
  }
  function categoryRows() {
    if (category === 'review') return reviewFeatures().map(item => ({id:item.id,title:featureTitle(item.id),subtitle:(item.reasons || []).slice(0,2).map(textReason).join('；') || '关联依据需要重新核对',status:item.status,kind:'review'}));
    if (category === 'explore') return explorationRows().map(item => ({id:item.path,title:item.path,subtitle:[statusLabels[item.status],item.unassigned ? `${item.unassigned} 个实体尚无功能归属` : ''].filter(Boolean).join(' · '),status:item.status,kind:'explore'}));
    if (category === 'tasks') return [...(data?.tasks || [])].reverse().map(item => ({id:item.id,title:taskTitle(item),subtitle:`${kindLabels[item.kind] || '功能分析'} · ${time(item.createdAt)}`,status:'task',kind:'task'}));
    return [...(data?.proposals || [])].reverse().map(item => {const task = data.tasks?.find(task => task.id === proposalTaskId(item));return {id:item.id,title:item.summary || taskTitle(task),subtitle:`${statusLabels[itemStatus(item)] || itemStatus(item)} · ${time(item.createdAt)}`,status:itemStatus(item),kind:'proposal'};});
  }
  function renderLists() {
    const nav = $('feature-work-categories');nav.replaceChildren();
    for (const [id,label,count] of [['review','待复核',reviewFeatures().length],['explore','待探索',explorationRows().length],['tasks','分析任务',data?.tasks?.length || 0],['proposals','返回提案',data?.proposals?.length || 0]]) {
      const control = button('',()=>{category = id;listLimit = 60;selected = {kind:'home'};proposalView = null;renderLists();renderHome();});
      control.dataset.category = id;control.setAttribute('aria-pressed',String(category === id));control.append(make('span',label),make('small',String(count)));nav.append(control);
    }
    const list = $('feature-work-list'),scroll = list.scrollTop;list.replaceChildren();const rows = categoryRows();
    if (!rows.length) list.append(make('p', {review:'当前没有需要复核的关联。尚未建立的功能，可从项目粗图开始。',explore:'当前范围没有这类待探索记录。它不代表项目行为已经完整验证。',tasks:'还没有准备分析任务。',proposals:'外部 Agent 返回提案后，从上方导入。'}[category], 'feature-work-list-empty'));
    for (const item of rows.slice(0,listLimit)) {
      const node = button('',()=>selectItem(item.kind,item.id),'feature-work-item');node.dataset.itemId = item.id;node.dataset.itemKind = item.kind;
      node.setAttribute('aria-pressed',String(selected.kind === item.kind && selected.id === item.id));node.append(make('strong',item.title),make('small',item.subtitle));list.append(node);
    }
    if(rows.length > listLimit) list.append(button(`再显示 ${Math.min(60,rows.length-listLimit)} 项（共 ${rows.length} 项）`,()=>{listLimit += 60;renderLists();}));
    list.scrollTop = scroll;
  }
  function renderHome() {
    selected = {kind:'home'};proposalView = null;
    header('BUILD UNDERSTANDING',data?.features?.length ? '继续补齐还不清楚的部分' : '先为项目建立一张粗图',
      '功能名称和一句解释帮助你理解项目；代码依据帮助你核对解释。可以分批探索，再按实际深度继续细化。');
    const choices = make('div',null,'feature-task-kinds');
    for (const [kind,title,description] of [['overview','建立项目粗图','梳理当前索引范围的主要能力'],['feature','深入一个功能','沿已有功能继续拆分和补充依据'],['changes','按变化续分析','处理待复核功能和未归属代码']]) {
      const control = button('',()=>prepare(kind),'feature-task-kind');control.append(make('strong',title),make('small',description));choices.append(control);
    }
    detail.append(choices,make('p','网页负责准备和审阅。任务包交给你现有的 Codex 执行，这里不会自动运行 Agent 或目标项目。','feature-work-meta'));
    if (!isCurrent()) detail.append(button('切换到当前版本准备任务',openLatest));
  }
  function renderFeature(id) {
    const item = data.references.features.find(item => item.id === id), f = feature(id);if (!item) return renderHome();
    header('REFERENCE REVIEW',featureTitle(id),f?.summary || '查看哪些关联依据发生了变化，再决定是否准备续分析任务。');
    detail.append(badge(statusLabels[item.status] || item.status,item.status));
    const actions = make('div',null,'feature-work-inline-actions');actions.append(button('在功能图中查看',()=>navigate({featureId:id})),button('围绕这个功能继续分析',()=>prepare('feature',id),'primary'));detail.append(actions);
    for (const mapping of data.references.mappings.filter(mapping => mapping.featureId === id)) {
      const row = make('div',null,'evidence-record');row.append(make('strong',mapping.id),badge(statusLabels[mapping.status] || mapping.status,mapping.status),make('small',decisionLabels[mapping.decision] || mapping.decision));
      row.append(make('p',(mapping.reasons || []).map(textReason).join('；') || '精确静态依据仍匹配。它不表示业务行为或本轮代码已经验收。','feature-work-meta'));
      row.append(make('small',`原依据 ${short(mapping.originalBasis?.snapshot)} · 当前核对 ${short(data.references.snapshot)}`));
      if (mapping.current?.nodeId) row.append(button('查看核对后的代码依据',()=>navigate({nodeId:mapping.current.nodeId,snapshot:data.references.snapshot})));
      if (mapping.warnings?.length) row.append(make('p',mapping.warnings.map(textReason).join('；'),'feature-work-meta'));
      exactDetails(row,'原决定与引用核对记录',mapping);detail.append(row);
    }
  }
  function renderExplore(path) {
    const file = data.exploration.files.find(item => item.path === path), nodes = data.references.unassignedNodes.filter(item => item.file === path);
    header('UNEXPLORED SCOPE',path,'未探索和没有功能归属是不同的情况。保留这些空白，继续寻找可靠依据。');
    if (file) detail.append(badge(statusLabels[file.status],file.status));detail.append(badge(`${nodes.length} 个实体无明确归属`));
    detail.append(make('p','按变化准备任务时，范围由当前待复核项和未归属代码共同确定；这里的文件名称只补充目标，不冒充范围约束。','feature-work-meta'),button('按变化准备分析任务',()=>prepare('changes','',`检查 ${path} 及当前待复核、未归属代码，补充可靠的功能解释。`),'primary'));
    for (const node of nodes.slice(0,50)) {const row = make('div',null,'evidence-record');row.append(make('strong',node.name),make('small',`${node.kind} · ${node.file}`),button('查看当前代码',()=>navigate({nodeId:node.id,snapshot:data.references.snapshot})));detail.append(row);}
    if (nodes.length > 50) detail.append(make('p',`这里只展示前 50 个实体；还有 ${nodes.length-50} 个，任务准备使用完整范围。`,'budget-note'));
    if (file) exactDetails(detail,'探索记录对应的文件版本',file);
  }
  function field(form,label,value,{multiline=false,required=false,maxLength=4000} = {}) {
    const wrapper = make('label',label,'feature-work-field'),input = make(multiline ? 'textarea' : 'input');
    input.value = value;input.required = required;input.maxLength = maxLength;input.setAttribute('aria-label',label);wrapper.append(input);form.append(wrapper);return input;
  }
  function prepare(kind = preparation.kind, featureId = preparation.featureId, goal) {
    if (!['overview','feature','changes'].includes(kind)) kind = 'overview';
    preparationDrafts.set(preparation.kind+':'+preparation.featureId,preparation.goal);
    preparation = {kind,featureId:featureId || '',goal:goal ?? preparationDrafts.get(kind+':'+(featureId || '')) ?? ''};
    selected = {kind:'prepare'};proposalView = null;message('');openPanel();renderLists();renderPreparation();
  }
  function renderPreparation() {
    header('PREPARE AN ANALYSIS TASK','准备一个有明确范围的任务','先固定代码与标注版本，再把任务交给现有 Codex。后续变化不会偷偷改写已导出的任务包。');
    const form = make('form');form.id = 'feature-task-form';
    const kinds = make('div',null,'feature-task-kinds');
    for (const [kind,label] of Object.entries(kindLabels)) {
      const control = button('',()=>prepare(kind,preparation.featureId),'feature-task-kind');control.dataset.taskKind = kind;control.setAttribute('aria-pressed',String(preparation.kind === kind));
      control.append(make('strong',label),make('small',{overview:'当前索引范围内的主要功能',feature:'所选功能及允许修订的关联',changes:'需要复核和继续探索的范围'}[kind]));kinds.append(control);
    }
    form.append(kinds);
    if (preparation.kind === 'feature') {
      const label = make('label','选择要深入的功能','feature-work-field'),select = make('select');select.id = 'feature-task-feature';select.required = true;
      const empty = make('option','选择一个已有功能');empty.value = '';select.append(empty);
      for (const item of data?.features || []) {const option = make('option',featurePath(item.id));option.value = item.id;select.append(option);}
      select.value = preparation.featureId;select.onchange = () => {preparation.featureId = select.value;};label.append(select);form.append(label);
    }
    const defaults = {overview:'梳理当前索引范围内的主要功能。每个功能给出名称、一句解释和可核对的代码依据，并说明尚未探索的部分。',feature:'继续拆解这个功能，补充需要的子功能和代码依据，保留不确定事项。',changes:'复核代码变化影响的功能关联，并探索尚无明确归属的代码。只提交有依据的局部修订。'};
    if (!preparation.goal) preparation.goal = defaults[preparation.kind];
    const goal = field(form,'本次希望弄清什么？',preparation.goal,{multiline:true,required:true,maxLength:2000});goal.id = 'feature-task-goal';goal.oninput = () => {preparation.goal = goal.value;preparationDirty = true;};
    const ctx = context();versions(form,ctx.snapshot,ctx.featureDigest);
    form.append(make('p','最终允许修订的功能、关联和代码范围由任务契约确定；生成后可查看完整范围。任务目标中的自然语言不扩大该范围。','feature-work-meta'));
    if (!isCurrent(ctx)) form.append(make('p','当前阅读版本不是最新可写基线。请先切换到当前版本；地图中的编辑会先受到保护。','feature-work-callout'),button('切换到当前版本',openLatest));
    const actions = make('div',null,'feature-work-inline-actions'),submit = make('button','生成固定任务包','primary');submit.type = 'submit';submit.id = 'feature-task-create';submit.disabled = busy || !ctx.snapshot;
    actions.append(submit,button('返回待办',()=>{selected = {kind:'home'};renderLists();renderHome();}));form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault();if (busy) return;busy = true;submit.disabled = true;
      const requested = {...preparation,goal:preparation.goal.trim()};
      try {
        const result = await guardCurrent('准备分析任务',ctx => api('/api/feature-tasks','POST',{kind:requested.kind,...(requested.kind === 'feature' ? {featureId:requested.featureId} : {}),goal:requested.goal,expectedSnapshot:ctx.snapshot,expectedFeatureDigest:ctx.featureDigest}));
        preparationDirty = false;
        category = 'tasks';selected = {kind:'task',id:result.task.id};await refresh(true);renderTask(result.task);
        message('任务包已准备。下载后交给现有 Codex；网页不会自动运行它。','success');
      } catch (error) {message(error.message,'error');} finally {busy = false;if (submit.isConnected) submit.disabled = false;}
    };
    detail.append(form);
  }
  async function exportTask(task) {
    try {const text = await api('/api/feature-tasks/'+encodeURIComponent(task.id)+'/bundle','GET',undefined,true);download(text,'repographia-task-'+task.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.json','application/json');message('已请求下载固定任务包。可以重复导出，内容仍绑定原基线。','success');}
    catch (error) {message('任务包导出失败：'+error.message,'error');}
  }
  function renderTask(task) {
    if (!task) return renderHome();selected = {kind:'task',id:task.id};proposalView = null;
    header('EXTERNAL ANALYSIS TASK',kindLabels[task.kind] || '功能分析任务',taskTitle(task));
    detail.append(badge('任务包已准备'),make('p','执行状态未知。下载、代码文件变化和返回提案都不能证明 Agent 当前正在做什么。','feature-work-meta'));
    versions(detail,taskSnapshot(task),taskDigest(task));
    detail.append(make('p',`${task.allowed.files.length} 个允许查看的文件 · ${task.allowed.featureIds.length} 个允许修订的已有功能 · ${task.allowed.mappingIds.length} 条允许修订的已有关联`,'feature-work-meta'));
    if(task.allowed.parentId) detail.append(make('p','深入范围：'+featureTitle(task.allowed.parentId),'feature-work-meta'));
    const actions = make('div',null,'feature-work-inline-actions');actions.append(button('下载任务包',()=>exportTask(task),'primary'),button('导入返回提案',showImport));detail.append(actions);
    detail.append(make('h4','交给现有 Codex'),make('p','在 RepoGraphia 工具目录使用任务包中的约定查询代码并生成修订提案。把返回的提案 JSON 导入这里，再看差异并决定是否应用。','feature-work-subtitle'));
    const filename = 'repographia-task-'+task.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.json';
    const command = make('pre',`node dist/cli.js agent task overview "./${filename}"\n\nnode dist/cli.js agent task check "./${filename}" "./revision.json" --author "Codex"\n\nnode dist/cli.js agent task submit "./${filename}" "./revision.json" --author "Codex" --out "./task-result-new"`,'feature-work-command');detail.append(command);
    detail.append(make('p','最后一条命令的输出目录必须尚不存在。导入其中的 revision.json；检查与提交都不会直接应用到工作区。','feature-work-meta'));
    exactDetails(detail,'允许修订的对象与固定任务内容',task);
    const returned = data?.proposals?.filter(item => proposalTaskId(item) === task.id) || [];
    if (returned.length) {const box = fold(detail,`返回结果 · ${returned.length}`);box.open = true;for (const item of returned) box.append(button(`${statusLabels[itemStatus(item)] || itemStatus(item)} · ${time(item.createdAt)}`,()=>selectItem('proposal',item.id)));}
    renderLists();
  }
  function showImport() {if (busy) return;$('feature-import-status').textContent = '';$('feature-result-file').value = '';$('feature-import-dialog').showModal();}
  function selectItem(kind,id) {
    selected = {kind,id};proposalView = null;message('');renderLists();
    if (kind === 'review') renderFeature(id);
    else if (kind === 'explore') renderExplore(id);
    else if (kind === 'task') renderTask(data.tasks.find(item => item.id === id));
    else if (kind === 'proposal') void loadProposal(id);
  }
  function sideContent(box,value,side) {
    if (value == null) {box.append(make('p','无','feature-work-meta'));return;}
    if (typeof value !== 'object') {box.append(make('p',String(value)));return;}
    if (value.title) box.append(make('p',value.title));
    if (value.summary) box.append(make('p',value.summary));
    if (value.title) {
      const changedParent = proposalView?.review.changes.find(change=>change.kind === 'feature' && change[side]?.id === value.parentId)?.[side];
      const savedParent = data?.references.featureDigest === taskDigest(proposalView?.task) ? feature(value.parentId) : null;
      box.append(make('p','所属功能：'+(value.parentId ? changedParent?.title || savedParent?.title || value.parentId : '顶层功能'),'feature-work-meta'));
    }
    if (value.rationale) box.append(make('p',value.rationale));
    if (value.code) box.append(make('p',`${value.code.name || value.code.nodeId} · ${value.code.file}`,'feature-work-meta'));
    else if (value.nodeId) box.append(make('p','代码实体：'+value.nodeId,'feature-work-meta'));
    if (value.role) box.append(make('p','关联角色：'+({entry:'入口',implementation:'实现',support:'支撑',test:'测试代码（未运行）'}[value.role] || value.role),'feature-work-meta'));
    if (value.decision) box.append(make('p','关联状态：'+({accepted:'人工接受，仍保留原依据',rejected:'停用／已拒绝',proposed:'待审'}[value.decision] || value.decision),'feature-work-meta'));
    if (!value.title && !value.rationale && !value.code && !value.nodeId) box.append(make('p',JSON.stringify(value),'feature-work-meta'));
    if (value.description) {const more = fold(box,'完整说明');more.append(make('p',value.description));}
    if (value.questions?.length) {const more = fold(box,`待确认问题 · ${value.questions.length}`);for (const question of value.questions) more.append(make('p',question));}
  }
  function renderProposal(result) {
    proposalView = result;const {proposal,metadata,task,review} = result;selected = {kind:'proposal',id:metadata.id};
    decisionDraft = decisionDrafts.get(metadata.id) || {actor:decisionDraft.actor,reason:''};decisionDrafts.set(metadata.id,decisionDraft);
    header('REVIEW A PROPOSED CHANGE',proposal.summary,'先阅读本批改了什么，再决定是否加入功能图。应用修订不会自动接受代码映射，也不表示测试通过。');
    detail.append(make('p',`提案来源：${metadata.author}（自述，未认证） · 导入于 ${time(metadata.createdAt)}`,'feature-work-meta'));
    detail.append(badge(statusLabels[review.status] || review.status,review.status));versions(detail,taskSnapshot(task),taskDigest(task));
    const eligibility = make('div');eligibility.id = 'feature-proposal-eligibility';detail.append(eligibility);
    const changes = Array.isArray(review.changes) ? review.changes : [];
    const summary = make('div',null,'feature-proposal-summary');
    for(const [key,label] of [['addedFeatures','新增功能'],['revisedFeatures','修改功能'],['addedMappings','新增关联'],['replacedMappings','替换关联'],['retractions','撤销关联'],['resetMappings','关联回到待审']])if(review.summary[key])summary.append(badge(`${review.summary[key]} 项${label}`,key === 'resetMappings' ? 'needs-review' : undefined));
    summary.append(badge(`${review.exploredFiles?.length || 0} 个文件的探索声明`));detail.append(summary);
    if(review.summary.resetMappings)detail.append(make('p',`功能说明变化后，${review.summary.resetMappings} 条原已接受的关联将回到待审。原接受决定与依据仍保留在历史中；下方逐项列出这些状态变化。`,'feature-work-callout'));
    if(changes.length){
      const label = make('label','逐项查看本批变化','feature-work-field'),select = make('select');select.id = 'feature-change-select';
      const changeTitle = change => `${change.action === 'review-reset' ? '关联回到待审' : {feature:'功能内容',mapping:'代码关联',retraction:'撤销关联'}[change.kind]} · ${change.after?.title || change.before?.title || change.after?.code?.name || change.before?.code?.name || change.id}`;
      changes.forEach((change,index)=>{const option = make('option',`${index+1} / ${changes.length} · ${changeTitle(change)}`);option.value = index;select.append(option);});label.append(select);detail.append(label);
      const display = make('div');display.id = 'feature-change-display';detail.append(display);
      function showChange(index){
        const change = changes[index],row = make('article',null,'feature-proposal-change');row.dataset.changeIndex = index;row.dataset.changeAction = change.action;
        row.append(make('h4',changeTitle(change)),make('p',change.action === 'review-reset' ? '功能说明变化，关联回到待审。需要按新的功能含义重新判断；原接受决定与依据保留在历史中。' : change.reason,'feature-work-subtitle'));
        if(change.kind === 'retraction')row.append(make('p','撤销使这条关联退出使用；原记录、依据和此前决定保留在历史中。','feature-work-callout'));
        const columns = make('div',null,'feature-proposal-columns');
        for(const [side,title] of [['before','原内容'],['after','提议内容']]){const column = make('div',null,'feature-proposal-side');column.dataset.side = side;column.append(make('strong',title));sideContent(column,change[side],side);columns.append(column);}
        row.append(columns);exactDetails(row,'精确变更记录',change);display.replaceChildren(row);
        const controls = make('div',null,'feature-work-inline-actions');
        const previous = button('上一项',()=>{select.value = index-1;showChange(index-1);});previous.disabled = index === 0;
        const next = button('下一项',()=>{select.value = index+1;showChange(index+1);});next.disabled = index === changes.length-1;
        controls.append(previous,next);display.append(controls);
      }
      select.onchange = ()=>showChange(Number(select.value));showChange(0);
    }
    if (!changes.length) detail.append(make('p','本批没有功能内容改动。探索记录和限制仍需一起阅读。','feature-work-meta'));
    const checks = fold(detail,`支持与限制依据 · ${review.checks?.length || 0}`);
    for (const check of review.checks || []) {const item = make('div',null,'evidence-record');item.append(make('strong',check.kind === 'limit' ? '限制依据' : '支持依据'),make('p',check.explanation || ''),make('small',check.quote || ''),make('small',`${check.file} · UTF-16 [${check.start}, ${check.end})`),button('在固定代码版本中查看',()=>navigate({snapshot:taskSnapshot(task),featureDigest:taskDigest(task),nodeId:check.nodeId})));exactDetails(item,'精确来源',check);checks.append(item);}
    const explored = fold(detail,'本批探索范围与未探索事项','探索是外部 Agent 的声明，文件与内容版本可核对；不能把它理解为完整行为证明。');
    for (const file of review.exploredFiles || []) explored.append(make('p',typeof file === 'string' ? file : `${file.path} · SHA-256 ${file.hash}`));
    for (const item of review.unexplored || []) explored.append(make('p','未探索：'+(typeof item === 'string' ? item : JSON.stringify(item))));
    const warnings = fold(detail,'提案适用限制','以下是系统核对范围。提案中的功能解释仍需你判断。');
    for(const warning of review.warnings || [])warnings.append(make('p',systemMessages[warning] || warning,'feature-work-meta'));
    if(review.warnings?.length)exactDetails(warnings,'原始系统提示',review.warnings);
    const decision = make('section',null,'feature-proposal-decision');decision.append(make('h4','本批决定'));
    if (!['applied','rejected'].includes(review.status)) {
      const actor = field(decision,'审阅者（自述，未认证）',decisionDraft.actor,{required:true,maxLength:200});actor.id = 'feature-proposal-actor';actor.oninput = () => {decisionDraft.actor = actor.value;};
      const reason = field(decision,'本次决定的理由',decisionDraft.reason,{multiline:true,required:true});reason.id = 'feature-proposal-reason';reason.oninput = () => {decisionDraft.reason = reason.value;};
      const actions = make('div',null,'feature-work-inline-actions');
      const apply = button('应用本批修订',()=>decide('apply'),'primary');apply.id = 'feature-proposal-apply';
      const reject = button('拒绝本批提案',()=>decide('reject'));reject.id = 'feature-proposal-reject';
      actions.append(apply,reject,button('按当前版本重新准备',()=>prepare(task.kind,task.allowed.parentId || '',task.goal)));decision.append(actions);
      decision.append(make('p','本批原子应用。新增和改变含义的内容进入待审，原内容与人工决定保留历史；不在这里把局部操作拆开应用。','feature-work-meta'));
    } else {
      decision.append(make('p',review.status === 'applied' ? '这批内容已经写入标注历史。后续代码或标注变化，不会改变当时的决定。' : '这批提案已拒绝，原功能内容与人工决定没有被它覆盖。'));
      if(metadata.decision)decision.append(make('p',`${metadata.decision.actor}（自述） · ${time(metadata.decision.at)} · ${metadata.decision.reason}`,'feature-work-meta'));
    }
    detail.append(decision);exactDetails(detail,'固定原始提案',proposal);updateEligibility();renderLists();
  }
  function updateEligibility() {
    if (!proposalView || selected.kind !== 'proposal') return;
    const {task,review} = proposalView, ctx = context(), box = $('feature-proposal-eligibility');if (!box) return;
    const stale = taskSnapshot(task) !== ctx.state?.latestSnapshot || taskDigest(task) !== ctx.state?.feature?.digest;
    const savedMetadata = data?.proposals?.find(item=>item.id === selected.id);
    const changedDecision = savedMetadata && ['applied','rejected'].includes(savedMetadata.status) && savedMetadata.status !== review.status;
    const showOriginal = !!box.querySelector('details')?.open;
    box.replaceChildren();
    const messages = (review.reasons || []).map(textReason);
    if (stale && !['applied','rejected'].includes(review.status)) messages.unshift('当前代码或标注已经变化。这份结果仍按旧基线展示，不能直接应用。');
    if (messages.length) {box.append(make('p',[...new Set(messages)].join('\n'),'feature-work-callout'));exactDetails(box,'原始适用性核对',{status:review.status,reasons:review.reasons || []}).open = showOriginal;}
    if(changedDecision)box.append(make('p','这份提案已在其他操作中记录了决定。当前差异保持原样，可以明确读取已保存的决定。','feature-work-callout'),button('查看已保存的决定',()=>loadProposal(selected.id)));
    if (!isCurrent(ctx) && review.status === 'ready') box.append(make('p','切换到当前代码与标注后才能应用；地图中的草稿会先受到保护。','feature-work-meta'));
    const apply = $('feature-proposal-apply');if (apply) apply.disabled = busy || review.status !== 'ready' || stale || !isCurrent(ctx) || !!changedDecision;
    const reject = $('feature-proposal-reject');if (reject) reject.disabled = busy || !!changedDecision;
  }
  async function loadProposal(id) {
    const request = ++detailRequest;header('REVIEW A PROPOSED CHANGE','正在读取固定提案','当前地图和草稿仍保留。');
    try {const result = await api('/api/feature-proposals/'+encodeURIComponent(id));if (request === detailRequest && selected.kind === 'proposal' && selected.id === id) renderProposal(result);}
    catch (error) {if (request === detailRequest) {header('REVIEW A PROPOSED CHANGE','无法读取提案',error.message);message(error.message,'error');}}
  }
  async function decide(decision) {
    if (busy || !proposalView) return;
    if (!decisionDraft.actor.trim() || !decisionDraft.reason.trim()) {message('请填写自述审阅者和本次决定的理由。','error');return;}
    busy = true;updateEligibility();const id = selected.id,actor = decisionDraft.actor.trim(),reason = decisionDraft.reason.trim();
    try {
      let result;
      const write = ctx => api('/api/feature-proposals/'+encodeURIComponent(id)+'/decision','POST',{decision,expectedFeatureDigest:ctx.featureDigest,expectedSnapshot:ctx.snapshot,actor,reason});
      if (decision === 'apply') result = await guardCurrent('应用功能修订',write);
      else result = await write(context());
      if (decision === 'apply') await onApplied(result);
      decisionDraft.reason = '';await refresh(true);await loadProposal(id);
      message(decision === 'apply' ? '本批修订已保存。改动内容保持待审，原决定仍可追溯。' : '已记录拒绝。原功能内容与地图草稿保留。','success');
    } catch (error) {message(error.message,'error');if (error.status === 409) await loadProposal(id);}
    finally {busy = false;updateEligibility();}
  }
  async function refresh(force = false) {
    const ctx = context(), key = keyOf(ctx);if (!key) return;
    if (inFlight && !force) return inFlight;
    if (!force && key === dataKey && Date.now()-lastLoaded < 6000) return;
    const sequence = ++request;lastLoaded = Date.now();
    inFlight = (async () => {
      try {
        const result = await api('/api/feature-work?'+new URLSearchParams({snapshot:ctx.snapshot,featureDigest:ctx.featureDigest}));
        if (sequence !== request || key !== keyOf(context())) return;
        const changedBasis = dataKey !== key;
        data = result;dataKey = key;if(changedBasis)sendReferences(result.references);renderCoverage();renderLists();updateEligibility();
        if (selected.kind === 'home') renderHome();
        else if(changedBasis && selected.kind === 'prepare')renderPreparation();
        if (!statusOwned) message(isCurrent() ? '引用核对与探索记录对应正在审阅的固定版本。' : '正在查看旧版范围；新任务和应用操作需要当前版本。');
      } catch (error) {if (sequence === request) message('功能建设数据尚未载入：'+error.message,'error');}
      finally {if (sequence === request) inFlight = null;}
    })();return inFlight;
  }
  function update() {
    const ctx = context();$('feature-work-prepare').disabled = !ctx.snapshot || busy;$('feature-work-import').disabled = busy;
    const currentSignature = [ctx.snapshot,ctx.featureDigest,ctx.state?.latestSnapshot,ctx.state?.feature?.digest].join(':');
    if (currentSignature !== signature) {signature = currentSignature;updateEligibility();}
    if (keyOf(ctx) && (keyOf(ctx) !== dataKey || visible && Date.now()-lastLoaded >= 6000)) void refresh();
  }
  $('feature-work-prepare').onclick = () => prepare('overview');$('feature-work-import').onclick = showImport;
  $('feature-import-cancel').onclick = () => {if (!busy) $('feature-import-dialog').close();};
  $('feature-import-dialog').addEventListener('cancel',event=>{if (busy) event.preventDefault();});
  $('feature-import-form').onsubmit = async event => {
    event.preventDefault();if (busy) return;const file = $('feature-result-file').files[0];if (!file) return;
    busy = true;$('feature-import-confirm').disabled = true;$('feature-import-cancel').disabled = true;$('feature-import-status').textContent = '正在核对并保存待审结果…';
    try {
      if (file.size > 5*1024*1024) throw new Error('提案文件超过 5 MiB');
      const proposal = JSON.parse(await file.text()), author = $('feature-result-author').value.trim();if (!author) throw new Error('请填写来源名称。');
      const result = await api('/api/feature-proposals','POST',{proposal,author});
      $('feature-import-dialog').close();category = 'proposals';selected = {kind:'proposal',id:result.proposal.id};openPanel();await refresh(true);await loadProposal(result.proposal.id);
      message('结果已保存为待审提案。当前功能图和草稿没有被导入操作改写。','success');
    } catch (error) {$('feature-import-status').textContent = '导入失败：'+error.message;}
    finally {busy = false;$('feature-import-confirm').disabled = false;$('feature-import-cancel').disabled = false;updateEligibility();}
  };
  return {
    update,
    show(value) {visible = value;if (value) {if (!data) renderHome();void refresh();}},
    request(input) {prepare(input.kind,input.featureId || '',input.goal);},
    refresh:() => refresh(true),
    invalidate() {dataKey = '';update();},
    references() {if (dataKey === keyOf(context()) && data) sendReferences(data.references);},
    hasDraft() {return preparationDirty || [...decisionDrafts.values()].some(item=>!!item.reason.trim());}
  };
}
