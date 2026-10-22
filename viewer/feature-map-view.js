/** Editable semantic sidecar, explicit hierarchy and a read-only underlying code graph. */
function createFeatureMapView({graph,api,migrationApi=FeatureMigration,initial,make,button,onNode,onEvidence,onActivate,shell}) {
  const $=id=>document.getElementById(id),panel=$('feature-view');
  const migrationButton=make('button','跨快照迁移');migrationButton.id='feature-migrate';panel.querySelector('.feature-actions').append(migrationButton);
  const migrationPanel=make('section');migrationPanel.id='feature-migration';migrationPanel.hidden=true;$('feature-cards').before(migrationPanel);
  const labels={proposed:'待审提案',accepted:'人工接受（自述）',rejected:'已拒绝'};
  const roles={entry:'入口',implementation:'实现',support:'支撑',test:'测试代码（未运行）'};
  const issues={'changed-snapshot':'分析快照已变化','changed-analysisRevision':'分析规则已变化',
    'changed-compilerVersion':'编译器已变化','changed-config':'编译配置已变化','unversioned-analysis':'分析规则未标注',
    'changed-source':'源码哈希已变化','missing-file':'文件不在索引中','missing-node':'原实体不存在',
    'changed-node-anchor':'实体区间/类型已变化','missing-relation':'原关系不存在','changed-relation-anchor':'关系证据已变化',
    'unrelated-relation':'证据不关联该实体','missing-relation-endpoint':'关系端点缺失'};
  const warnings={'file-level-scope':'文件级映射不自动分配给所有子函数','type-declaration-anchor':'仅类型声明，不是实现函数','semantic-claim-not-program-proof':'功能语义是标注，不是程序证明','declaration-only':'仅声明证据',
    'evidence-candidate':'依赖候选关系','evidence-unresolved':'依赖未解析关系','evidence-external':'依赖外部边界',
    'type-only-evidence':'含仅类型关系','non-call-evidence':'含非调用关系','incomplete-value-origins':'来源集合不完整',
    'truncated-value-origins':'来源追踪已截断'};
  let doc=initial?api.validate(initial):api.create(graph),report=api.assess(graph,doc);
  let active=false,scopeId=null,mode='features',selected=null,selectedMapping=null,detailTab='about',dirty=false,actor='',reason='';
  let inspectorKey=null;
  const scopes=new Map(),inspections=new Map(),scopeKey=()=>scopeId;
  const fields=(box,name,value='',multiline=false)=>{
    const label=make('label',name,'feature-field'),input=make(multiline?'textarea':'input');
    input.value=value;input.setAttribute('aria-label',name);label.append(input);box.append(label);return input;
  };
  function notice(text){$('feature-notice').textContent=text;}
  function context(box){
    const a=fields(box,'编辑者（自述身份）',actor);a.oninput=()=>{actor=a.value;};
    const r=fields(box,'本次修改理由',reason);r.oninput=()=>{reason=r.value;};
  }
  function fold(box,title,cls='',open=false){const d=make('details',null,'feature-fold '+cls);d.open=open;d.append(make('summary',title));box.append(d);return d;}
  function saveInspector(){
    if(!inspectorKey)return;
    inspections.set(inspectorKey,{tab:detailTab,scroll:$('detail').scrollTop,outerScroll:document.querySelector('.inspector').scrollTop,
      folds:[...$('detail').querySelectorAll('.feature-fold')].map(d=>({name:d.className,open:d.open}))});
  }
  function remember(){saveInspector();const previous=scopes.get(scopeKey());scopes.set(scopeKey(),{mode,selected,selectedMapping:mode==='code'?selectedMapping:previous?.selectedMapping||null,detailTab});}
  function setDetailTab(tab){
    detailTab=tab;
    for(const b of $('detail').querySelectorAll('.feature-detail-tabs button'))b.setAttribute('aria-pressed',String(b.dataset.tab===tab));
    for(const p of $('detail').querySelectorAll('.feature-detail-panel'))p.hidden=p.dataset.panel!==tab;
  }
  function inspector(key,title,eyebrow){
    inspectorKey=key;detailTab=inspections.get(key)?.tab||'about';
    const box=$('detail'),tabs=make('div',null,'feature-detail-tabs'),header=make('div',null,'feature-detail-header'),heading=make('div');
    heading.append(make('span',eyebrow,'eyebrow'),make('h3',title));
    header.append(heading);
    for(const [id,label]of [['about','说明'],['evidence','依据'],['review','审阅']]){
      const b=button(label,()=>{setDetailTab(id);saveInspector();});b.dataset.tab=id;tabs.append(b);
    }
    box.replaceChildren(tabs,header);const parts={};
    for(const id of ['about','evidence','review']){const section=make('section',null,'feature-detail-panel');section.dataset.panel=id;box.append(section);parts[id]=section;}
    setDetailTab(detailTab);return parts;
  }
  function finishInspector(){
    const saved=inspections.get(inspectorKey);
    if(saved){for(const d of $('detail').querySelectorAll('.feature-fold')){const f=saved.folds.find(x=>x.name===d.className);if(f)d.open=f.open;}$('detail').scrollTop=saved.scroll;document.querySelector('.inspector').scrollTop=saved.outerScroll||0;}
  }
  const sceneView=createFeatureSceneView({graph,make,button,onFeature:showFeature,onMapping:showMapping,onRelations:showRelations});
  const workbench=createFeatureWorkbenchView({graph,api,make,button,shell,onSelect:showFeature,
    onEnter:(id,requested)=>navigate(id,requested),onCode:id=>navigate(id,'code'),
    onParent:()=>{if(scopeId){const exited=scopeId,parent=doc.features.find(f=>f.id===scopeId)?.parentId||null;navigate(parent,undefined,{returning:true,selectId:exited});}},
    onMode:next=>navigate(scopeId,next),onJump:id=>jump(id)});
  function normalizeView(){
    if(scopeId&&!doc.features.some(f=>f.id===scopeId))scopeId=null;
    if(!scopeId)mode='features';
    const f=doc.features.find(f=>f.id===selected);
    if(mode==='code'||!f||(f.id!==scopeId&&(f.parentId||null)!==scopeId))selected=scopeId;
    if(mode!=='code'||!report.mappings.some(m=>m.mapping.id===selectedMapping&&m.mapping.featureId===scopeId))selectedMapping=null;
  }
  function refresh(){
    normalizeView();
    const s=report.summary;$('feature-summary').textContent=`${s.features} 个功能提案 · ${s.mappings} 条映射 · ${s.stale} 条失效 · 文档版本 ${doc.revision}${dirty?' · 未保存草稿':''}`;
    workbench.render(report,{scopeId,mode,selected});renderList('',60);
    if(mode==='code'&&scopeId)sceneView.show(doc.features.find(f=>f.id===scopeId),report);else sceneView.leave();
  }
  function renderInspector(){
    if(selectedMapping&&report.mappings.some(m=>m.mapping.id===selectedMapping))renderMapping(selectedMapping);
    else if(selected&&doc.features.some(f=>f.id===selected))renderFeature(selected);
    else renderOverview();
  }
  function navigate(id,requested,{returning=false,selectId=null,locate=false}={}){
    if(id&&!doc.features.some(f=>f.id===id))return;
    const snapshot=workbench.capture(id);remember();migrationView.close();
    scopeId=id;const saved=scopes.get(scopeKey()),children=api.hierarchy(doc.features).children(id);
    mode=id?(requested||saved?.mode||(children.length?'features':'code')):'features';
    selected=selectId||saved?.selected||id;selectedMapping=mode==='code'?saved?.selectedMapping||null:null;
    if(mode==='code')selected=id;
    if(selected)workbench.showDetails();
    refresh();renderInspector();workbench.transition(returning,snapshot);if(locate&&selected)workbench.locate(selected);else shell.revealMap();
  }
  function jump(id){const f=doc.features.find(f=>f.id===id);if(f)navigate(f.parentId||null,'features',{selectId:id,locate:true});}
  function enter(){
    active=true;document.body.classList.add('feature-active');panel.hidden=false;$('project-view').hidden=true;$('local-view').hidden=true;
    $('return-project').hidden=false;$('kind').disabled=true;$('status').disabled=true;$('show-tests').disabled=true;
    $('map-title').textContent='功能地图';refresh();renderInspector();
  }
  function leave(){remember();sceneView.leave();workbench.leave();document.body.classList.remove('feature-active');active=false;panel.hidden=true;$('kind').disabled=false;$('status').disabled=false;$('show-tests').disabled=false;}
  function renderList(search='',limit=60){
    if(!active)return;const hierarchy=api.hierarchy(doc.features),q=search.trim().toLowerCase();
    const items=report.features.filter(f=>`${f.title} ${f.summary||''} ${f.description} ${f.id}`.toLowerCase().includes(q));
    $('list-count').textContent=items.length;$('more').hidden=items.length<=limit;
    $('node-list').replaceChildren(...items.slice(0,limit).map(f=>{
      const b=button('',()=>{jump(f.id);shell.toggleNavigation(false,false);},'node-row'+(selected===f.id?' active':''));
      b.dataset.feature=f.id;b.append(make('strong',f.title));const path=hierarchy.path(f.id).slice(0,-1);if(path.length)b.append(make('small',path.map(x=>x.title).join(' / ')));return b;
    }));
  }
  function renderOverview(){
    inspectorKey=null;const box=$('detail');box.replaceChildren(make('span','功能地图','eyebrow'),make('h3','从一个功能开始'),
      make('p','点选节点阅读说明，点击“进入功能”查看下一层。路径栏可以随时返回。'),
      make('p','功能连线表示明确标注的包含关系；关联代码另行查看。','meta'),
      make('p','当前内容是有限范围的功能提案，不是完整功能清单。','meta'));
    if(report.globalIssues.length)box.append(make('div',report.globalIssues.map(x=>issues[x]||x).join('；'),'callout'));
  }
  function showFeature(id){
    const f=doc.features.find(f=>f.id===id);if(!f)return;
    if(id!==scopeId&&(f.parentId||null)!==scopeId){jump(id);return;}
    saveInspector();migrationView.close();selected=id;selectedMapping=null;
    sceneView.select(null);workbench.select(id);renderList('',60);renderFeature(id);workbench.showDetails();
  }
  function renderFeature(id){
    const f=doc.features.find(f=>f.id===id);if(!f)return;
    const parts=inspector('feature:'+id,f.title,'功能说明'),children=api.hierarchy(doc.features).children(id),items=report.mappings.filter(m=>m.mapping.featureId===id);
    const excerpt=Array.from(f.description);parts.about.append(make('p',f.summary||(excerpt.length>160?excerpt.slice(0,160).join('')+'…':f.description),'feature-inspector-summary'));
    const description=fold(parts.about,'完整功能说明','feature-description');description.append(make('p',f.description));
    const questions=fold(parts.about,`待确认问题 · ${f.questions.length}`,'feature-questions');
    for(const q of f.questions)questions.append(make('p',q,'callout'));
    const actions=make('div',null,'feature-detail-actions');
    const go=button(children.length?'进入功能 →':'查看实现 →',()=>navigate(id),'feature-enter');
    const code=button('关联代码',()=>navigate(id,'code'),'feature-open-code');actions.append(go,code);parts.about.append(actions);
    parts.evidence.append(make('p',`${children.length} 个直接子功能 · ${items.length} 条显式代码关联`));
    if(items.some(m=>!m.current))parts.evidence.append(make('div','含失效映射；旧锚点不会连接到当前代码。','callout'));
    parts.evidence.append(make('p','代码角色仅用于分组。共享代码不表示功能依赖，也不表示执行顺序。','meta'),button('查看全部关联代码',()=>navigate(id,'code'),'detail-link'));
    parts.review.append(button('编辑功能说明',()=>featureForm(f),'detail-link'));
    const creation=doc.history.find(h=>h.operation==='feature'&&h.subject===id);
    parts.review.append(make('p',creation?`标注来源：${creation.actorKind} / ${creation.actor}（自述，未认证）`:'标注来源未记录','meta'),make('p','人工接受是审阅决定，不会把候选证据升级为程序证明。','meta'));
    finishInspector();
  }
  function snapshot(){saveInspector();return{scopeId,mode,selected,selectedMapping,detailTab};}
  function restore(saved){
    scopeId=saved.scopeId&&doc.features.some(f=>f.id===saved.scopeId)?saved.scopeId:null;mode=scopeId?saved.mode:'features';
    selected=saved.selected;selectedMapping=saved.selectedMapping;detailTab=saved.detailTab;
    if(!active)onActivate();else{refresh();renderInspector();}workbench.showDetails();
  }
  function backButton(saved=snapshot()){return button('← 返回功能映射',()=>restore(saved),'detail-link feature-back');}
  function openEvidence(edge){if(!edge)return;const saved=snapshot();onEvidence(edge);inspectorKey=null;$('detail').prepend(backButton(saved));workbench.showDetails();}
  function showRelations(ids){
    const saved=snapshot(),box=$('detail');inspectorKey=null;box.replaceChildren(make('h3','原始调用证据'),backButton(saved),make('p','仅原图 call / construct / tag；不推断执行顺序或功能依赖。'));
    for(const id of ids){const edge=graph.relations.find(r=>r.id===id);if(edge)box.append(button(`${edge.kind} · ${edge.status} · ${edge.evidence.location.file}:${edge.evidence.location.line}`,()=>{onEvidence(edge);$('detail').prepend(backButton(saved));},'detail-link feature-evidence'));}
    workbench.showDetails();
  }
  function showMapping(id){
    const item=report.mappings.find(m=>m.mapping.id===id);if(!item)return;
    if(scopeId!==item.mapping.featureId||mode!=='code')navigate(item.mapping.featureId,'code');
    saveInspector();migrationView.close();selected=item.mapping.featureId;selectedMapping=id;sceneView.select(id);renderList('',60);renderMapping(id);workbench.showDetails();
  }
  function renderMapping(id){
    const item=report.mappings.find(m=>m.mapping.id===id);if(!item)return;
    const m=item.mapping,label=sceneView.label(item),parts=inspector('mapping:'+id,label.title,'代码关联');sceneView.select(id);
    parts.about.append(make('p',label.file+(label.line?' : '+label.line:''),'feature-inspector-path'),make('p',`${roles[m.role]} · ${labels[m.decision]} · ${item.current?'证据匹配':'已失效'}`),make('p',m.rationale));
    if(!item.current)parts.about.append(make('div','已失效：'+item.issues.map(x=>issues[x]||x).join('；'),'callout'));
    if(item.warnings.some(x=>['evidence-candidate','evidence-unresolved','evidence-external'].includes(x)))parts.about.append(make('p',item.warnings.filter(x=>['evidence-candidate','evidence-unresolved','evidence-external'].includes(x)).map(x=>warnings[x]).join(' · '),'feature-evidence-status'));
    if(item.current)parts.about.append(button('打开关联源码',()=>{const saved=snapshot();onNode(m.code.nodeId);inspectorKey=null;$('detail').prepend(backButton(saved));},'detail-link feature-source'));
    else parts.about.append(make('p','当前代码已不匹配：禁止按同名跳转或自动重新绑定。请导入旧代码图，使用跨快照迁移。'));
    parts.about.append(button('返回功能说明',()=>showFeature(m.featureId),'detail-link'));
    const caution=fold(parts.evidence,`证据限制 · ${item.warnings.length}`,'feature-warning-details');caution.append(make('p',item.warnings.map(x=>warnings[x]||x).join('；')));
    const identity=fold(parts.evidence,'原始符号与定位','feature-identity');identity.append(make('p',m.code.name,'meta'),make('p',m.code.nodeId,'meta'),make('p',`${m.code.file} · UTF-16 [${m.code.start}, ${m.code.end})`,'meta'),make('p','SHA-256 '+m.code.fileHash,'meta'));
    if(m.basis)identity.append(make('p','证据快照：'+m.basis.snapshot,'meta'));
    if(item.current){
      const evidence=fold(parts.evidence,`原始关系证据 · ${m.evidence.length}`,'feature-evidence-details');
      for(const ref of m.evidence)evidence.append(button(`${ref.kind} · ${ref.status} · 查看原关系`,()=>openEvidence(graph.relations.find(e=>e.id===ref.relationId)),'detail-link feature-evidence'));
      if(!m.evidence.length)evidence.append(make('p','仅记录声明锚点，没有附加关系证据。'));
    }
    parts.review.append(button('修正关联理由、角色与证据',()=>mappingForm(m),'detail-link feature-correct'));
    const review=fold(parts.review,'审阅与修改决定','feature-review-details');context(review);
    for(const state of ['accepted','rejected','proposed']){
      const b=button(labels[state],()=>{if(edit({op:'review',id,decision:state}))showMapping(id);},'detail-link feature-review');b.dataset.decision=state;b.disabled=state==='accepted'&&!item.current;review.append(b);
    }
    const history=doc.history.filter(h=>h.subject===id).slice(-10),log=fold(parts.review,'最近修改记录（自述）','feature-history');
    for(const h of history)log.append(make('p',`r${h.revision} · ${h.actorKind}/${h.actor} · ${h.operation} · ${h.reason}`,'meta'));
    finishInspector();
  }
  function edit(operation){
    try{
      saveInspector();doc=api.edit(graph,doc,operation,{expectedRevision:doc.revision,actor,actorKind:'manual',reason,at:new Date().toISOString()});
      dirty=true;report=api.assess(graph,doc);refresh();notice('内存草稿已修改，尚未写入文件。请导出 JSON 保存。');return true;
    }catch(error){notice(error.message);return false;}
  }
  function featureForm(f){
    saveInspector();migrationView.close();inspectorKey=null;const box=$('detail');box.replaceChildren(make('h3',f?'编辑功能说明':'新建功能提案'));context(box);
    const title=fields(box,'功能名称',f?.title||''),summary=fields(box,'一句解释（可选）',f?.summary||'');summary.maxLength=200;
    const parentLabel=make('label','父功能（可选）','feature-field'),parent=make('select');parent.setAttribute('aria-label','父功能（可选）');
    const root=make('option','无 · 作为顶层功能');root.value='';parent.append(root);
    const hierarchy=api.hierarchy(doc.features),excluded=new Set(f?[f.id,...hierarchy.descendants(f.id).map(x=>x.id)]:[]);
    for(const item of doc.features){if(excluded.has(item.id))continue;const option=make('option',hierarchy.path(item.id).map(x=>x.title).join(' / '));option.value=item.id;parent.append(option);}
    parent.value=f?.parentId||(f?'':scopeId||'');parentLabel.append(parent);box.append(parentLabel);
    const description=fields(box,'功能说明',f?.description||'',true),questions=fields(box,'待确认问题（每行一个）',f?.questions.join('\n')||'',true);
    box.append(make('p','父功能只表示包含关系。修改功能含义会将此前接受的映射退回待审。','meta'),button('保存到内存草稿',()=>{
      const id=f?.id||freshId('feature'),feature={id,title:title.value,description:description.value,questions:questions.value.split('\n').filter(x=>x.trim())};
      if(summary.value.trim())feature.summary=summary.value;if(parent.value)feature.parentId=parent.value;
      if(edit({op:'feature',feature}))jump(id);
    },'detail-link feature-save'),button('取消',()=>renderInspector(),'detail-link'));workbench.showDetails();
  }
  function mappingForm(m){
    saveInspector();inspectorKey=null;const box=$('detail');box.replaceChildren(make('h3','修正代码关联'));context(box);
    const target=fields(box,'关联实体准确 ID',m.code.nodeId),role=make('select');role.setAttribute('aria-label','修正代码角色');
    for(const [k,v]of Object.entries(roles)){const option=make('option',v);option.value=k;role.append(option);}role.value=m.role;box.append(role);
    const why=fields(box,'修正关联理由',m.rationale,true),refs=fields(box,'关系准确 ID（每行一个）',m.evidence.map(e=>e.relationId).join('\n'),true);
    box.append(make('p','显式更换目标或证据会退回待审。跨快照请先迁移；不会猜测同名目标。'),button('保存关联修正',()=>{
      if(edit({op:'mapping',id:m.id,featureId:m.featureId,nodeId:target.value.trim(),role:role.value,rationale:why.value,relationIds:refs.value.split('\n').map(x=>x.trim()).filter(Boolean)}))showMapping(m.id);
    },'detail-link feature-correction-save'),button('取消',()=>renderInspector(),'detail-link'));workbench.showDetails();
  }
  function freshId(prefix){let n=doc.revision+1;while([...doc.features,...doc.mappings].some(x=>x.id===`${prefix}-${n}`))n++;return `${prefix}-${n}`;}
  function decorateNode(box,n){
    const items=report.mappings.filter(m=>m.current&&m.mapping.decision!=='rejected'&&m.mapping.code.nodeId===n.id);
    const hierarchy=api.hierarchy(doc.features),path=id=>hierarchy.path(id).map(f=>f.title).join(' / ');
    box.append(make('h4',`关联功能 · ${items.length}（仅显式映射）`));
    for(const item of items)box.append(button(path(item.mapping.featureId),()=>{onActivate();showMapping(item.mapping.id);},'detail-link feature-reverse'));
    if(doc.features.length)box.append(button('将此实体关联到功能…',()=>{
      onActivate();saveInspector();inspectorKey=null;const box=$('detail');box.replaceChildren(make('h3','添加代码映射'),make('p',n.name+' · '+n.location.file));context(box);
      const f=make('select'),r=make('select');f.setAttribute('aria-label','目标功能');r.setAttribute('aria-label','代码角色');
      for(const item of doc.features){const o=make('option',path(item.id));o.value=item.id;f.append(o);}
      for(const [k,v]of Object.entries(roles)){const o=make('option',v);o.value=k;r.append(o);}box.append(f,r);
      const why=fields(box,'关联理由','',true);box.append(make('p','此入口保存声明证据；关系证据可通过 CLI 显式添加，不会自动拉入全部调用。'),button('添加为待审提案',()=>{
        const id=freshId('mapping');if(edit({op:'mapping',id,featureId:f.value,nodeId:n.id,role:r.value,rationale:why.value,relationIds:[]}))showMapping(id);
      },'detail-link'));workbench.showDetails();
    },'detail-link'));
  }
  function resetView(){scopeId=null;mode='features';selected=null;selectedMapping=null;inspectorKey=null;scopes.clear();inspections.clear();sceneView.reset();workbench.reset();refresh();renderOverview();}
  $('feature-new').onclick=()=>featureForm(null);
  $('feature-export').onclick=()=>{
    const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='features-r'+doc.revision+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    notice('已请求导出 JSON；请保存下载文件。页面不会写入仓库，也不会更新原 HTML。');
  };
  $('feature-import').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;const previous=doc;
    try{
      if(file.size>5*1024*1024)throw new Error('标注文件超过 5 MiB');const next=api.validate(JSON.parse(await file.text()));
      if(doc!==previous)throw new Error('导入期间发生编辑，请重试，当前草稿未覆盖。');
      if(dirty&&!confirm('导入将替换未保存的内存草稿，继续？'))return;
      const checked=api.assess(graph,next);doc=next;report=checked;dirty=false;migrationView.close();resetView();
      notice(checked.summary.stale?'已导入，但部分映射失效；没有自动重绑定。':'标注已载入内存，原文件未修改。');
    }catch(error){notice('导入失败：'+error.message);}finally{event.target.value='';}
  };
  const migrationView=createFeatureMigrationView({graph,api:migrationApi,getDocument:()=>doc,make,button,fields,context,notice,
    onInspect:()=>{saveInspector();inspectorKey=null;workbench.showDetails();},
    editContext:()=>({expectedRevision:doc.revision,actor,actorKind:'manual',reason,at:new Date().toISOString()}),
    onApplied:next=>{doc=next;report=api.assess(graph,doc);dirty=true;resetView();}});
  return {enter,leave,renderList,decorateNode,backButton,get active(){return active;}};
}
