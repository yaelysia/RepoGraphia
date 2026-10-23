/** Fixed development comparisons and separate human review records. No target or Agent execution. */
'use strict';
function createDevelopmentReviewView({api,context,guardCurrent,download,navigate,openCodeDiff,selectTask,startTask,openPanel}) {
  const $ = id => document.getElementById(id);
  const make = (tag,text,className) => {const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
  const button = (text,action,className) => {const node=make('button',text,className);node.type='button';node.onclick=action;return node;};
  const short = value => String(value || '').slice(0,10);
  const time = value => value ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '时间未记录';
  const scopeLabels = {declared:'目标中明确选定','outside-declared':'未在选定范围内',undeclared:'目标范围未声明'};
  const changeLabels = {added:'新增功能记录',removed:'移除功能记录',modified:'功能描述有修订',unchanged:'功能描述未变化'};
  const fileLabels = {added:'进入分析索引',removed:'离开分析索引',modified:'源码内容变化',analysis:'静态分析记录变化'};
  const reviewLabels = {reviewed:'已审阅','needs-work':'需要修改',unreviewed:'留待审阅'};
  const verificationLabels = {passed:'报告通过',failed:'报告失败',blocked:'验证受阻','not-run':'尚未执行'};
  const sourceLabels = {manual:'人工填写',agent:'Agent 自述'};
  const referenceLabels = {matched:'精确依据匹配','needs-review':'需要复核',unmatched:'原引用未匹配',unverified:'依据尚未核实'};
  const decisionLabels = {accepted:'关联已接受',rejected:'关联已拒绝',proposed:'关联待审'};
  const roleLabels = {entry:'入口',implementation:'实现',support:'支撑',test:'测试'};
  const reasonLabels = {
    'changed-source':'关联源码内容已变化','changed-static-neighborhood':'相关静态关系或上下文已变化',
    'changed-analysis-inputs':'相关分析输入已变化','analysis-inputs-unavailable':'缺少可核对的输入或配置用途记录',
    'missing-indexed-file':'原文件不在当前索引内','exact-anchor-recheck-required':'源码变化后需重新核对精确位置',
    'ambiguous-node-anchor':'存在多个可能位置，不能确定原实体','missing-node-anchor':'未匹配到原实体位置',
    'changed-node-context':'实体所属上下文已变化','ambiguous-relation-anchor':'原关系不能唯一匹配',
    'changed-relation-evidence':'原关系依据已变化','missing-baseline-graph':'缺少原依据代码图',
    'baseline-basis-mismatch':'保存的代码图与原依据不一致','unversioned-analysis':'旧分析规则没有版本记录',
    'original-reference-unverified':'原引用本身尚未核实','changed-project-name':'原依据与当前项目不同',
    'changed-analysisRevision':'分析规则版本已变化','changed-compilerVersion':'编译器版本已变化','changed-config':'编译配置已变化',
    'snapshot-conflict':'当前代码版本已更新','feature-conflict':'当前功能标注已更新','revision-conflict':'当前记录已更新',
    'saved-inputs-changed':'已保存代码发生变化，等待代码图核对','workspace-closed':'本地工作区已关闭'
  };
  const detail = $('review-detail');
  let data=null,active=false,loadedKey='',loading=false,historyLoading=false,loadSequence=0,lastLoaded=0,busy=false,historical=false;
  let category='overview',selected={kind:'round'},listLimit=60,recordKind='review',lastActor='本地审阅者',pendingRecords=null;
  const drafts=new Map();
  const ctxKey = ctx => ctx.taskId && ctx.snapshot ? JSON.stringify([ctx.taskId,ctx.snapshot,ctx.featureDigest ?? null]) : '';
  const report = () => data?.report;
  const feature = id => report()?.features.find(item=>item.id===id);
  const featureTitle = id => {const item=feature(id);return (item?.after || item?.before)?.title || id;};
  const hasDraft = () => [...drafts.values()].some(value=>value.dirty);
  const sameVersion = ctx => !!report() && ctx.taskId===report().task.id && ctx.snapshot===report().after.snapshot && (ctx.featureDigest ?? null)===report().after.featureDigest;
  const canWrite = () => !!data?.current?.writable && !historical && !context().readOnly && sameVersion(context());
  function badge(text,kind) {const node=make('span',text,'review-badge');if(kind)node.dataset.kind=kind;return node;}
  function exact(box,title,value) {const fold=make('details',null,'evidence-fold');fold.append(make('summary',title),make('pre',JSON.stringify(value,null,2)));box.append(fold);return fold;}
  function section(title) {const node=make('section',null,'review-section');node.append(make('h4',title));detail.append(node);return node;}
  function message(text,kind='info',action,raw) {
    const box=$('review-status');box.replaceChildren(make('span',text));box.dataset.kind=kind;
    if(action)box.append(button(action.label,action.run));
    if(raw)exact(box,'查看原始错误信息',raw);
  }
  function errorMessage(error,action) {
    if(error.status===409)message(`${action}尚未完成：当前代码、标注或审阅记录已变化。草稿仍保留，请先核对新状态。`,'error',
      {label:'核对最新审阅记录',run:()=>refresh(true,true)},error.message);
    else message(`${action}尚未完成。${/[\u3400-\u9fff]/.test(error.message)?error.message:'请检查填写内容和本地服务连接，草稿仍保留。'}`,'error',undefined,error.message);
  }
  function header(eyebrow,title,description,animate=false) {
    detail.classList.remove('review-detail-enter');detail.replaceChildren(make('span',eyebrow,'eyebrow'),make('h3',title),make('p',description));
    if(animate){void detail.offsetWidth;detail.classList.add('review-detail-enter');}
  }
  function target() {
    const r=report();if(!r)return null;
    if(selected.kind==='feature')return {kind:'feature',id:selected.id};
    if(selected.kind==='file')return {kind:'file',id:selected.id};
    if(selected.kind==='criterion')return {kind:'criterion',id:selected.id};
    return {kind:'round',id:r.task.id};
  }
  function targetName(value) {
    if(value.kind==='feature')return featureTitle(value.id);
    if(value.kind==='file')return value.id;
    if(value.kind==='criterion')return report()?.task.intent?.checks.find(item=>item.id===value.id)?.text || value.id;
    return '本轮整体';
  }
  function recordsFor(value) {return (data?.records || []).filter(item=>item.target.kind===value.kind && item.target.id===value.id);}
  function latestReview(value) {return recordsFor(value).filter(item=>item.kind==='review').at(-1);}
  function updateTaskOptions() {
    const ctx=context(),select=$('review-task-select'),items=[...(ctx.state?.tasks || [])].reverse();
    const signature=JSON.stringify(items.map(item=>[item.id,item.title]));
    if(select.dataset.options!==signature){
      select.replaceChildren();if(!items.length){const option=make('option','尚未记录起点');option.value='';select.append(option);}
      for(const item of items){const option=make('option',item.title);option.value=item.id;select.append(option);}select.dataset.options=signature;
    }
    select.value=ctx.taskId || '';select.disabled=busy || loading;
  }
  function renderContext() {
    const r=report(),box=$('review-context');box.replaceChildren();
    $('review-export').disabled=!r || busy;
    if(!r)return;
    const label=make('div');label.append(make('strong',historical?'已保存的历史审阅 · 只读':'正在查看的固定比较'),
      make('small',`起点 ${short(r.before.snapshot)} → 审阅 ${short(r.after.snapshot)} · 标注 ${short(r.after.featureDigest) || '无'}`));box.append(label);
    const actions=make('div',null,'review-context-actions');
    if(historical)actions.append(button('返回正在审阅版本',()=>{if(hasDraft()){message('请先保存或取消审阅草稿，再离开这份比较。');return;}historical=false;loadedKey='';void refresh(true);}));
    else if(!sameVersion(context())) {
      if(hasDraft())actions.append(button('返回审阅版本继续记录',()=>navigate({snapshot:r.after.snapshot,featureDigest:r.after.featureDigest,returnToReview:true}),'primary'));
      else actions.append(button('载入正在审阅版本',()=>{loadedKey='';void refresh(true);}));
    }
    actions.append(button('查看起点地图',()=>navigate({snapshot:r.before.snapshot,featureDigest:r.before.featureDigest})),button('查看审阅版本地图',()=>navigate({snapshot:r.after.snapshot,featureDigest:r.after.featureDigest})));
    box.append(actions);
    const save=$('review-record-save'),note=$('review-record-note');
    if(save)save.disabled=!canWrite() || busy;
    if(note && hasDraft() && !sameVersion(context())){note.textContent='草稿仍绑定原比较。可继续查看依据，返回审阅版本后再保存。';note.dataset.versionNotice='true';}
    else if(note?.dataset.versionNotice==='true'){note.textContent=canWrite()?'草稿仍保留，可以继续填写并保存。':'当前比较已有后续版本。草稿可以继续阅读或导出，不能自动应用到新版本。';}
  }
  function renderSummary() {
    const r=report(),box=$('review-summary');box.replaceChildren();if(!r)return;
    for(const [kind,count,label,explanation] of [
      ['features',r.summary.affectedFeatures,'功能记录有变化','来自描述、关联或代码依据'],
      ['outside',r.summary.outsideDeclaredFeatures,'选定范围之外','需确认是否符合本轮目标'],
      ['unknown',r.summary.unassignedFiles,'变化文件含未归属项','保留还没解释清楚的部分'],
      ['references',r.summary.newlyPendingReferences,'本轮新增待复核','起点已有待复核另行保留']
    ]){const item=make('div',null,'review-metric');item.dataset.kind=kind;const text=make('div');text.append(make('span',label),make('small',explanation));item.append(make('strong',count),text);box.append(item);}
    $('review-count').textContent=r.summary.affectedFeatures || '';
  }
  function rows() {
    const r=report();if(!r)return [];
    if(category==='overview')return [{kind:'round',id:r.task.id,title:'本轮概览',subtitle:r.task.intent?.goal || '查看目标、实际变化与待确认项'},
      ...(r.task.intent?.checks || []).map(item=>({kind:'criterion',id:item.id,title:item.text,subtitle:latestReview({kind:'criterion',id:item.id})?reviewLabels[latestReview({kind:'criterion',id:item.id}).decision]:'尚无人工审阅记录'}))];
    if(category==='features')return r.features.map(item=>({kind:'feature',id:item.id,title:(item.after || item.before)?.title || item.id,subtitle:
      `${scopeLabels[item.scope]} · ${item.affected?'存在记录变化':'没有观察到记录变化'}`}));
    if(category==='unassigned')return r.unassigned.map(item=>({kind:'file',id:item.path,title:item.path,subtitle:`${fileLabels[item.kind]} · 审阅版 ${item.afterNodes.length} 个未归属实体`}));
    return [{kind:'records',id:r.comparisonDigest,title:'这份比较的记录',subtitle:`${data.records.length} 条已保存记录 · 仅绑定所示版本`},
      ...(data.history || []).filter(item=>item.comparisonDigest!==r.comparisonDigest).slice().reverse().map(item=>({kind:'history',id:item.comparisonDigest,title:`${time(item.createdAt)} 的审阅`,subtitle:`${short(item.after.snapshot)} · ${item.recordCount} 条记录`}))];
  }
  function renderLists() {
    const r=report(),nav=$('review-categories');nav.replaceChildren();
    for(const [id,label,count] of [['overview','目标',r?.task.intent?.checks.length || 0],['features','功能',r?.features.length || 0],['unassigned','未归属',r?.unassigned.length || 0],['history','记录',data?.records.length || 0]]){
      const control=button('',()=>{category=id;listLimit=60;const first=rows()[0];selected=first?{kind:first.kind,id:first.id}:{kind:'round'};renderLists();renderDetail(true);});
      control.dataset.category=id;control.setAttribute('aria-pressed',String(category===id));control.append(make('span',label),make('small',String(count)));nav.append(control);
    }
    const list=$('review-list'),scroll=list.scrollTop;list.replaceChildren();const items=rows();
    for(const item of items.slice(0,listLimit)){
      const control=button('',()=>choose(item.kind,item.id),'review-list-item');control.dataset.itemKind=item.kind;control.dataset.itemId=item.id;
      control.setAttribute('aria-pressed',String(selected.kind===item.kind && selected.id===item.id || item.kind==='round' && selected.kind==='round'));
      control.append(make('strong',item.title),make('small',item.subtitle));list.append(control);
    }
    if(!items.length)list.append(make('p',category==='unassigned'?'本次比较没有这类未归属记录。它不表示全部项目行为已经验证。':'这份比较中暂无此类记录。','review-list-empty'));
    if(items.length>listLimit)list.append(button(`再显示 ${Math.min(60,items.length-listLimit)} 项（共 ${items.length} 项）`,()=>{listLimit+=60;renderLists();}));
    list.scrollTop=scroll;
  }
  async function choose(kind,id) {
    const selection=++loadSequence;
    if(kind==='history'){
      if(hasDraft()){message('请先保存或取消审阅草稿，再打开另一份固定比较。');return;}
      historyLoading=true;
      try{const next=await api('/api/development-reviews/'+encodeURIComponent(id));if(selection!==loadSequence)return;
        if(hasDraft()){message('读取历史记录期间出现了新的草稿，已保留原比较和草稿。请先保存或取消，再打开历史。');return;}
        data=next;historical=true;loadedKey='history:'+id;pendingRecords=null;selected={kind:'records',id};renderAll(true);message('已打开保存时的固定比较。后续代码与标注变化不会改写这份记录。');}
      catch(error){if(selection===loadSequence)errorMessage(error,'载入历史审阅');}
      finally{if(selection===loadSequence)historyLoading=false;}return;
    }
    historyLoading=false;
    selected={kind,id};renderLists();renderDetail(true);
  }
  function appendVersionsAndLimits() {
    const r=report(),fold=make('details',null,'evidence-fold');fold.append(make('summary','依据、范围与比较限制'),
      make('p','这里只比较固定版本中的代码事实和功能标注。功能关联、人工代码审阅、外部验证结果分别记录；共享代码不会生成新的功能依赖。'),
      make('p','文件或记录变化不能证明修改者身份、Agent 进度、运行行为或目标已经完成。当前未保存到磁盘的编辑器内容不在分析范围内。'));
    if(r.code.scope)fold.append(make('p',`索引范围：起点 ${r.code.scope.before.indexedFiles} 个文件，审阅版 ${r.code.scope.after.indexedFiles} 个文件；未索引范围请查看对应版本地图。`));
    exact(fold,'完整比较限制与固定版本',{before:r.before,after:r.after,limitations:r.limitations,codeLimitations:r.code.limitations,contractChanges:r.code.contractChanges});detail.append(fold);
  }
  function renderOverview(animate) {
    const r=report(),intent=r.task.intent;
    header('REVIEW THE DEVELOPMENT ROUND',r.task.title,intent?.goal || '这轮任务保留了标题；尚未记录独立的目标说明与验收点。',animate);
    const declaration=section('本轮目标声明'),card=make('div',null,'review-card');
    card.append(make('strong',intent?.goal || r.task.title),make('small',intent?`${sourceLabels[intent.source]} · ${intent.author} · 来源为填写者自述`:'目标来自开始开发时填写的任务标题。'));
    if(intent?.featureIds.length)card.append(make('p','明确选定：'+intent.featureIds.map(featureTitle).join('、')));
    else card.append(make('p','没有明确选定功能范围。系统不会从目标文字猜测所属功能。'));
    declaration.append(card);
    const observed=section('已观察到的变化'),facts=make('div',null,'review-card');
    facts.append(make('strong',`${r.summary.changedFiles} 个文件记录变化，涉及 ${r.summary.affectedFeatures} 个功能记录`),
      make('p',`${r.summary.changedDescriptions} 个功能描述变化；${r.summary.changedMappings} 条关联内容变化；${r.summary.changedReviewDecisions} 条原关联决定变化。`));
    const actions=make('div',null,'review-inline-actions');actions.append(button('按功能查看',()=>{category='features';const first=rows()[0];selected=first?{kind:first.kind,id:first.id}:{kind:'round'};renderLists();renderDetail(true);}),button('查看代码变化',()=>openCodeDiff({taskId:r.task.id,snapshot:r.after.snapshot,featureDigest:r.after.featureDigest})));facts.append(actions);observed.append(facts);
    const questions=section('仍需要你确认'),items=[];
    if(r.summary.outsideDeclaredFeatures)items.push(`${r.summary.outsideDeclaredFeatures} 个有变化的功能不在明确选定范围内。请判断这是必要调整还是目标偏离。`);
    if(r.summary.declaredWithoutObservedChanges)items.push(`${r.summary.declaredWithoutObservedChanges} 个选定功能没有观察到记录变化。这不能单独证明目标完成或未完成。`);
    if(r.summary.unassignedFiles)items.push(`${r.summary.unassignedFiles} 个变化文件仍含没有明确功能归属的实体或空白范围。`);
    if(r.summary.newlyPendingReferences)items.push(`${r.summary.newlyPendingReferences} 条原依据在本轮比较后需要重新核对。`);
    if(r.summary.preexistingPendingReferences)items.push(`起点已存在 ${r.summary.preexistingPendingReferences} 条待复核引用；这些记录没有算成本轮新增问题。`);
    if(!items.length)items.push('当前没有上述待办记录。运行结果与目标是否达成仍需独立核验。');
    for(const text of items)questions.append(make('p',text,'review-callout'));
    if(intent?.checks.length){const checks=section('逐项核对验收点');for(const item of intent.checks){const node=make('div',null,'review-card');node.append(make('strong',item.text),make('small',latestReview({kind:'criterion',id:item.id})?reviewLabels[latestReview({kind:'criterion',id:item.id}).decision]:'尚未记录人工结论'),button('查看并记录',()=>choose('criterion',item.id)));checks.append(node);}}
    appendRecordForm();appendRecords(target());appendVersionsAndLimits();
  }
  function meaningSide(value,side) {
    const node=make('div',null,'review-meaning-side');node.dataset.side=side;node.append(make('small',side==='before'?'开发起点':'审阅版本'));
    if(!value){node.append(make('p','该版本没有这个功能记录'));return node;}
    node.append(make('strong',value.title),make('p',value.summary || '尚未填写一句说明'));
    const fold=make('details',null,'evidence-fold');fold.append(make('summary','完整说明与层级'),make('p',value.description || '没有补充说明'),make('p',value.parentId?'所属功能：'+featureTitle(value.parentId):'顶层功能'));
    if(value.questions?.length)for(const text of value.questions)fold.append(make('p','待确认：'+text));node.append(fold);return node;
  }
  function renderFeature(id,animate) {
    const item=feature(id);if(!item){selected={kind:'round'};return renderOverview(animate);}
    const r=report(),value=item.after || item.before;
    header('FEATURE CHANGE REVIEW',value.title,value.summary || '比较这个功能的描述、关联和代码依据，再留下本轮审阅结论。',animate);
    const badges=make('div',null,'review-badges');badges.append(badge(scopeLabels[item.scope],item.scope==='outside-declared'?'outside':item.scope==='declared'?'within':'unknown'),badge(changeLabels[item.change]),badge(item.affected?'观察到记录变化':'没有观察到记录变化'));detail.append(badges);
    if(item.scope==='outside-declared' && item.affected)detail.append(make('p','这个功能有记录变化，但开始开发时没有选入目标范围。请结合变化理由判断是否需要调整；系统不会自动判定越界。','review-callout'));
    const pair=make('div',null,'review-meaning-pair');pair.append(meaningSide(item.before,'before'),meaningSide(item.after,'after'));detail.append(pair);
    const links=make('div',null,'review-inline-actions');if(item.before)links.append(button('查看起点功能',()=>navigate({snapshot:r.before.snapshot,featureDigest:r.before.featureDigest,featureId:id})));if(item.after)links.append(button('查看审阅版功能',()=>navigate({snapshot:r.after.snapshot,featureDigest:r.after.featureDigest,featureId:id})));detail.append(links);
    const files=section('原标注涉及的变化文件');files.append(make('p','这里按原记录中的文件路径列出；当前实体是否仍匹配，请结合下方引用核对状态判断。'));
    if(!item.changedFiles.length)files.append(make('p','没有找到与本功能原标注路径相交的变化文件。功能说明或关联记录仍可能发生变化。'));
    for(const file of item.changedFiles){const card=make('div',null,'review-card');card.append(make('strong',file.path),make('small',fileLabels[file.kind]),make('p',`起点标注涉及 ${file.beforeMappingIds.length} 条记录，审阅版标注涉及 ${file.afterMappingIds.length} 条记录。`),button('查看固定代码差异',()=>openCodeDiff({taskId:r.task.id,snapshot:r.after.snapshot,featureDigest:r.after.featureDigest,path:file.path})));files.append(card);}
    if(item.mappingChanges.length){const mappings=section('关联记录的变化');for(const change of item.mappingChanges){const card=make('div',null,'review-card');card.append(make('strong',({added:'增加关联',removed:'移除关联',modified:'修订关联',review:'关联决定变化'})[change.kind]),make('small',change.id));for(const [side,label] of [['before','起点'],['after','审阅版']]){const mapping=change[side];card.append(make('p',label+'：'+(mapping?`${roleLabels[mapping.role] || mapping.role} · ${decisionLabels[mapping.decision] || mapping.decision} · ${mapping.rationale}`:'无此关联')));}exact(card,'原关联与完整差异',change);mappings.append(card);}}
    if(item.referenceChanges.length){const references=section('原依据的核对变化');for(const change of item.referenceChanges){const card=make('div',null,'review-card');card.append(make('strong',change.kind==='newly-pending'?'本轮新增待复核':change.kind==='resolved'?'精确引用重新匹配':'引用状态发生变化'),make('small',change.mappingId),make('p',`${referenceLabels[change.before.status]} → ${referenceLabels[change.after.status]}`));for(const reason of change.after.reasons || [])card.append(make('p',reasonLabels[reason] || '这条引用还有需要核查的原因，见完整依据。'));exact(card,'完整引用状态与原依据',change);references.append(card);}}
    if(item.preexistingPending.length){const sectionNode=section('起点已有的待复核项');sectionNode.append(make('p',`${item.preexistingPending.length} 条引用在开发起点就已需要核对，保留在这里供继续处理。`));exact(sectionNode,'查看起点已有待复核依据',item.preexistingPending);}
    if(item.reviewChanges.length){const card=make('div',null,'review-card');card.append(make('strong','功能关联的人工决定也有变化'),make('p','这些决定只评价功能与代码的关联。本轮代码审阅记录在下方单独保存。'));exact(card,'查看原关联决定的前后变化',item.reviewChanges);detail.append(card);}
    appendRecordForm();appendRecords(target());exact(detail,'完整功能差异与候选／未知依据',item);appendVersionsAndLimits();
  }
  function renderFile(id,animate) {
    const r=report(),item=r.unassigned.find(item=>item.path===id);if(!item){selected={kind:'round'};return renderOverview(animate);}
    header('UNASSIGNED CHANGE REVIEW',item.path,'这个变化文件仍有未归属实体或没有可供归属的实体。需要继续解释这些变化与功能的关系。',animate);
    const badges=make('div',null,'review-badges');badges.append(badge(fileLabels[item.kind]),badge('功能归属尚未补齐','unknown'));detail.append(badges);
    detail.append(make('p','下方列出变化文件中尚无明确功能归属的实体；这里没有断言每个实体本身都被修改。','review-callout'),button('查看固定代码差异',()=>openCodeDiff({taskId:r.task.id,snapshot:r.after.snapshot,featureDigest:r.after.featureDigest,path:item.path})));
    for(const [key,label,version,empty] of [['beforeNodes','起点未归属实体',r.before,item.beforeWithoutEntities],['afterNodes','审阅版未归属实体',r.after,item.afterWithoutEntities]]){
      const list=section(`${label} · ${item[key].length}`);
      if(empty)list.append(make('p','这个版本没有可供归属的声明实体。文件里的变化仍不能因此视为已解释。'));
      for(const node of item[key].slice(0,40)){const row=make('div',null,'review-card');row.append(make('strong',node.name),make('small',`${node.kind} · ${node.file}`),button('查看该版本代码',()=>navigate({snapshot:node.snapshot,featureDigest:version.featureDigest,nodeId:node.id})));list.append(row);}
      if(item[key].length>40)list.append(make('p',`此处展示前 40 个，共 ${item[key].length} 个；完整记录保留在导出中。`,'budget-note'));
    }
    appendRecordForm();appendRecords(target());appendVersionsAndLimits();
  }
  function renderCriterion(id,animate) {
    const item=report().task.intent?.checks.find(item=>item.id===id);if(!item){selected={kind:'round'};return renderOverview(animate);}
    header('REVIEW AN ACCEPTANCE POINT',item.text,'根据这份固定比较记录人工判断，并单独保存验证方法和结果。系统不会自动把代码变化当作验收通过。',animate);
    const intent=report().task.intent;detail.append(make('p',`验收点来自 ${sourceLabels[intent.source]} · ${intent.author}。`));appendRecordForm();appendRecords(target());appendVersionsAndLimits();
  }
  function renderRecord(record) {
    const node=make('div',null,'review-card');node.dataset.recordKind=record.kind;node.dataset.recordId=record.id;
    if(record.kind==='review')node.append(make('strong',reviewLabels[record.decision]),badge('人工代码审阅',record.decision==='needs-work'?'changes-requested':record.decision),make('p',record.reason));
    if(record.kind==='verification')node.append(make('strong',verificationLabels[record.status]+' · '+sourceLabels[record.source]),badge('外部验证结果 · 填写者自述',record.status),make('p',record.method),make('p',record.evidence),make('small','来源：'+record.author+'。这段文字或命令没有在工作区中执行；结果未经工具独立验证。'));
    if(record.kind==='note')node.append(make('strong',sourceLabels[record.source]+'的解释'),make('p',record.text),make('small','解释来源：'+record.author+'，尚未独立核实。'));
    node.append(make('small',`${targetName(record.target)} · 记录者 ${record.actor} · ${time(record.at)}`));return node;
  }
  function appendRecords(value,all=false) {
    const items=all ? data.records : recordsFor(value),list=section(all?'这份固定比较的全部记录':'这个审阅对象的已保存记录');list.classList.add('review-records');
    if(!items.length){list.append(make('p','尚无审阅或验证记录。原功能关联的接受状态不会填充这里。'));return;}
    for(const item of items.slice().reverse().slice(0,100))list.append(renderRecord(item));
    if(items.length>100)list.append(make('p',`此处展示最近 100 条，共 ${items.length} 条；完整历史保留在导出中。`,'budget-note'));
  }
  function draftKey(value,kind) {return JSON.stringify([report().comparisonDigest,value.kind,value.id,kind]);}
  function currentDraft(value,kind) {
    const key=draftKey(value,kind);
    if(!drafts.has(key))drafts.set(key,{dirty:false,target:{...value},kind,comparisonDigest:report().comparisonDigest,actor:lastActor,decision:'unreviewed',reason:'',status:'not-run',source:'manual',author:lastActor,method:'',evidence:'',text:''});
    return {key,value:drafts.get(key)};
  }
  function formField(parent,label,id,value,{select,textarea=false,required=false,maxLength=4000}={}) {
    const wrapper=make('label',label,'review-field'),input=make(select?'select':textarea?'textarea':'input');input.id=id;input.required=required;
    if(select)for(const [optionValue,text] of select){const option=make('option',text);option.value=optionValue;input.append(option);}else input.maxLength=maxLength;
    input.value=value;wrapper.append(input);parent.append(wrapper);return input;
  }
  function appendRecordForm() {
    const boundTarget=target();if(!boundTarget)return;
    const form=make('form',null,'review-form');form.id='review-record-form';form.append(make('h4','留下这次审阅的结论'),make('p',`对象：${targetName(boundTarget)}。所有记录只绑定上方这对代码与标注版本。`));
    const kinds=formField(form,'这次记录什么？','review-record-kind',recordKind,{select:[['review','人工代码审阅'],['verification','外部验证结果'],['note','补充解释']]});
    kinds.onchange=()=>{recordKind=kinds.value;renderDetail();};
    const draft=currentDraft(boundTarget,recordKind),value=draft.value;
    const otherDrafts=[...drafts.entries()].filter(([key,item])=>key!==draft.key && item.dirty && item.comparisonDigest===report().comparisonDigest);
    if(otherDrafts.length){
      const pending=make('div',null,'review-card');pending.append(make('strong',`还有 ${otherDrafts.length} 条未保存记录`));
      for(const [,item] of otherDrafts){const label=({review:'人工审阅',verification:'验证结果',note:'解释'})[item.kind];pending.append(button(`${targetName(item.target)} · ${label}`,()=>{selected={...item.target};recordKind=item.kind;category=item.target.kind==='feature'?'features':item.target.kind==='file'?'unassigned':'overview';renderLists();renderDetail();}));}
      form.append(pending);
    }
    const field=(parent,label,key,options)=>{const input=formField(parent,label,'review-record-'+key,value[key],options);input.addEventListener('input',()=>{value[key]=input.value;value.dirty=true;});input.addEventListener('change',()=>{value[key]=input.value;value.dirty=true;});return input;};
    const row=make('div',null,'review-form-row');field(row,'记录者（自述身份）','actor',{required:true,maxLength:200});
    if(recordKind==='review')field(row,'人工结论','decision',{select:Object.entries(reviewLabels)});
    else field(row,'来源类型','source',{select:Object.entries(sourceLabels)});
    form.append(row);
    if(recordKind==='review')field(form,'判断理由与仍需检查的地方','reason',{textarea:true,required:true,maxLength:8000});
    else {
      field(form,'来源名称（自述，未认证）','author',{required:true,maxLength:200});
      if(recordKind==='verification'){
        field(form,'外部验证结果','status',{select:Object.entries(verificationLabels)});
        field(form,'采用的验证方法','method',{textarea:true,required:true,maxLength:2000});
        field(form,'结果依据或日志节选','evidence',{textarea:true,required:true,maxLength:12000});
        form.append(make('p','命令、日志和结果按文字保存。来源标为 Agent 时，仍保留为 Agent 自述，不自动成为人工验收。'));
      }else field(form,'解释内容','text',{textarea:true,required:true,maxLength:12000});
    }
    const note=make('p',null,'review-form-note');note.id='review-record-note';
    if(!canWrite())note.textContent='这份比较不是当前可写版本。已有记录可阅读和导出；新的结论请在当前版本核对后填写。';
    else if(hasDraft())note.textContent='未保存内容仍绑定这份比较。可逐项保存，或明确取消对应草稿。';
    form.append(note);
    const actions=make('div',null,'review-inline-actions'),save=make('button','保存这条记录','primary');save.type='submit';save.id='review-record-save';save.disabled=!canWrite() || busy;
    const cancel=button('取消这条草稿',()=>{drafts.delete(draft.key);renderDetail();message('这条未保存记录已取消。已保存历史仍保留。');});cancel.id='review-record-cancel';cancel.disabled=busy;
    const exportDraft=button('导出未保存记录',()=>download(JSON.stringify({draftVersion:1,comparison:{taskId:report().task.id,before:report().before,after:report().after,comparisonDigest:report().comparisonDigest},drafts:[...drafts.values()].filter(item=>item.dirty)},null,2),'repographia-review-drafts.json','application/json'));exportDraft.id='review-export-drafts';
    actions.append(save,cancel,exportDraft);form.append(actions);detail.append(form);
    if(!canWrite())for(const control of form.querySelectorAll('input,textarea,select'))control.disabled=true;
    form.onsubmit=async event=>{
      event.preventDefault();if(busy || !canWrite())return;
      busy=true;for(const control of form.querySelectorAll('input,textarea,select,button'))control.disabled=true;
      const r=report(),revision=data.revision,kind=recordKind,record={kind,target:{...boundTarget},actor:value.actor.trim()};
      if(kind==='review')Object.assign(record,{decision:value.decision,reason:value.reason.trim()});
      if(kind==='verification')Object.assign(record,{status:value.status,source:value.source,author:value.author.trim(),method:value.method.trim(),evidence:value.evidence.trim()});
      if(kind==='note')Object.assign(record,{source:value.source,author:value.author.trim(),text:value.text.trim()});
      try{
        const next=await guardCurrent('保存开发审阅记录',ctx=>{
          if(ctx.snapshot!==r.after.snapshot || (ctx.featureDigest ?? null)!==r.after.featureDigest)throw new Error('审阅记录绑定的代码或标注已经变化，请保留草稿并重新核对。');
          return api('/api/development-review/records','POST',{taskId:r.task.id,snapshot:r.after.snapshot,featureDigest:r.after.featureDigest,comparisonDigest:r.comparisonDigest,expectedRevision:revision,record});
        });
        if(next.report.comparisonDigest!==r.comparisonDigest)throw new Error('返回的比较版本与当前审阅不同。');
        data=next;pendingRecords=null;drafts.delete(draft.key);lastActor=record.actor;busy=false;renderAll();message(kind==='review'?'人工审阅已保存。结论仅适用于这份固定比较。':'记录已保存。来源和验证声明与人工代码审阅分别保留。','success');
      }catch(error){busy=false;renderDetail();errorMessage(error,'保存记录');}
      finally{busy=false;updateTaskOptions();}
    };
  }
  function renderDetail(animate=false) {
    if(!report())return;
    if(selected.kind==='feature')return renderFeature(selected.id,animate);
    if(selected.kind==='file')return renderFile(selected.id,animate);
    if(selected.kind==='criterion')return renderCriterion(selected.id,animate);
    if(selected.kind==='records'){
      header('SAVED REVIEW RECORDS','这份比较的审阅记录','人工代码审阅、验证结果和外部解释分别保留。它们只适用于上方展示的固定版本。',animate);
      appendRecords(target(),true);appendVersionsAndLimits();return;
    }
    renderOverview(animate);
  }
  function renderAll(animate=false) {updateTaskOptions();renderContext();renderSummary();renderLists();renderDetail(animate);}
  async function refresh(force=false,acceptNewRecords=false) {
    const ctx=context(),key=ctxKey(ctx);updateTaskOptions();
    if(!active || busy || loading || historyLoading || historical)return;
    if(!key){data=null;loadedKey='';$('review-export').disabled=true;$('review-summary').replaceChildren();$('review-context').replaceChildren();$('review-list').replaceChildren();$('review-categories').replaceChildren();header('START A DEVELOPMENT ROUND','先记录一轮开发的起点','已有改动会纳入起点。之后保存的代码与功能标注，可以和这个起点逐项比较。');detail.append(button('开始一轮开发',startTask,'primary'));return;}
    if(!force && key===loadedKey && Date.now()-lastLoaded<6000)return;
    if(hasDraft() && key!==loadedKey){renderContext();message('未保存记录仍绑定原比较。请先保存或取消草稿，再载入另一个版本。');return;}
    loading=true;const seq=++loadSequence;
    try{
      const result=await api('/api/development-review?'+new URLSearchParams({task:ctx.taskId,snapshot:ctx.snapshot,featureDigest:ctx.featureDigest ?? 'none'}));
      if(seq!==loadSequence || key!==ctxKey(context()) || historical)return;
      lastLoaded=Date.now();
      if(hasDraft() && data && result.report.comparisonDigest!==data.report.comparisonDigest){
        data.current={writable:false,reasons:['比较内容的依据已变化，原草稿不能自动换绑']};renderContext();message('固定比较的依据发生了变化。原草稿仍保留，请先导出或取消，再载入新比较。');return;
      }
      if(hasDraft() && data && !acceptNewRecords){
        if(result.revision!==data.revision){pendingRecords=result;message('另一个窗口已追加审阅记录。当前草稿保留，请核对新增记录后再保存。','info',{label:'核对最新审阅记录',run:()=>refresh(true,true)});}
        else {data.current=result.current;renderContext();if(!canWrite()){$('review-record-save')?.setAttribute('disabled','');message('代码或标注已变化，当前草稿保留为原比较的内容。可导出或取消，再对新版本审阅。');}}
        return;
      }
      const changed=!data || result.report.comparisonDigest!==data.report.comparisonDigest || result.revision!==data.revision || JSON.stringify(result.current)!==JSON.stringify(data.current) || force;
      data=result;loadedKey=key;pendingRecords=null;
      if(changed)renderAll(!hasDraft() && !force);
      if(acceptNewRecords)message('已载入最新审阅记录，当前草稿保留。请核对已有结论，再决定是否保存。');
      else if(!canWrite())message('正在查看固定的历史比较。已有记录可阅读和导出，新记录需要对当前版本重新核对。');
      else if(!hasDraft())message('代码事实、目标声明与人工结论分别展示。未记录的验证保持未知。');
    }catch(error){errorMessage(error,'载入开发审阅');}
    finally{loading=false;updateTaskOptions();}
  }
  $('review-task-select').onchange=async event=>{
    if(hasDraft()){event.target.value=context().taskId || '';message('请先保存或取消审阅草稿，再选择另一轮开发任务。');return;}
    historical=false;selected={kind:'round'};category='overview';loadedKey='';await selectTask(event.target.value || null);void refresh(true);
  };
  $('review-export').onclick=async()=>{
    if(!report())return;
    try{const r=report(),saved=(data.history || []).some(item=>item.comparisonDigest===r.comparisonDigest);
      const text=saved?await api('/api/development-reviews/'+encodeURIComponent(r.comparisonDigest)+'/export','GET',undefined,true):JSON.stringify(data,null,2);
      download(text,'repographia-development-review-'+short(r.comparisonDigest)+'.json','application/json');message('已请求下载这份固定比较与已保存记录。未保存的表单可单独导出。','success');
    }catch(error){errorMessage(error,'导出审阅');}
  };
  $('review-start').onclick=startTask;
  return {
    show(visible){active=visible;if(visible){updateTaskOptions();void refresh();}},
    update(){updateTaskOptions();if(active){renderContext();void refresh();}},
    invalidate(){lastLoaded=0;if(active)void refresh(true);},
    hasDraft,
    focusDraft(){const value=[...drafts.values()].find(item=>item.dirty && item.comparisonDigest===report()?.comparisonDigest);if(value){selected={...value.target};recordKind=value.kind;category=value.target.kind==='feature'?'features':value.target.kind==='file'?'unassigned':'overview';}openPanel();renderLists();renderDetail();},
    clearForTask(){if(!hasDraft()){historical=false;selected={kind:'round'};category='overview';loadedKey='';}}
  };
}
