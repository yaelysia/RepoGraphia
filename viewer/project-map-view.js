/** UI adapter only; all grouping, filtering, counting and paging live in ProjectMap. */
function createProjectMapView({ graph, api, make, button, svgEl, onFile, onEvidence, onNavigation }) {
  const $ = id => document.getElementById(id), data = api.index(graph);
  const labels = { all:'全部关联', internal:'组内关系', between:'跨子级关系', outside:'当前目录外',
    targetless:'无可导航目标', missing:'缺失端点', hiddenTargets:'目标含隐藏测试' };
  const states = { bound:'静态绑定', candidate:'候选', unresolved:'未解析', external:'外部边界' };
  const kinds = { call:'调用',construct:'构造',tag:'模板调用',import:'导入',reexport:'再导出',callback:'回调传入',jsx:'JSX 引用',extends:'继承',implements:'实现声明' };
  let active = false, scope = '', current, inventory, focus = null, selection = {}, offset = 0, nodeBudget = 12, linkBudget = 24, linkPage = 30;
  const options = () => ({ scope, showTests: $('show-tests').checked,
    kinds: $('kind').value === 'all' ? undefined : $('kind').value === 'call' ? ['call','construct','tag'] :
      $('kind').value === 'import' ? ['import','reexport'] : [$('kind').value],
    statuses: $('status').value === 'all' ? undefined : [$('status').value] });
  const truncate = (s,n=27) => s.length > n ? s.slice(0,n-1)+'…' : s;
  const info = b => `${kinds[b.kind]}${b.typeOnly ? '（仅类型）' : ''} · ${states[b.status]} ${b.count}`;
  function enter(next = scope) {
    scope = next; active = true; focus = null; selection = {}; offset = 0; nodeBudget = 12; linkBudget = 24; linkPage = 30;
    $('search').value = ''; refresh();
  }
  function leave() { active = false; $('project-view').hidden = true; $('local-view').hidden = false; $('return-project').hidden = false; }
  function refresh() {
    active = true; $('project-view').hidden = false; $('local-view').hidden = true; $('return-project').hidden = true;
    current = api.project(data,{...options(),maxNodes:nodeBudget,maxLinks:linkBudget});
    inventory = api.project(data,{...options(),maxNodes:1000,maxLinks:5000});
    if (focus && !inventory.groups.some(g=>g.path===focus)) focus = null;
    selection = {}; offset = 0;
    $('map-title').textContent = scope || '项目全局结构';
    const crumbs = $('project-breadcrumb'); crumbs.replaceChildren(button('项目根目录',()=>enter('')));
    let path=''; for(const part of scope.split('/').filter(Boolean)) { path += (path ? '/' : '')+part; const next=path;
      crumbs.append(make('span','/'),button(part,()=>enter(next))); }
    renderSummary(); renderGraph(); renderLinks(); showOverview(); onNavigation();
  }
  function renderSummary() {
    const {summary:s,boundary:b} = current, box=$('project-summary');box.replaceChildren();
    box.dataset.scope=scope;box.dataset.relations=String(s.relations);
    box.append(make('strong',`${s.groups} 个子级 · ${s.indexedFiles} 个索引文件 · ${s.unindexedFiles} 个未索引文件`));
    const filters=make('div',null,'project-counts');
    for(const key of ['all','internal','between','outside','targetless','missing','hiddenTargets']) {
      const count = key === 'all' ? s.relations : s.counts[key];
      if(count || key==='all') {const b=button(`${labels[key]} ${count}`,()=>showRecords({category:key}), 'project-count');b.dataset.category=key;filters.append(b);}
    }
    box.append(filters,make('p',`顶部总数含测试；本层按真实目录分组，非功能推断。已隐藏 ${b.hiddenFiles} 个测试文件、${b.hiddenTestRelations} 条测试相关记录；类型/状态筛选排除 ${b.filteredRelations} 条。`, 'meta'));
    $('project-budget').textContent=`画布 ${current.groups.length}/${s.groups} 个节点 · ${current.links.length}/${s.links} 条聚合连接。${b.truncated ? '已截断：其余可从左侧和下方列表继续审阅。' : '当前层级未因画布预算截断。'}`;
    $('project-expand').hidden=!b.truncated || nodeBudget>=60 && linkBudget>=240;
  }
  function renderList(search, page) {
    const list=$('node-list');list.replaceChildren();
    const matches=inventory.groups.filter(g=>g.path.toLowerCase().includes(search.toLowerCase()));
    $('list-count').textContent=matches.length; $('more').hidden=matches.length<=page;
    for(const g of matches.slice(0,page)) {
      const row=button('',()=>choose(g), 'project-row node-row'+(focus===g.path?' active':''));row.dataset.path=g.path;row.title=g.path;
      row.append(make('strong',(g.kind==='directory'?'▸ ':'')+g.name),make('small',`${g.indexedFiles} 索引 · ${g.unindexedFiles} 未索引 · ${g.symbols} 实体`));list.append(row);
    }
    if(!matches.length) list.append(make('p','当前目录下没有匹配的已记录路径。可切换“文件”进行全项目搜索。'));
    if(inventory.boundary.omittedGroups) list.append(make('p',`导航也达到 1000 子级上限；${inventory.boundary.omittedGroups} 个未列出，可用文件搜索继续定位。`));
  }
  function choose(g) { focus=g.path;renderGraph();showRecords({group:g.path}); }
  function renderGraph() {
    const svg=$('project-map');svg.replaceChildren(); const groups=current.groups, n=groups.length;
    const height=Math.max(480,Math.ceil(n/3)*128+100);svg.setAttribute('viewBox',`0 0 1000 ${height}`);
    const positions=new Map(groups.map((g,i)=>[g.path, n===1 ? {x:500,y:height/2} : n===2 ? {x:220+i*560,y:height/2} : n<=6 ? {
      x:500+Math.cos(-Math.PI/2+2*Math.PI*i/Math.max(n,1))*335,
      y:height/2+Math.sin(-Math.PI/2+2*Math.PI*i/Math.max(n,1))*(height/2-70),
    } : {x:170+(i%3)*330,y:90+Math.floor(i/3)*128}]));
    const defs=svgEl('defs');
    for(const [name,color] of [['bound','#91b9fc'],['candidate','#dfb772'],['mixed','#b69bdb']]) {
      const m=svgEl('marker',{id:'project-arrow-'+name,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto'});
      m.append(svgEl('path',{d:'M0 0 L10 5 L0 10 z',fill:color}));defs.append(m);
    }svg.append(defs);
    const endpoint=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.min(122/Math.max(Math.abs(dx),.001),39/Math.max(Math.abs(dy),.001));return{x:a.x+dx*t,y:a.y+dy*t};};
    for(const link of current.links) {
      const a=positions.get(link.from),b=positions.get(link.to),start=endpoint(a,b),end=endpoint(b,a);
      const dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy)||1;
      const cx=(start.x+end.x)/2-dy/len*32,cy=(start.y+end.y)/2+dx/len*32;
      const d=`M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`;
      const statuses=new Set(link.breakdown.map(b=>b.status));const state=statuses.size>1?'mixed':statuses.has('candidate')?'candidate':'bound';
      const bright=!focus||focus===link.from||focus===link.to;
      const group=svgEl('g',{class:'project-connection'+(bright?'':' dim'),tabindex:0,role:'button','aria-label':`${link.from} → ${link.to}，${link.count} 条记录`});
      group.dataset.from=link.from;group.dataset.to=link.to;
      group.append(svgEl('path',{d,fill:'none',stroke:state==='bound'?'#91b9fc':state==='candidate'?'#dfb772':'#b69bdb','stroke-width':bright?2:1,'stroke-dasharray':state==='bound'?'':'6 5','marker-end':'url(#project-arrow-'+state+')'}),
        svgEl('path',{d,class:'edge-hit'}),svgEl('title',{},link.breakdown.map(info).join('\n')));
      if(bright){const tx=(start.x+2*cx+end.x)/4,ty=(start.y+2*cy+end.y)/4;
        group.append(svgEl('rect',{x:tx-20,y:ty-11,width:40,height:20,rx:5,fill:'#111d2d'}),svgEl('text',{x:tx,y:ty+4,'text-anchor':'middle',fill:'#e3eaf5','font-size':12},link.count));}
      const open=()=>showRecords({from:link.from,to:link.to});group.onclick=open;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};svg.append(group);
    }
    for(const g of groups) {
      const p=positions.get(g.path),selected=focus===g.path;
      const group=svgEl('g',{class:'project-node',tabindex:0,role:'button','aria-label':g.path});group.dataset.path=g.path;
      group.append(svgEl('rect',{x:p.x-120,y:p.y-38,width:240,height:76,rx:12,fill:selected?'#213b57':g.indexedFiles?'#17283c':'#1d222c',stroke:selected?'#95d1ff':'#40546d','stroke-width':selected?2:1,'stroke-dasharray':g.indexedFiles?'':'5 4'}),
        svgEl('text',{x:p.x-103,y:p.y-13,fill:g.indexedFiles?'#8fbafa':'#a3aaba','font-size':10},g.kind==='directory'?'DIRECTORY':'FILE'),
        svgEl('text',{x:p.x-103,y:p.y+8,fill:'#edf3fc','font-size':16},truncate(g.name,23)),
        svgEl('text',{x:p.x-103,y:p.y+27,fill:'#a4b4ca','font-size':11},`${g.indexedFiles} 索引 · ${g.unindexedFiles} 未索引 · ${g.counts.all} 关联`),svgEl('title',{},g.path));
      const open=()=>choose(g);group.onclick=open;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};svg.append(group);
    }
    if(!n)svg.append(svgEl('text',{x:500,y:220,'text-anchor':'middle',fill:'#a4b4ca','font-size':18},'此范围没有可显示的记录路径；请检查测试筛选与分析边界。'));
  }
  function renderLinks() {
    const list=$('project-links');list.replaceChildren();
    $('project-link-count').textContent=`${inventory.summary.links} 条有向聚合连接`;
    for(const link of inventory.links.slice(0,linkPage)) {
      const row=button('',()=>showRecords({from:link.from,to:link.to}), 'project-link');row.dataset.from=link.from;row.dataset.to=link.to;row.dataset.count=String(link.count);
      row.append(make('strong',`${link.from} → ${link.to}`),make('span',`${link.count} 条原始关系`),make('small',link.breakdown.map(info).join(' / ')));list.append(row);
    }
    if(!inventory.links.length)list.append(make('p','此层级没有匹配的跨子级连线；内部和未解析关系仍可从上方计数审阅。'));
    $('project-more-links').hidden=linkPage>=inventory.links.length;
    if(inventory.boundary.omittedLinks)list.append(make('p',`列表达到 5000 条上限，仍有 ${inventory.boundary.omittedLinks} 条；请选择具体子级继续查询。`));
  }
  function showOverview() {
    const detail=$('detail');detail.replaceChildren();
    detail.append(make('span','DIRECTORY EXPLORER','eyebrow'),make('h3',scope||'先从整体开始'),
      make('p','选择图上的节点审阅关联，再进入目录，逐层定位到文件和函数。跨目录箭头可直接打开原始关系。'),
      make('h4','当前范围'),make('p',`${current.summary.indexedFiles} 个索引文件，${current.summary.unindexedFiles} 个未索引文件。`));
    for(const g of inventory.groups.slice(0,12)) detail.append(button(`${g.path} · ${g.symbols} 个实体`,()=>choose(g),'detail-link'));
    detail.append(make('p','无连线不等于无关联：组内关系、未解析目标、外部声明和当前范围外的关系保留在上方计数中。灰色虚线节点表示没有已索引实现。','callout'));
  }
  function showRecords(next = selection, nextOffset = 0) {
    selection=next;offset=nextOffset;const detail=$('detail');detail.replaceChildren();
    const g=next.group?inventory.groups.find(g=>g.path===next.group):null;
    const title=g?g.path:next.from?`${next.from} → ${next.to}`:scope||'项目全局结构';
    detail.append(make('span','PROJECT MAP / PROJECTION '+api.revision,'eyebrow'),make('h3',title));
    if(g) {
      const go=button(g.kind==='directory'?'进入目录 →':'查看文件与函数 →',()=>g.kind==='directory'?enter(g.path):onFile(g.nodeId),'detail-link project-drill');
      go.disabled=g.kind==='file'&&!g.nodeId;detail.append(go);
      detail.append(make('p',`${g.indexedFiles} 个索引文件，${g.unindexedFiles} 个未索引文件，${g.symbols} 个代码实体。`));
      if(g.unindexedFiles)detail.append(make('p','未索引原因：'+Object.entries(g.unindexedReasons).map(([r,n])=>`${r} × ${n}`).join('；'),'meta'));
      const cats=make('div',null,'project-counts');
      for(const [key,count] of Object.entries(g.counts)) if(count||key==='all')cats.append(button(`${labels[key]} ${count}`,()=>showRecords({group:g.path,category:key}), 'project-count'));
      detail.append(cats);
    }
    if(next.from){const link=inventory.links.find(l=>l.from===next.from&&l.to===next.to);if(link)detail.append(make('p',link.breakdown.map(info).join('；'),'meta'));}
    detail.append(make('p','目录名仅表示代码位置。计数按原始关系 ID 去重；多目标关系可出现在多个组或类别中，不能直接相加。候选和类型关系不代表运行时调用。','callout'));
    const result=api.records(data,options(),next,{offset,limit:25});
    detail.append(make('h4',`${labels[next.category||'all']} · ${result.total} 条`));
    const page=make('p',result.total?`第 ${Math.min(offset+1,result.total)}–${Math.min(offset+25,result.total)} 条 / ${result.total}`:'没有匹配记录；不代表运行时没有关联。','meta project-page');detail.append(page);
    const byId=new Map(graph.nodes.map(n=>[n.id,n]));
    for(const edge of result.relations) {
      const row=button('',()=>onEvidence(edge),'detail-link project-evidence');row.dataset.relation=edge.id;
      row.append(make('strong',`${byId.get(edge.from)?.name||edge.from} → ${edge.targetLabel}`),make('small',`${kinds[edge.kind]}${edge.typeOnly?' · 仅类型':''} · ${states[edge.status]} · ${edge.evidence.location.file}:${edge.evidence.location.line}`));detail.append(row);
    }
    const pager=make('div',null,'project-counts');
    if(offset) pager.append(button('上一页',()=>showRecords(next,Math.max(0,offset-25)),'project-prev'));
    if(result.nextOffset!==null)pager.append(button('下一页',()=>showRecords(next,result.nextOffset),'project-next'));detail.append(pager);
  }
  $('project-expand').onclick=()=>{nodeBudget=Math.min(60,nodeBudget+12);linkBudget=Math.min(240,linkBudget+24);refresh();};
  $('project-more-links').onclick=()=>{linkPage+=30;renderLinks();};
  return { enter, leave, refresh, renderList, get active(){return active;},
    backButton:()=>button('← 返回聚合关系',()=>showRecords(selection,offset),'detail-link project-back') };
}
