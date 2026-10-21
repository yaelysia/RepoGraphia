/** Semantic annotations are editable sidecar data; the underlying code graph remains read-only. */
function createFeatureMapView({graph, api, migrationApi=FeatureMigration, initial, make, button, onNode, onEvidence, onActivate}) {
  const $ = id => document.getElementById(id), panel = $('feature-view');
  const migrationButton=make('button','跨快照迁移');migrationButton.id='feature-migrate';panel.querySelector('.feature-actions').append(migrationButton);
  const migrationPanel=make('section');migrationPanel.id='feature-migration';migrationPanel.hidden=true;$('feature-cards').before(migrationPanel);
  const labels = {proposed:'待审提案', accepted:'人工接受（自述）', rejected:'已拒绝'};
  const roles = {entry:'入口', implementation:'实现', support:'支撑', test:'测试代码（未运行）'};
  const issues = {'changed-snapshot':'分析快照已变化','changed-analysisRevision':'分析规则已变化',
    'changed-compilerVersion':'编译器已变化','changed-config':'编译配置已变化','unversioned-analysis':'分析规则未标注',
    'changed-source':'源码哈希已变化','missing-file':'文件不在索引中','missing-node':'原实体不存在',
    'changed-node-anchor':'实体区间/类型已变化','missing-relation':'原关系不存在','changed-relation-anchor':'关系证据已变化',
    'unrelated-relation':'证据不关联该实体','missing-relation-endpoint':'关系端点缺失'};
  const warnings = {'file-level-scope':'文件级映射不自动分配给所有子函数','type-declaration-anchor':'仅类型声明，不是实现函数','semantic-claim-not-program-proof':'功能语义是标注，不是程序证明','declaration-only':'仅声明证据',
    'evidence-candidate':'依赖候选关系','evidence-unresolved':'依赖未解析关系','evidence-external':'依赖外部边界',
    'type-only-evidence':'含仅类型关系','non-call-evidence':'含非调用关系','incomplete-value-origins':'来源集合不完整',
    'truncated-value-origins':'来源追踪已截断'};
  let doc = initial ? api.validate(initial) : api.create(graph), report = api.assess(graph,doc);
  let active = false, selected = null, dirty = false, actor = '', reason = '';
  const fields = (box, name, value='', multiline=false) => {
    const label = make('label', name, 'feature-field'), input = make(multiline?'textarea':'input');
    input.value=value;input.setAttribute('aria-label',name);label.append(input);box.append(label);return input;
  };
  function notice(text) { $('feature-notice').textContent = text; }
  function edit(operation) {
    try {
      doc = api.edit(graph,doc,operation,{expectedRevision:doc.revision,actor,actorKind:'manual',reason,at:new Date().toISOString()});
      dirty=true;report=api.assess(graph,doc);refresh();
      notice('内存草稿已修改，尚未写入文件。请导出 JSON 保存。'); return true;
    } catch(error) { notice(error.message); return false; }
  }
  function context(box) {
    const a=fields(box,'编辑者（自述身份）',actor);a.oninput=()=>{actor=a.value;};
    const r=fields(box,'本次修改理由',reason);r.oninput=()=>{reason=r.value;};
  }
  const sceneView=createFeatureSceneView({graph,make,button,onFeature:showFeature,onMapping:showMapping,onRelations:showRelations});
  function fold(box,title,cls='',open=false) {
    const d=make('details',null,'feature-fold '+cls);d.open=open;d.append(make('summary',title));box.append(d);return d;
  }
  function refresh() {
    const s=report.summary;
    $('feature-summary').textContent=`${s.features} 个功能提案 · ${s.mappings} 条映射 · ${s.stale} 条失效 · 文档版本 ${doc.revision}${dirty?' · 未保存草稿':''}`;
    sceneView.overview(report,selected);
    renderList($('search').value,60);renderMappings();
  }
  function enter() {
    active=true;document.body.classList.add('feature-active');panel.hidden=false;$('project-view').hidden=true;$('local-view').hidden=true;
    $('return-project').hidden=false;$('kind').disabled=true;$('status').disabled=true;$('show-tests').disabled=true;
    $('map-title').textContent='功能地图';refresh();
    if(selected && doc.features.some(f=>f.id===selected)) showFeature(selected); else showOverview();
  }
  function leave() {sceneView.leave();document.body.classList.remove('feature-active');active=false;panel.hidden=true;$('kind').disabled=false;$('status').disabled=false;$('show-tests').disabled=false;}
  function renderList(search='',limit=60) {
    if(!active)return;
    const items=report.features.filter(f=>`${f.title} ${f.description} ${f.id}`.toLowerCase().includes(search.trim().toLowerCase()));
    $('list-count').textContent=items.length;$('more').hidden=items.length<=limit;
    $('node-list').replaceChildren(...items.slice(0,limit).map(f=>{
      const b=button(f.title,()=>showFeature(f.id),'node-row'+(selected===f.id?' active':''));b.dataset.feature=f.id;return b;
    }));
  }
  function showOverview() {
    migrationView.close();selected=null;sceneView.overview(report,null);sceneView.show(null,report);
    const box=$('detail');box.replaceChildren(make('h3','从一个功能开始'),
      make('p','功能与代码是显式多对多关联，不自动扩展为所有被调用代码。共有代码不表示功能之间存在调用。'),
      make('p','“证据匹配”仅表示锚点仍对应当前分析快照；人工接受也不会改变候选/未知关系。'),
      make('p','这是有限范围的功能提案，不是完整功能清单。'));
    if(report.globalIssues.length)box.append(make('div',report.globalIssues.map(x=>issues[x]||x).join('；'),'callout'));
  }
  function showFeature(id) {
    migrationView.close();
    selected=id;
    const f=doc.features.find(f=>f.id===id);if(!f)return;
    const box=$('detail');box.replaceChildren(make('span','功能说明 · 有限语义标注','eyebrow'),make('h3',f.title));
    const description=fold(box,'完整功能说明','feature-description',true);description.append(make('p',f.description));
    box.append(button('编辑功能说明',()=>featureForm(f),'detail-link'));
    const questions=fold(box,`待确认问题 · ${f.questions.length}`,'feature-questions');
    for(const q of f.questions)questions.append(make('p',q,'callout'));
    if(report.mappings.some(a=>a.mapping.featureId===id&&!a.current))box.append(make('div','含失效映射；旧锚点不会连接到当前代码。','callout'));
    sceneView.overview(report,selected);renderList($('search').value,60);
    const creation=doc.history.find(h=>h.operation==='feature'&&h.subject===id);
    box.append(make('p',creation?`标注来源：${creation.actorKind} / ${creation.actor}（自述，未认证）`:'标注来源未记录','meta'));
    const heading=$('feature-selected');heading.textContent='关联代码';renderMappings();
  }
  function renderMappings() {sceneView.show(doc.features.find(f=>f.id===selected),report);}
  function showRelations(ids) {
    const box=$('detail');box.replaceChildren(make('h3','原始调用证据'),backButton(),make('p','仅原图 call / construct / tag；不推断执行顺序或功能依赖。'));
    for(const id of ids){const e=graph.relations.find(r=>r.id===id);if(e)box.append(button(`${e.kind} · ${e.status} · ${e.evidence.location.file}:${e.evidence.location.line}`,()=>{onEvidence(e);$('detail').prepend(backButton());},'detail-link feature-evidence'));}
  }
  function showMapping(id) {
    migrationView.close();
    const item=report.mappings.find(m=>m.mapping.id===id);if(!item)return;
    if(selected!==item.mapping.featureId){selected=item.mapping.featureId;renderMappings();}
    sceneView.select(id);sceneView.overview(report,selected);renderList($('search').value,60);
    const m=item.mapping,box=$('detail'),label=sceneView.label(item);
    box.replaceChildren(make('span','代码关联','eyebrow'),make('h3',label.title),make('p',label.file+(label.line?' : '+label.line:''),'feature-inspector-path'),make('p',`${roles[m.role]} · ${labels[m.decision]} · ${item.current?'证据匹配':'已失效'}`),make('p',m.rationale));
    if(!item.current)box.append(make('div','已失效：'+item.issues.map(x=>issues[x]||x).join('；'),'callout'));
    const caution=fold(box,`证据限制 · ${item.warnings.length}`,'feature-warning-details');
    caution.append(make('p',item.warnings.map(x=>warnings[x]||x).join('；')));
    if(item.warnings.some(x=>['evidence-candidate','evidence-unresolved','evidence-external'].includes(x)))box.append(make('p',item.warnings.filter(x=>['evidence-candidate','evidence-unresolved','evidence-external'].includes(x)).map(x=>warnings[x]).join(' · '),'feature-evidence-status'));
    const identity=fold(box,'原始符号与定位','feature-identity');identity.append(make('p',m.code.name,'meta'),make('p',m.code.nodeId,'meta'),make('p',`${m.code.file} · UTF-16 [${m.code.start}, ${m.code.end})`,'meta'),make('p','SHA-256 '+m.code.fileHash,'meta'));
    if(m.basis)identity.append(make('p','证据快照：'+m.basis.snapshot,'meta'));
    if(item.current) {
      box.append(button('打开关联源码',()=>{onNode(m.code.nodeId);$('detail').prepend(backButton());},'detail-link feature-source'));
      const evidence=fold(box,`原始关系证据 · ${m.evidence.length}`,'feature-evidence-details');
      for(const ref of m.evidence)evidence.append(button(`${ref.kind} · ${ref.status} · 查看原关系`,()=>{
        onEvidence(graph.relations.find(e=>e.id===ref.relationId));$('detail').prepend(backButton());
      },'detail-link feature-evidence'));
    } else box.append(make('p','当前代码已不匹配：禁止按同名跳转或自动重新绑定。请导入旧代码图，使用跨快照迁移。'));

    box.append(button('修正关联理由、角色与证据',()=>mappingForm(m),'detail-link feature-correct'));
    const review=fold(box,'审阅与修改决定','feature-review-details');context(review);
    for(const state of ['accepted','rejected','proposed']) {
      const b=button(labels[state],()=>{if(edit({op:'review',id,decision:state}))showMapping(id);},'detail-link feature-review');
      b.dataset.decision=state;b.disabled=state==='accepted'&&!item.current;review.append(b);
    }
    const history=doc.history.filter(h=>h.subject===id).slice(-10),log=fold(box,'最近修改记录（自述）','feature-history');
    for(const h of history)log.append(make('p',`r${h.revision} · ${h.actorKind}/${h.actor} · ${h.operation} · ${h.reason}`,'meta'));
  }
  function featureForm(f) {
    migrationView.close();
    const box=$('detail');box.replaceChildren(make('h3',f?'编辑功能说明':'新建功能提案'));context(box);
    const title=fields(box,'功能名称',f?.title||''),description=fields(box,'功能说明',f?.description||'',true),questions=fields(box,'待确认问题（每行一个）',f?.questions.join('\n')||'',true);
    box.append(make('p','修改功能含义会将此前接受的映射退回待审，不会自动接受新语义。'),button('保存到内存草稿',()=>{
      const id=f?.id||freshId('feature');
      if(edit({op:'feature',feature:{id,title:title.value,description:description.value,questions:questions.value.split('\n').filter(x=>x.trim())}}))showFeature(id);
    },'detail-link feature-save'));
  }
  function mappingForm(m) {
    const box=$('detail');box.replaceChildren(make('h3','修正代码关联'));context(box);
    const target=fields(box,'关联实体准确 ID',m.code.nodeId),role=make('select');role.setAttribute('aria-label','修正代码角色');
    for(const [k,v] of Object.entries(roles)){const opt=make('option',v);opt.value=k;role.append(opt);}role.value=m.role;box.append(role);
    const why=fields(box,'修正关联理由',m.rationale,true),refs=fields(box,'关系准确 ID（每行一个）',m.evidence.map(e=>e.relationId).join('\n'),true);
    box.append(make('p','显式更换目标或证据会退回待审。跨快照请先迁移；不会猜测同名目标。'),button('保存关联修正',()=>{
      if(edit({op:'mapping',id:m.id,featureId:m.featureId,nodeId:target.value.trim(),role:role.value,rationale:why.value,relationIds:refs.value.split('\n').map(x=>x.trim()).filter(Boolean)}))showMapping(m.id);
    },'detail-link feature-correction-save'));
  }
  function freshId(prefix) {let n=doc.revision+1;while([...doc.features,...doc.mappings].some(x=>x.id===`${prefix}-${n}`))n++;return `${prefix}-${n}`;}
  function backButton() {return button('← 返回功能映射',()=>{onActivate();if(selected)showFeature(selected);},'detail-link feature-back');}
  function decorateNode(box,n) {
    const items=report.mappings.filter(m=>m.current&&m.mapping.decision!=='rejected'&&m.mapping.code.nodeId===n.id);
    box.append(make('h4',`关联功能 · ${items.length}（仅显式映射）`));
    for(const item of items)box.append(button(doc.features.find(f=>f.id===item.mapping.featureId).title,()=>{
      selected=item.mapping.featureId;onActivate();showMapping(item.mapping.id);
    },'detail-link feature-reverse'));
    if(doc.features.length)box.append(button('将此实体关联到功能…',()=>{
      onActivate();const box=$('detail');box.replaceChildren(make('h3','添加代码映射'),make('p',n.name+' · '+n.location.file));context(box);
      const f=make('select'),r=make('select');f.setAttribute('aria-label','目标功能');r.setAttribute('aria-label','代码角色');
      for(const x of doc.features){const o=make('option',x.title);o.value=x.id;f.append(o);}
      for(const [k,v] of Object.entries(roles)){const o=make('option',v);o.value=k;r.append(o);}box.append(f,r);
      const why=fields(box,'关联理由','',true);
      box.append(make('p','此入口保存声明证据；关系证据可通过 CLI 显式添加，不会自动拉入全部调用。'),button('添加为待审提案',()=>{
        const id=freshId('mapping');if(edit({op:'mapping',id,featureId:f.value,nodeId:n.id,role:r.value,rationale:why.value,relationIds:[]}))showMapping(id);
      },'detail-link'));
    },'detail-link'));
  }
  $('feature-new').onclick=()=>featureForm(null);
  $('feature-export').onclick=()=>{
    const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=make('a');
    a.href=url;a.download='features-r'+doc.revision+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    notice('已请求导出 JSON；请保存下载文件。页面不会写入仓库，也不会更新原 HTML。');
  };
  $('feature-import').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;const previous=doc;
    try {
      if(file.size>5*1024*1024)throw new Error('标注文件超过 5 MiB');
      const next=api.validate(JSON.parse(await file.text()));
      if(doc!==previous)throw new Error('导入期间发生编辑，请重试，当前草稿未覆盖。');
      if(dirty&&!confirm('导入将替换未保存的内存草稿，继续？'))return;
      const checked=api.assess(graph,next);doc=next;report=checked;dirty=false;selected=null;refresh();showOverview();
      $('feature-mappings').replaceChildren();$('feature-selected').textContent='选择功能审阅关联';
      notice(checked.summary.stale?'已导入，但部分映射失效；没有自动重绑定。':'标注已载入内存，原文件未修改。');
    }catch(error){notice('导入失败：'+error.message);}finally{event.target.value='';}
  };
  const migrationView=createFeatureMigrationView({graph,api:migrationApi,getDocument:()=>doc,make,button,fields,context,notice,
    editContext:()=>({expectedRevision:doc.revision,actor,actorKind:'manual',reason,at:new Date().toISOString()}),
    onApplied:next=>{doc=next;report=api.assess(graph,doc);dirty=true;selected=null;refresh();showOverview();
      $('feature-mappings').replaceChildren();$('feature-selected').textContent='选择功能审阅迁移结果';}});
  return {enter,leave,renderList,decorateNode,backButton,get active(){return active;}};
}
