(() => {
  'use strict';
  const $ = id => document.getElementById(id), channel = 'repographia-workspace-v1';
  const make = (tag, text, className) => {const node = document.createElement(tag);if (text != null) node.textContent = text;if (className) node.className = className;return node;};
  const button = (text, action, className) => {const node = make('button', text, className);node.onclick = action;return node;};
  const short = value => String(value || '').slice(0, 10);
  const time = value => value ? new Date(value).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '尚未核对';
  let token = new URLSearchParams(location.hash.slice(1)).get('token');
  try {if (token) sessionStorage.setItem('repographia-token', token);else token = sessionStorage.getItem('repographia-token');} catch {}
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  let state = null, frame = $('workspace-report'), snapshot = null, featureDigest = null, featureBasis = null;
  let instance = null, readOnly = false, dirty = false, draft = false, reportLoading = false, reportSequence = 0;
  let queuedSave = null, saving = null, saveTimer = null, saveFailure = null, savedAt = null;
  let taskId = null, comparison = null, diffSequence = 0, selectedFile = null, mode = 'map', polling = false, baselineBusy = false;
  let featureWork = null, developmentReview = null, featureMutationBusy = false, viewContext = null, pendingNavigation = null;
  let taskPreparationDigest = null, taskPreparationSequence = 0;

  function notice(message, kind = 'info', source = 'action') {$('workspace-notice').textContent = message;$('workspace-notice').dataset.kind = kind;$('workspace-notice').dataset.source = source;$('workspace-notice').hidden = !message;}
  async function api(route, method = 'GET', body, plain = false) {
    const response = await fetch(route, {method, credentials:'omit', mode:'same-origin', cache:'no-store',
      headers:{'X-RepoGraphia-Token':token, ...(body === undefined ? {} : {'Content-Type':'application/json'})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    if (!response.ok) {
      let error;try {error = await response.json();} catch {}
      const failure = new Error(error?.message || error?.error || `请求失败（${response.status}）`);
      failure.status = response.status;throw failure;
    }
    return plain ? response.text() : response.json();
  }
  function send(type, data = {}) {if (instance) frame.contentWindow?.postMessage({channel, instance, snapshot, type, ...data}, location.origin);}
  function saveState() {
    const label = $('save-status'), box = label.parentElement;
    box.dataset.state = saveFailure ? 'error' : saving || queuedSave ? 'saving' : 'saved';
    label.textContent = readOnly ? '历史标注 · 只读' : saveFailure ? (saveFailure.status === 409 ? '保存冲突 · 草稿已保留' : '保存失败 · 草稿已保留') :
      saving || queuedSave ? '正在保存标注…' : draft ? '有尚未应用的编辑' : dirty ? '标注尚未保存' : instance ? (savedAt ? `标注已保存 · ${time(savedAt)}` : '标注已载入') : '正在载入标注';
    $('retry-save').hidden = !saveFailure || saveFailure.status === 409;
    $('export-draft').hidden = !saveFailure;
    $('reload-saved').hidden = !saveFailure;
    updateVersionNotice();
  }
  function updateVersionNotice() {
    if (!state) return;
    const newerCode = state.latestSnapshot && state.latestSnapshot !== snapshot;
    const newerFeatures = instance && !readOnly && !dirty && !saving && !queuedSave && state.feature?.digest !== featureDigest;
    const show = !!(snapshot && (newerCode || newerFeatures || readOnly));
    $('open-latest').hidden = !show;$('open-latest').disabled = reportLoading;
    $('open-latest').textContent = readOnly ? '返回当前版本' : newerCode ? '查看新代码版本' : '载入更新后的标注';
    $('latest-version').textContent = state.latestSnapshot ? '最近成功代码版本 ' + short(state.latestSnapshot) : '尚无成功版本';
    const basis = $('feature-basis-notice');basis.replaceChildren();
    basis.hidden = !featureBasis || featureBasis === snapshot;
    if (!basis.hidden) {
      basis.append(make('span', `功能标注仍依据 ${short(featureBasis)}，当前代码为 ${short(snapshot)}。原内容与人工决定已保留，逐项引用核对见“功能建设”。`));
      if (state.snapshots.some(item => item.id === featureBasis)) basis.append(button('查看标注依据版本', () => loadReport(featureBasis, {featureDigest, readOnly})));
    }
  }
  function setOptions(select, items, selected, emptyLabel) {
    const signature = JSON.stringify(items);
    if (select.dataset.options !== signature) {
      select.replaceChildren();
      if (!items.length && emptyLabel) {const option = make('option', emptyLabel);option.value = '';select.append(option);}
      for (const [value, label] of items) {const option = make('option', label);option.value = value;select.append(option);}
      select.dataset.options = signature;
    }
    select.value = selected || '';
  }
  function renderState(next) {
    state = next;document.body.dataset.analysis = state.status;
    $('workspace-name').textContent = state.workspace.name;
    const labels = {starting:'正在建立代码图',checking:'正在核对文件',analyzing:'正在更新代码图',current:'已核对当前代码',changed:'发现变化，等待更新',error:'更新失败，保留旧版本',closed:'观察已停止'};
    $('analysis-status').textContent = state.statusMessage || labels[state.status] || state.status;
    $('analysis-status').title = state.statusMessage || '';
    $('last-checked').textContent = state.lastCheckedAt ? '最近核对 ' + time(state.lastCheckedAt) : '仅观察已保存的文件';
    $('workspace-location').textContent = state.workspace.root;
    $('workspace-scope').textContent = `已保存文件 · ${state.workspace.project || '默认项目范围'} · 本地观察`;
    $('refresh-workspace').disabled = state.status === 'closed';
    $('start-task').disabled = !state.latestSnapshot || baselineBusy || featureMutationBusy || state.status === 'closed';
    $('export-report').disabled = !snapshot || reportLoading || featureMutationBusy;
    $('viewed-version').disabled = !state.snapshots.length || reportLoading || featureMutationBusy;
    setOptions($('viewed-version'), [...state.snapshots].reverse().map(item => [item.id, `${time(item.verifiedAt || item.createdAt)} · ${short(item.id)}`]), snapshot);
    if (!taskId || !state.tasks.some(item => item.id === taskId)) taskId = state.view?.taskId || state.activeTaskId || state.tasks.at(-1)?.id || null;
    setOptions($('task-select'), [...state.tasks].reverse().map(task => [task.id, task.title]), taskId, '尚未记录起点');
    $('open-task-start').disabled = !taskId;
    if (state.error) notice('代码更新失败：' + state.error + '。上一份有效图仍可查看。', 'error', 'analysis');
    else if (['analysis','connection'].includes($('workspace-notice').dataset.source)) notice('');
    updateVersionNotice();
    featureWork?.update();
    developmentReview?.update();
  }
  async function persistView() {
    try {await api('/api/view', 'PUT', {snapshot, taskId, featureDigest, readOnly});} catch (error) {notice('阅读位置尚未保存：' + error.message, 'error');}
  }
  function scheduleSave() {
    clearTimeout(saveTimer);saveTimer = setTimeout(() => {saveTimer = null;void savePending();}, 220);saveState();
  }
  async function savePending() {
    if (saving) return saving;
    if (!queuedSave || saveFailure || readOnly) return;
    saving = (async () => {
      while (queuedSave && !saveFailure) {
        const pending = queuedSave;queuedSave = null;saveState();
        try {
          const result = await api('/api/features', 'PUT', {expectedDigest:featureDigest, document:pending.document});
          if (pending.instance !== instance) return;
          featureDigest = result.feature.digest;featureBasis = result.feature.basisSnapshot;savedAt = result.feature.savedAt;
          if (state) state.feature = result.feature;
          send('saved', {editId:pending.editId,featureDigest:result.feature.digest,revision:result.feature.revision});
          if (!queuedSave) dirty = false;
          featureWork?.invalidate();
          developmentReview?.invalidate();
        } catch (error) {
          if (pending.instance !== instance) return;
          queuedSave ||= pending;saveFailure = error;dirty = true;
          send('save-error', {editId:queuedSave.editId, message:error.message});
        }
      }
    })();
    try {await saving;} finally {saving = null;saveState();}
  }
  async function readyToSwitch(action = '切换版本', options = {}) {
    if (!options.allowReviewDraft && developmentReview?.hasDraft()) {notice(`有尚未保存的开发审阅记录。请先保存或取消对应草稿，再${action}。`);$('workspace-notice').append(button('查看未保存记录',()=>developmentReview.focusDraft()));return false;}
    if (draft) {notice(`有尚未应用的编辑。请先在地图内应用修改或取消编辑，再${action}。`);return false;}
    clearTimeout(saveTimer);saveTimer = null;
    await savePending();if (saving) await saving;
    if (dirty || queuedSave || saveFailure) {notice('标注尚未保存。请先重试保存，或导出草稿后重载已保存内容。', 'error');return false;}
    return true;
  }
  const featureContext = () => ({state,snapshot,featureDigest,readOnly,draft,dirty,loading:reportLoading});
  async function guardFeatureAction(action, execute, options = {}) {
    if (featureMutationBusy || reportLoading) throw new Error('正在保存或切换版本，请稍后重试。');
    featureMutationBusy = true;frame.inert = true;if (state) renderState(state);
    try {
      if (!await readyToSwitch(action, options)) throw new Error(`仍有未保存或未应用的编辑。请先处理这些编辑，再${action}。`);
      renderState(await api('/api/state'));
      if (draft || dirty || queuedSave || saveFailure) throw new Error('核对期间出现了新的标注编辑，请先保存后重试。');
      if (!snapshot || readOnly || snapshot !== state.latestSnapshot || featureDigest !== state.feature?.digest)
        throw new Error('正在审阅的代码或标注不是当前版本。请明确切换到当前版本后重试，现有阅读内容和草稿仍保留。');
      return await execute(featureContext());
    } finally {featureMutationBusy = false;frame.inert = false;if (state) renderState(state);}
  }
  async function loadReport(nextSnapshot, options = {}) {
    if (!nextSnapshot || reportLoading || featureMutationBusy) return false;
    if (!options.force && !await readyToSwitch('切换版本',{allowReviewDraft:!!options.allowReviewDraft})) return false;
    reportLoading = true;const request = ++reportSequence;frame.inert = true;
    if (state) renderState(state);
    try {
      const query = new URLSearchParams({snapshot:nextSnapshot});
      if (Object.hasOwn(options, 'featureDigest')) query.set('featureDigest', options.featureDigest ?? 'none');
      if (options.readOnly) query.set('readOnly', '1');
      const result = await api('/api/report?' + query);
      if (request !== reportSequence) return false;
      const url = new URL(result.url, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/report/')) throw new Error('报告地址不属于当前工作区');
      const nextFrame = document.createElement('iframe');nextFrame.id = 'workspace-report';nextFrame.title = '项目与功能地图工作台';
      nextFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-modals');
      snapshot = result.snapshot;featureDigest = result.featureDigest;featureBasis = null;readOnly = result.readOnly ?? !!options.readOnly;
      instance = null;dirty = false;draft = false;queuedSave = null;saveFailure = null;savedAt = null;
      viewContext = null;pendingNavigation = options.navigation || null;
      frame.replaceWith(nextFrame);frame = nextFrame;frame.src = url.href;
      $('map-placeholder').hidden = true;notice('');saveState();
      setTimeout(() => {if (request === reportSequence && !instance) notice('地图脚本尚未就绪。请检查本地服务连接，或重新载入当前版本。', 'error');}, 10000);
      if (options.persist !== false) await persistView();
      if (mode === 'changes') void loadComparison();
      featureWork?.invalidate();
      developmentReview?.invalidate();
      return true;
    } catch (error) {notice('无法载入代码图：' + error.message, 'error');return false;}
    finally {if (request === reportSequence) {reportLoading = false;frame.inert = false;if (state) renderState(state);}}
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== frame.contentWindow || event.origin !== location.origin || data?.channel !== channel || data.snapshot !== snapshot) return;
    if (data.type === 'ready') {
      if (data.featureDigest !== featureDigest || !!data.readOnly !== readOnly || typeof data.instance !== 'string') return;
      instance = data.instance;featureBasis = data.basisSnapshot;saveState();featureWork?.references();
      if (pendingNavigation) {send('navigate',{...pendingNavigation,featureDigest});pendingNavigation = null;}
      return;
    }
    if (data.instance !== instance || !instance) return;
    if (data.type === 'features' && !readOnly && Number.isSafeInteger(data.editId) && data.document) {
      dirty = true;queuedSave = {document:data.document,editId:data.editId,instance};
      if (!saveFailure) scheduleSave();else saveState();
    } else if (data.type === 'state') {dirty = !!data.dirty;draft = !!data.draft;saveState();}
    else if (data.type === 'analysis-request' && ['overview','feature','changes'].includes(data.kind)) {
      if (data.featureId !== undefined && typeof data.featureId !== 'string') return;
      featureWork?.request({kind:data.kind,featureId:data.featureId,goal:typeof data.goal === 'string' ? data.goal.slice(0,2000) : undefined});
    } else if (data.type === 'view-context' && data.featureDigest === featureDigest) {
      viewContext = typeof data.featureId === 'string' ? {featureId:data.featureId} : null;
    } else if (data.type === 'navigation-result' && !data.ok) notice(data.reason || '无法打开这个固定版本中的目标。');
  });
  function showMode(next) {
    mode = next;$('map-view').hidden = next !== 'map';$('changes-view').hidden = next !== 'changes';$('feature-work-view').hidden = next !== 'feature-work';$('development-review-view').hidden = next !== 'development-review';
    for (const [id, selected] of [['show-map', next === 'map'], ['show-changes', next === 'changes'], ['show-feature-work',next === 'feature-work'], ['show-development-review',next === 'development-review']]) {$(id).classList.toggle('active', selected);$(id).setAttribute('aria-pressed', String(selected));}
    if (next === 'changes') void loadComparison();
    featureWork?.show(next === 'feature-work');
    developmentReview?.show(next === 'development-review');
  }
  function renderComparison(result) {
    comparison = result;const task = state.tasks.find(item => item.id === taskId);
    $('comparison-subtitle').textContent = `${task?.title || '开发任务'} · 起点 ${short(result.before.snapshot)} → 正在审阅 ${short(result.after.snapshot)}`;
    const labels = {added:'进入索引',removed:'离开索引',modified:'源码变化',analysisChanged:'分析记录变化'};
    $('comparison-summary').replaceChildren(...Object.entries(labels).map(([kind, label]) => {
      const box = make('div', null, 'summary-item');box.dataset.kind = kind;box.append(make('strong', result.summary[kind] || 0), make('span', label));return box;
    }));
    $('change-count').textContent = result.files.length || '';$('file-count').textContent = result.files.length;
    const list = $('changed-files');list.replaceChildren();
    if (!result.files.some(file => file.path === selectedFile)) selectedFile = result.files[0]?.path || null;
    for (const file of result.files) {
      const item = button('', () => {selectedFile = file.path;renderFile(file);markSelectedFile();}, 'file-change');
      item.dataset.path = file.path;
      const label = make('span', {added:'进入索引',removed:'离开索引',modified:'源码变化',analysis:'分析记录变化'}[file.kind], 'change-kind');label.dataset.kind = file.kind;
      item.append(make('strong', file.path));const meta = make('small');meta.append(label, make('span', `${file.before?.lines ?? '—'} → ${file.after?.lines ?? '—'} 行`));item.append(meta);list.append(item);
    }
    markSelectedFile();
    if (selectedFile) renderFile(result.files.find(file => file.path === selectedFile));
    else {
      const empty = make('div', null, 'empty-state');empty.append(make('h3', '索引代码记录没有变化'), make('p', result.diagnostics?.changed ? '编译诊断发生了变化，请查看下方前后诊断。' : result.inputSnapshotChanged ? '分析输入版本发生变化，索引文件与已比较记录没有变化。请查看分析范围和契约信息。' : '继续开发并保存文件，待代码图更新后切换到新版本，即可查看新增变化。'));
      $('change-detail').replaceChildren(empty);appendComparisonLimits($('change-detail'));
    }
  }
  function markSelectedFile() {for (const node of $('changed-files').children) node.setAttribute('aria-pressed', String(node.dataset.path === selectedFile));}
  function appendComparisonLimits(box) {
    if (comparison.diagnostics) {
      const diagnostics = comparison.diagnostics, detail = make('details', null, 'evidence-fold');
      detail.append(make('summary', `编译诊断${diagnostics.changed?'已变化':''} · 起点 ${diagnostics.before.length} / 当前 ${diagnostics.after.length}`));
      const columns = make('div', null, 'record-columns');
      for (const [side, label] of [['before','起点诊断'], ['after','当前诊断']]) {
        const column = make('div');column.append(make('h4', label));
        for (const item of diagnostics[side].slice(0, 50)) column.append(make('p', `${item.category} · ${item.code}${item.file?' · '+item.file+(item.line?':'+item.line:''):''}\n${item.message}`));
        if (!diagnostics[side].length) column.append(make('p', '没有编译诊断记录'));
        if (diagnostics[side].length > 50) column.append(make('p', '此处展示前 50 项；完整诊断保留在对应代码图中。', 'budget-note'));
        columns.append(column);
      }
      detail.append(columns);box.append(detail);
    }
    const fold = make('details', null, 'evidence-fold');fold.append(make('summary', '比较范围与限制'));
    for (const text of [...(comparison.contractChanges || []), ...(comparison.limitations || [])]) fold.append(make('p', text));
    if (comparison.scope) fold.append(make('p', `索引文件：${comparison.scope.before.indexedFiles} → ${comparison.scope.after.indexedFiles}；未索引源码：${comparison.scope.before.unindexed.length} → ${comparison.scope.after.unindexed.length}。完整范围可在对应地图的“分析边界”查看。`));
    box.append(fold);
  }
  function record(ref, kind) {
    const node = make('div', null, 'evidence-record');
    if (kind === 'declaration') {
      node.append(make('strong', `${ref.kind} · ${ref.name}`), make('small', `${ref.location.file}:${ref.location.line} · ${short(ref.snapshot)}`));
    } else {
      const labels = {bound:'静态绑定',candidate:'候选',unresolved:'未解析',external:'外部边界'};
      node.append(make('strong', `${ref.kind} · ${labels[ref.status] || ref.status} · ${ref.targetLabel}`), make('small', `${ref.evidence.location.file}:${ref.evidence.location.line} · ${ref.evidence.rule}`));
      node.append(make('small', ref.evidence.excerpt));
      if (ref.evidence.valueOrigins) node.append(make('small', ref.evidence.valueOrigins.truncated ? '值来源追踪已截断，来源集合不完整。' : '值来源集合不完整，保留候选与停止原因。'));
    }
    return node;
  }
  function renderFile(file) {
    if (!file) return;
    const box = $('change-detail');box.replaceChildren(make('span', '代码事实 · 固定版本比较', 'eyebrow'), make('h3', file.path));
    const explanations = {added:'该文件进入了当前分析索引；可能来自新增文件或分析范围变化。',removed:'该文件离开了当前分析索引；可能来自删除文件或分析范围变化。',modified:'该文件的源码内容发生变化。下面展示起点与当前审阅版本的差异。',analysis:'该文件源码未变化，但分析得到的声明或关系记录发生变化。可能涉及其他文件或分析环境。'};
    box.append(make('p', explanations[file.kind]));
    const pair = make('div', null, 'version-pair');
    for (const [label, value] of [['本轮起点', file.before], ['正在审阅', file.after]]) {
      const card = make('div', null, 'version-card');card.append(make('strong', label));
      if (value) card.append(make('small', `${value.lines} 行 · ${value.declarations} 条声明记录`), make('code', short(value.snapshot)), make('small', '文件摘要 ' + short(value.hash)));
      else card.append(make('small', '未在该版本索引中'));
      pair.append(card);
    }
    box.append(pair);
    if (file.diff.available && file.diff.lines.length) {
      const scroll = make('div', null, 'diff-scroll'), table = make('table', null, 'source-diff');table.setAttribute('aria-label', file.path + ' 源码差异');
      const head = make('thead'), header = make('tr');for (const label of ['起点','当前','','源码']) header.append(make('th', label));head.append(header);table.append(head);
      const body = make('tbody');
      for (const line of file.diff.lines) {
        const row = make('tr');row.dataset.kind = line.kind;
        row.append(make('td', line.beforeLine ?? '', 'line-number'), make('td', line.afterLine ?? '', 'line-number'), make('td', line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '', 'line-mark'), make('td', line.text + (line.textTruncated ? ' …（该行已截断）' : ''), 'line-text'));body.append(row);
      }
      table.append(body);scroll.append(table);box.append(scroll);
    } else box.append(make('p', file.diff.reason || (file.kind === 'analysis' ? '源码内容相同，继续查看下方分析记录。' : '此处没有可显示的源码差异。')));
    if (file.diff.truncated || file.before?.sourceTruncated || file.after?.sourceTruncated) box.append(make('p', '源码预览有显示预算；截断部分未在此展开。请打开对应版本地图查看已嵌入的完整源码。', 'budget-note'));
    for (const [key, title, kind] of [['declarations','声明记录变化','declaration'], ['relations','关系记录变化','relation']]) {
      const changes = file[key], fold = make('details', null, 'evidence-fold');
      fold.append(make('summary', `${title} · 旧版 ${changes.removed} / 新版 ${changes.added}`), make('p', '这里比较具体证据记录；位置或引用变化不等于功能被删除、新增或行为已经改变。'));
      const columns = make('div', null, 'record-columns');
      for (const [side, label] of [['before','旧版记录'], ['after','新版记录']]) {const column = make('div');column.append(make('h4', label));for (const ref of changes[side]) column.append(record(ref, kind));if (!changes[side].length) column.append(make('p', '无变化记录'));columns.append(column);}
      fold.append(columns);if (changes.truncated) fold.append(make('p', '记录列表已按显示预算截断；上方数量为完整比较结果。', 'budget-note'));box.append(fold);
    }
    appendComparisonLimits(box);
  }
  async function loadComparison() {
    const request = ++diffSequence;
    if (!taskId || !snapshot) return;
    $('comparison-subtitle').textContent = '正在比较固定版本…';
    try {
      const result = await api('/api/diff?' + new URLSearchParams({task:taskId,snapshot}));
      if (request === diffSequence) renderComparison(result);
    } catch (error) {if (request === diffSequence) notice('无法比较：' + error.message, 'error');}
  }
  async function poll() {
    if (polling || !token) return;
    polling = true;
    try {
      const next = await api('/api/state');renderState(next);
      if (!snapshot && next.latestSnapshot && !reportLoading) {
        taskId = next.view?.taskId || next.activeTaskId || null;
        const selected = next.snapshots.some(item => item.id === next.view?.snapshot) ? next.view.snapshot : next.latestSnapshot;
        const savedView = selected === next.view?.snapshot ? next.view : null;
        await loadReport(selected, {persist:false, ...(savedView && Object.hasOwn(savedView, 'featureDigest') ?
          {featureDigest:savedView.featureDigest,readOnly:!!savedView.readOnly} : {})});
      }
    } catch (error) {
      $('analysis-status').textContent = '本地服务连接中断';document.body.dataset.analysis = 'error';
      notice(error.status === 401 || error.status === 403 ? '连接凭据已失效。请使用启动命令输出的新地址重新打开工作区。当前页面内容仍保留。' : '暂时无法连接本地服务。当前地图和草稿仍保留，恢复后会继续核对。', 'error', 'connection');
    } finally {polling = false;}
  }
  async function pollLoop() {await poll();setTimeout(pollLoop, document.hidden ? 6000 : 2000);}
  featureWork = createFeatureWorkView({api,context:featureContext,guardCurrent:guardFeatureAction,download,
    openPanel:()=>showMode('feature-work'),openLatest:()=>loadReport(state?.latestSnapshot),
    sendReferences:references=>{if (references?.snapshot === snapshot && references.featureDigest === featureDigest) send('reference-status',{references,featureDigest});},
    navigate:async target=>{
      if (!await readyToSwitch('查看代码或功能依据')) return;
      const nextSnapshot = target.snapshot || snapshot,nextDigest = target.featureDigest || featureDigest;
      if (nextSnapshot !== snapshot || nextDigest !== featureDigest) {
        if (!state?.snapshots.some(item=>item.id === nextSnapshot)) {notice('所选依据版本不可用，当前内容仍保留。');return;}
        if (!await loadReport(nextSnapshot,{featureDigest:nextDigest,readOnly:true,navigation:target})) return;
      } else send('navigate',{...target,featureDigest});
      showMode('map');
    },
    onApplied:async result=>{
      const navigation = viewContext, appliedSnapshot = snapshot;
      renderState(await api('/api/state'));
      if (!result.feature?.digest) throw new Error('修订已提交，但返回的标注版本缺失。请重新载入已保存内容。');
      await loadReport(appliedSnapshot,{featureDigest:result.feature.digest,navigation});
      featureWork.invalidate();
    }
  });
  developmentReview = createDevelopmentReviewView({api,context:()=>({...featureContext(),taskId}),download,
    guardCurrent:(action,execute)=>guardFeatureAction(action,execute,{allowReviewDraft:true}),
    openPanel:()=>showMode('development-review'),startTask:()=>$('start-task').click(),
    selectTask:async id=>{taskId=id;renderState(state);await persistView();},
    navigate:async target=>{
      if (!await readyToSwitch('查看固定版本依据',{allowReviewDraft:true})) return;
      const nextSnapshot=target.snapshot || snapshot,nextDigest=Object.hasOwn(target,'featureDigest')?target.featureDigest:featureDigest;
      const {returnToReview,...navigation}=target;
      if (!state?.snapshots.some(item=>item.id===nextSnapshot)) {notice('这份固定依据的代码版本不可用，当前内容仍保留。');return;}
      if (nextSnapshot!==snapshot || nextDigest!==featureDigest) {
        const historical=nextSnapshot!==state.latestSnapshot || nextDigest!==state.feature?.digest;
        if (!await loadReport(nextSnapshot,{featureDigest:nextDigest,readOnly:historical,navigation,allowReviewDraft:true})) return;
      } else if (target.featureId || target.nodeId) send('navigate',{...navigation,featureDigest});
      showMode(returnToReview?'development-review':'map');
    },
    openCodeDiff:async target=>{
      if (!await readyToSwitch('查看固定代码差异',{allowReviewDraft:true})) return;
      if (target.snapshot!==snapshot || target.featureDigest!==featureDigest) {
        if (!await loadReport(target.snapshot,{featureDigest:target.featureDigest,readOnly:target.snapshot!==state?.latestSnapshot || target.featureDigest!==state?.feature?.digest,allowReviewDraft:true})) return;
      }
      taskId=target.taskId;selectedFile=target.path || null;renderState(state);await persistView();showMode('changes');
    }
  });
  $('show-map').onclick = () => showMode('map');$('show-changes').onclick = () => showMode('changes');$('show-feature-work').onclick = () => showMode('feature-work');$('show-development-review').onclick = () => showMode('development-review');
  $('open-development-review').onclick = () => showMode('development-review');
  $('viewed-version').onchange = async event => {const chosen = event.target.value;if (!await loadReport(chosen)) event.target.value = snapshot || '';};
  $('open-latest').onclick = () => loadReport(state?.latestSnapshot);
  $('task-select').onchange = async event => {if(developmentReview?.hasDraft()){event.target.value=taskId || '';notice('请先在“开发审阅”保存或取消未保存记录，再切换开发任务。');return;}taskId = event.target.value || null;developmentReview?.clearForTask();await persistView();void loadComparison();};
  $('open-task-start').onclick = async () => {const task = state?.tasks.find(item => item.id === taskId);if (task && await loadReport(task.snapshot, {featureDigest:task.featureDigest,readOnly:true})) showMode('map');};
  $('refresh-workspace').onclick = async () => {try {await api('/api/refresh', 'POST', {});notice('已请求核对已保存代码；完成后可切换到新版本。');void poll();} catch (error) {notice(error.message, 'error');}};
  $('retry-save').onclick = () => {saveFailure = null;void savePending();};
  $('export-draft').onclick = () => send('export-draft');
  $('reload-saved').onclick = async () => {
    if (saving) await saving;
    if (!confirm('重载会丢弃当前页面尚未保存的标注和未应用表单。已应用的标注可先导出草稿；尚未应用的表单请先复制保留。继续重载？')) return;
    clearTimeout(saveTimer);queuedSave = null;saveFailure = null;
    await poll();await loadReport(snapshot, {force:true});
  };
  function download(text, name, type) {const blob = new Blob([text], {type}), url = URL.createObjectURL(blob), anchor = make('a');anchor.href = url;anchor.download = name;anchor.click();setTimeout(() => URL.revokeObjectURL(url), 10000);}
  $('export-report').onclick = async () => {
    if (!snapshot || !await readyToSwitch()) return;
    try {
      const query = new URLSearchParams({snapshot,featureDigest:featureDigest ?? 'none'});
      const html = await api('/api/export?' + query, 'GET', undefined, true);
      download(html, `repographia-${short(snapshot)}.html`, 'text/html');notice('已请求下载当前固定版本的离线报告。');
    } catch (error) {notice('报告导出失败：' + error.message, 'error');}
  };
  $('start-task').onclick = async () => {
    if (!await readyToSwitch()) return;
    $('task-dialog-status').textContent = '';$('task-title').value = '';
    $('task-intent-goal').value='';$('task-intent-checks').value='';$('task-intent-source').value='manual';$('task-intent-author').value='本地审阅者';$('task-intent-fields').open=false;
    taskPreparationDigest=state.feature?.digest ?? null;const request=++taskPreparationSequence;
    $('task-target-features').replaceChildren(make('p','正在读取已有功能…'));
    $('task-dialog').showModal();$('task-title').focus();
    try {
      const result=await api('/api/feature-work?'+new URLSearchParams({snapshot:state.latestSnapshot,featureDigest:taskPreparationDigest ?? 'none'}));
      if(request!==taskPreparationSequence || !$('task-dialog').open)return;
      const box=$('task-target-features');box.replaceChildren();
      for(const feature of result.features || []) {
        const label=make('label'),input=make('input');input.type='checkbox';input.value=feature.id;input.name='targetFeature';
        label.append(input,make('span',feature.title));box.append(label);
      }
      if(!result.features?.length)box.append(make('p','当前还没有功能记录。可以先填写目标和验收点，稍后继续建设功能图。'));
    } catch(error) {if(request===taskPreparationSequence)$('task-target-features').replaceChildren(make('p','功能列表暂时不可用。可以先用目标和验收点记录这一轮。'));}
  };
  $('cancel-task').onclick = () => {if (!baselineBusy) $('task-dialog').close();};
  $('task-dialog').addEventListener('cancel', event => {if (baselineBusy) event.preventDefault();});
  $('task-form').onsubmit = async event => {
    event.preventDefault();if (baselineBusy) return;
    const title=$('task-title').value.trim() || '开发任务 '+time(new Date().toISOString());
    const goal=$('task-intent-goal').value.trim(),checks=$('task-intent-checks').value.split(/\r?\n/).map(text=>text.trim()).filter(Boolean),featureIds=[...$('task-target-features').querySelectorAll('input:checked')].map(input=>input.value);
    const hasIntent=!!(goal || checks.length || featureIds.length);
    const intent=hasIntent?{goal:goal || title,author:$('task-intent-author').value.trim() || '本地审阅者',source:$('task-intent-source').value,featureIds,checks:checks.map((text,index)=>({id:'criterion-'+(index+1),text}))}:undefined;
    if(checks.length>50){$('task-dialog-status').textContent='验收点最多 50 项，请整理后重试。';return;}
    if(checks.some(text=>text.length>2000)){$('task-dialog-status').textContent='单个验收点最多 2000 字，请精简后重试。';return;}
    baselineBusy = true;for (const control of $('task-form').querySelectorAll('input,textarea,select,button')) control.disabled = true;
    $('task-dialog-status').textContent = '正在核对当前已保存代码并建立起点…';
    try {
      const result = await api('/api/baseline', 'POST', {title,expectedFeatureDigest:taskPreparationDigest,...(intent?{intent}:{})});
      renderState(await api('/api/state'));taskId = result.task.id;renderState(state);$('task-dialog').close();
      developmentReview?.clearForTask();
      await loadReport(result.task.snapshot);showMode('changes');
      notice('本轮起点已保存。接下来在现有 Agent 中开发，保存代码后可查看变化。');
    } catch (error) {$('task-dialog-status').textContent = '起点尚未建立：' + error.message;}
    finally {baselineBusy = false;for (const control of $('task-form').querySelectorAll('input,textarea,select,button')) control.disabled = false;if (state) renderState(state);}
  };
  window.addEventListener('beforeunload', event => {if (dirty || draft || queuedSave || saving || featureWork?.hasDraft() || developmentReview?.hasDraft()) {event.preventDefault();event.returnValue = '';}});
  document.addEventListener('visibilitychange', () => {if (!document.hidden) void poll();});
  if (!token) {notice('请使用工作区启动命令输出的完整地址打开此页面。', 'error');$('analysis-status').textContent = '缺少连接凭据';document.body.dataset.analysis = 'error';}
  else void pollLoop();
})();
