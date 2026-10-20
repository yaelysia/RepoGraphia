/** Two-phase, offline migration review. Neither uploaded graph nor original sidecar is overwritten. */
function createFeatureMigrationView({graph,api,getDocument,onApplied,make,button,fields,context,editContext,notice}) {
  const $=id=>document.getElementById(id),panel=$('feature-migration');
  const labels={reusable:'锚点可复用', 'needs-review':'需要重新审阅',unmatched:'无可匹配锚点'};
  const roleNames={entry:'入口',implementation:'实现',support:'支撑',test:'测试代码'};
  let oldGraph=null,plan=null,sourceDoc=null,choices=new Map(),page=0,preview=null;
  function hidePreview(){preview=null;const out=$('migration-preview');if(out)out.replaceChildren();}
  function close(){panel.hidden=true;for(const id of ['feature-cards','feature-selected','feature-mappings'])$(id).hidden=false;}
  function open(){
    panel.hidden=false;for(const id of ['feature-cards','feature-selected','feature-mappings'])$(id).hidden=true;
    panel.replaceChildren(make('h3','跨快照迁移 · 先预览，再确认'),
      make('p','导入这份标注最初对应的旧 graph.json，与当前报告中的新图对照。可复用仅指静态引用匹配，不证明业务行为未变。旧接受在迁移后退回待审，拒绝记录保留。','callout'));
    const input=make('input');input.type='file';input.accept='.json,application/json';input.id='migration-old-graph';input.setAttribute('aria-label','导入旧代码图');
    const label=make('label','旧 graph.json：');label.append(input);panel.append(label);
    const summary=make('p');summary.id='migration-summary';panel.append(summary);
    const rows=make('div');rows.id='migration-rows';panel.append(rows);
    const pager=make('div');pager.id='migration-pager';panel.append(pager);
    const result=make('div');result.id='migration-preview';panel.append(result);
    panel.append(button('预览选定迁移',prepare,'detail-link migration-prepare'),button('返回功能标注',close,'detail-link'));
    input.onchange=async event=>{
      const file=event.target.files[0],original=getDocument();if(!file)return;
      try{
        if(file.size>96*1024*1024)throw new Error('旧代码图超过 96 MiB 导入预算');
        const candidate=JSON.parse(await file.text());
        if(getDocument()!==original)throw new Error('读取期间标注已改变，未覆盖当前草稿，请重新导入。');
        const proposed=api.plan(candidate,graph,original);
        oldGraph=candidate;plan=proposed;sourceDoc=original;choices=new Map();page=0;hidePreview();render();
        notice('已生成只读迁移计划。默认全部暂缓，尚未更改标注。');
      }catch(error){notice('迁移计划失败：'+error.message);}finally{input.value='';}
    };
    // A former plan is reusable only while its source document is exactly the same in-memory draft.
    if(sourceDoc!==getDocument()){plan=null;oldGraph=null;choices=new Map();hidePreview();}
    render();
  }
  function render(){
    const rows=$('migration-rows');rows.replaceChildren();$('migration-pager').replaceChildren();
    if(!plan){$('migration-summary').textContent='等待导入旧代码图；不会根据同名函数重绑。';return;}
    const s=plan.summary;$('migration-summary').textContent=`${s.reusable} 条可复用 · ${s.needsReview} 条需审阅 · ${s.unmatched} 条无匹配；已选择 ${[...choices.values()].filter(a=>a.action!=='defer').length} 条。`;
    for(const row of plan.rows.slice(page*25,(page+1)*25)){
      const action=choices.get(row.id)?.action||'defer',b=button('',()=>inspect(row),'feature-mapping migration-row');b.dataset.mapping=row.id;b.dataset.status=row.status;
      b.append(make('strong',row.code.name),make('span',`${labels[row.status]} · ${action==='carry'?'复用锚点':action==='replace'?'显式替换':'暂缓迁移'}`),make('small',row.code.file));rows.append(b);
    }
    const previous=button('上一页',()=>{page--;render();}),next=button('下一页',()=>{page++;render();});previous.disabled=page===0;next.disabled=(page+1)*25>=plan.rows.length;
    $('migration-pager').append(previous,make('span',` ${page+1} / ${Math.max(1,Math.ceil(plan.rows.length/25))} · 每页25条 `),next);
  }
  function inspect(row){
    const box=$('detail');box.replaceChildren(make('h3',row.code.name),make('p',labels[row.status]),make('p',row.code.file,'meta'),
      make('p',row.reasons.length?row.reasons.join('；'):'实体、源码哈希与已记录静态邻域匹配；不是业务等价证明。','callout'));
    context(box);
    const choice=choices.get(row.id),select=make('select');select.setAttribute('aria-label','迁移动作');
    for(const [key,name] of [['defer','暂缓，保留旧证据'],['carry','复用精确锚点，退回待审'],['replace','手动指定新实体和证据']]){
      const opt=make('option',name);opt.value=key;opt.disabled=key==='carry'&&row.status!=='reusable';select.append(opt);
    }
    select.value=choice?.action||'defer';box.append(select);
    const replacement=make('div');box.append(replacement);
    const target=fields(replacement,'新实体准确 ID',choice?.nodeId||'');
    const search=fields(replacement,'搜索当前实体（需手动选择）');const results=make('div');replacement.append(results);
    search.oninput=()=>{
      const q=search.value.trim().toLowerCase();results.replaceChildren();if(!q)return;
      const matches=graph.nodes.filter(n=>`${n.name} ${n.location.file}`.toLowerCase().includes(q));
      for(const n of matches.slice(0,20))results.append(button(`${n.name} · ${n.location.file}:${n.location.line}`,()=>{target.value=n.id;},'detail-link migration-target'));
      if(matches.length>20)results.append(make('p',`仅列出20/${matches.length}个，请缩小搜索范围。`));
    };
    const original=sourceDoc.mappings.find(m=>m.id===row.id),role=make('select');role.setAttribute('aria-label','迁移后代码角色');
    for(const [key,name]of Object.entries(roleNames)){const opt=make('option',name);opt.value=key;role.append(opt);}role.value=choice?.role||original.role;replacement.append(role);
    const rationale=fields(replacement,'新关联理由',choice?.rationale||original.rationale,true),relations=fields(replacement,'新关系准确 ID（每行一个，可留空）',choice?.relationIds?.join('\n')||'',true);
    replacement.append(make('p','留空只保存声明证据，不自动带入旧关系或扩展调用链。'));
    const update=()=>{replacement.hidden=select.value!=='replace';};select.onchange=update;update();
    box.append(button('记录迁移选择',()=>{
      const action=select.value;
      choices.set(row.id,action==='replace'?{id:row.id,action,nodeId:target.value.trim(),role:role.value,rationale:rationale.value,relationIds:relations.value.split('\n').map(x=>x.trim()).filter(Boolean)}:{id:row.id,action});
      hidePreview();render();notice('选择已记录。请预览后再确认，标注尚未迁移。');
    },'detail-link migration-record'));
  }
  function prepare(){
    try{
      if(!plan||!oldGraph)throw new Error('先导入对应的旧代码图。');
      if(getDocument()!==sourceDoc)throw new Error('计划之后标注发生了编辑，请重新生成计划。');
      const {sourceRevision,from,to}=plan,request={sourceRevision,from,to,actions:[...choices.values()]};
      preview=api.apply(oldGraph,graph,sourceDoc,request,editContext());
      const migrated=preview.mappings.filter(m=>m.basis.snapshot===graph.project.snapshot).length,box=$('migration-preview');
      box.replaceChildren(make('h4','迁移预览（尚未生效）'),make('p',`${migrated} 条迁入当前快照；${preview.mappings.length-migrated} 条暂缓，保留旧快照并继续标为失效。`),
        make('p','输出升级为 FeatureMap schema 2。历史记录保留旧锚点与旧决定；迁入的旧接受退回待审，拒绝不自动撤销。'),
        button('确认迁移到内存草稿',()=>{
          if(!preview||sourceDoc!==getDocument()){hidePreview();notice('预览已过期，请重新生成计划。');return;}
          const result=preview;hidePreview();onApplied(result);close();plan=null;oldGraph=null;sourceDoc=null;
          notice('迁移已确认到内存草稿，尚未写入文件。请导出 JSON 保存；旧输入文件未修改。');
        },'detail-link migration-confirm'));
    }catch(error){hidePreview();notice('迁移预览失败：'+error.message);}
  }
  $('feature-migrate').onclick=open;
  return {open,close};
}
