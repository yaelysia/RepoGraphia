/** UI adapter only; all grouping, filtering, counting and paging live in ProjectMap. */
function createProjectMapView({ graph, api, make, button, svgEl, onFile, onEvidence, onNavigation, onInspect = () => {}, onEnter = () => {} }) {
  const $ = id => document.getElementById(id), data = api.index(graph);
  const labels = { all:'全部关联', internal:'组内关系', between:'跨子级关系', outside:'当前目录外',
    targetless:'无可导航目标', missing:'缺失端点', hiddenTargets:'目标含隐藏测试' };
  const states = { bound:'静态绑定', candidate:'候选', unresolved:'未解析', external:'外部边界' };
  const kinds = { call:'调用',construct:'构造',tag:'模板调用',import:'导入',reexport:'再导出',callback:'回调传入',jsx:'JSX 引用',extends:'继承',implements:'实现声明' };
  let active = false, scope = '', current, inventory, focus = null, selection = {}, offset = 0, nodeBudget = 12, linkBudget = 24, linkPage = 30;
  let detailMode = 'overview', lastEvidence = null, filterKey = '', scale = 1, graphHeight = 560, positions = new Map(), drag = null;
  let viewPosition = { left: 0, top: 0 };
  let readingPosition = { detail:0, inspector:0, links:0, boundary:false, detailBoundary:false };
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), panel = $('project-view'), svg = $('project-map');
  const nav = make('div', null, 'project-workbench-nav'), parent = button('← 上一层', () => enter(scope.split('/').slice(0,-1).join('/')), 'project-tool');
  parent.id = 'project-parent'; $('project-breadcrumb').before(nav); nav.append(parent, $('project-breadcrumb'));
  const frame = make('div', null, 'project-canvas-frame'), viewport = make('div', null, 'project-viewport');
  viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', '项目代码关系画布，可拖动或滚动查看');
  svg.before(frame); frame.append(viewport); viewport.append(svg);
  const toolbar = make('div', null, 'project-canvas-toolbar'), controls = make('div', null, 'project-canvas-controls');
  const zoomOut = button('−', () => setScale(scale / 1.16)), zoomIn = button('+', () => setScale(scale * 1.16));
  const zoomLabel = button('100%', () => setScale(1)), fit = button('适应', () => setScale(Math.min(1, (viewport.clientWidth-32)/1000, (viewport.clientHeight-32)/graphHeight)));
  zoomOut.id = 'project-zoom-out'; zoomIn.id = 'project-zoom-in'; zoomLabel.id = 'project-zoom-label'; fit.id = 'project-fit';
  zoomOut.setAttribute('aria-label', '缩小项目地图'); zoomIn.setAttribute('aria-label', '放大项目地图'); zoomLabel.setAttribute('aria-label', '恢复项目地图至 100% 可读大小');
  controls.append(zoomOut, zoomLabel, zoomIn, fit); toolbar.append(make('span', '箭头表示原始代码关系 · 不代表执行顺序'), controls); frame.append(toolbar);
  panel.querySelector('.map-note').textContent = '点击节点查看说明，进入目录逐层深入。拖动或滚动画布 · Ctrl + 滚轮缩放 · 虚线保留候选或混合状态。';
  const options = () => ({ scope, showTests: $('show-tests').checked,
    kinds: $('kind').value === 'all' ? undefined : $('kind').value === 'call' ? ['call','construct','tag'] :
      $('kind').value === 'import' ? ['import','reexport'] : [$('kind').value],
    statuses: $('status').value === 'all' ? undefined : [$('status').value] });
  const truncate = (s, limit=26) => {
    let width=0, result=''; for(const c of s) { width += c.codePointAt(0) > 255 ? 2 : 1; if(width>limit)return result+'…'; result+=c; } return result;
  };
  const info = b => `${kinds[b.kind]}${b.typeOnly ? '（仅类型）' : ''} · ${states[b.status]} ${b.count}`;
  function stopMotion() { for(const animation of svg.getAnimations({subtree:true}))animation.cancel(); }
  function animate(target, frames, duration) {
    if(motion.matches || !target)return;
    for(const animation of target.getAnimations())animation.cancel();
    target.animate(frames, {duration, easing:'cubic-bezier(.2,0,.2,1)'});
  }
  function rememberViewport() { if(active && !panel.hidden)viewPosition={left:viewport.scrollLeft,top:viewport.scrollTop}; }
  function rememberReading() {
    if(!active || panel.hidden)return;
    readingPosition={detail:$('detail').scrollTop,inspector:document.querySelector('.inspector').scrollTop,links:$('project-links').scrollTop,
      boundary:Boolean($('project-summary').querySelector('.project-boundary')?.open),detailBoundary:Boolean($('detail').querySelector('.project-inspector-fold')?.open)};
  }
  function restoreReading() {
    const boundary=$('project-summary').querySelector('.project-boundary'),detailBoundary=$('detail').querySelector('.project-inspector-fold');
    if(boundary)boundary.open=readingPosition.boundary;if(detailBoundary)detailBoundary.open=readingPosition.detailBoundary;
    $('detail').scrollTop=readingPosition.detail;document.querySelector('.inspector').scrollTop=readingPosition.inspector;$('project-links').scrollTop=readingPosition.links;
  }
  function applyScale() { svg.style.width=1000*scale+'px';svg.style.height=graphHeight*scale+'px';zoomLabel.textContent=Math.round(scale*100)+'%';viewport.dataset.scale=String(scale); }
  function setScale(next, point) {
    const x=point?.[0]??viewport.clientWidth/2, y=point?.[1]??viewport.clientHeight/2;
    const center={x:(viewport.scrollLeft+x)/scale,y:(viewport.scrollTop+y)/scale};
    scale=Math.max(.28,Math.min(1.8,next));applyScale();
    viewport.scrollLeft=center.x*scale-x;viewport.scrollTop=center.y*scale-y;rememberViewport();
  }
  function stopDrag() {
    if(drag && viewport.hasPointerCapture(drag.id))viewport.releasePointerCapture(drag.id);
    drag=null;viewport.dataset.dragging='false';
  }
  // Mode restoration is deliberately distinct from navigating to a directory.
  function enter(next) {
    const navigating=arguments.length>0, previous=scope;
    const keyboardNavigation=navigating && document.activeElement?.matches(':focus-visible') && document.activeElement.closest('.project-enter,.project-drill,#project-parent,#project-breadcrumb');
    if(navigating) {
      scope=next;focus=null;selection={};offset=0;nodeBudget=12;linkBudget=24;linkPage=30;detailMode='overview';lastEvidence=null;scale=1;
      readingPosition={detail:0,inspector:0,links:0,boundary:false,detailBoundary:false};
      $('search').value='';
    }
    refresh({resetViewport:navigating || !current});
    if(navigating) { onEnter();document.querySelector('.map-panel').scrollTop=0;if(keyboardNavigation)viewport.focus({preventScroll:true}); }
    if(navigating && previous!==scope) {
      const returning=previous && (!scope || previous.startsWith(scope+'/'));
      animate(svg,[{opacity:.18,transform:`translateX(${returning?-48:48}px) scale(${returning?1.05:.95})`},{opacity:1,transform:'translateX(0) scale(1)'}],460);
    }
  }
  function leave() { rememberViewport();rememberReading();stopMotion();stopDrag();active=false;panel.hidden=true;$('local-view').hidden=false;$('return-project').hidden=false; }
  function refresh({resetViewport=false}={}) {
    rememberViewport();if(!resetViewport)rememberReading();stopMotion();stopDrag();
    active=true;panel.hidden=false;$('local-view').hidden=true;$('return-project').hidden=true;
    const nextFilterKey=JSON.stringify(options());
    if(filterKey && filterKey!==nextFilterKey) { offset=0;readingPosition.detail=0;readingPosition.inspector=0;if(detailMode==='evidence')detailMode='records'; }
    filterKey=nextFilterKey;
    current = api.project(data,{...options(),maxNodes:nodeBudget,maxLinks:linkBudget});
    inventory = api.project(data,{...options(),maxNodes:1000,maxLinks:5000});
    if(focus && !inventory.groups.some(g=>g.path===focus))focus=null;
    if(selection.group && !inventory.groups.some(g=>g.path===selection.group)) { selection={};offset=0;detailMode='overview';lastEvidence=null; }
    $('map-title').textContent = scope || '项目全局结构';
    parent.disabled=!scope;
    const crumbs=$('project-breadcrumb'), root=button('项目根目录',()=>enter(''));crumbs.replaceChildren(root);
    if(!scope)root.setAttribute('aria-current','page');
    let path=''; for(const part of scope.split('/').filter(Boolean)) { path += (path ? '/' : '')+part; const next=path;
      const crumb=button(part,()=>enter(next));if(path===scope)crumb.setAttribute('aria-current','page');crumbs.append(make('span','›'),crumb); }
    renderSummary();renderGraph();renderLinks();
    if(detailMode==='evidence' && lastEvidence)openEvidence(lastEvidence,false);
    else if(detailMode==='records')showRecords(selection,offset,false);
    else showOverview();
    onNavigation();
    if(resetViewport) {
      const first=positions.values().next().value;
      viewPosition={left:first?Math.max(0,first.x-viewport.clientWidth/2):0,top:0};
    }
    viewport.scrollLeft=viewPosition.left;viewport.scrollTop=viewPosition.top;
    restoreReading();
  }
  function renderSummary() {
    const {summary:s,boundary:b} = current, box=$('project-summary');box.replaceChildren();
    box.dataset.scope=scope;box.dataset.relations=String(s.relations);
    const head=make('div',null,'project-scope-stats');
    head.append(make('strong',`${s.groups} 个子级`),make('span',`${s.indexedFiles} 个索引文件`),make('span',`${s.unindexedFiles} 个未索引文件`,s.unindexedFiles?'project-unindexed-count':''));
    const filters=make('div',null,'project-counts'), boundary=make('details',null,'project-boundary'), remaining=make('div',null,'project-counts');
    boundary.append(make('summary',`分析边界与其余关系 · 已隐藏 ${b.hiddenFiles} 个测试文件`));
    for(const key of ['all','internal','between','outside','targetless','missing','hiddenTargets']) {
      const count = key === 'all' ? s.relations : s.counts[key];
      if(count || key==='all') {
        const countButton=button(`${labels[key]} ${count}`,()=>showRecords({category:key}), 'project-count');countButton.dataset.category=key;
        (['all','internal','between'].includes(key)?filters:remaining).append(countButton);
      }
    }
    boundary.append(remaining,make('p',`项目总数含测试；本层按真实目录分组，非功能推断。已隐藏 ${b.hiddenFiles} 个测试文件、${b.hiddenTestRelations} 条测试相关记录；类型/状态筛选排除 ${b.filteredRelations} 条。`, 'meta'));
    box.append(head,filters,boundary);
    $('project-budget').textContent=`画布 ${current.groups.length}/${s.groups} 个节点 · ${current.links.length}/${s.links} 条聚合连接。${b.truncated ? '已截断：其余可从导航树和下方列表继续审阅。' : '当前层级未因画布预算截断。'}`;
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
  function choose(g) {
    const keyboardFocus=document.activeElement?.classList.contains('project-node');
    focus=g.path;stopMotion();renderGraph();showRecords({group:g.path});onNavigation();
    const selected=[...svg.querySelectorAll('.project-node')].find(node=>node.dataset.path===g.path);
    if(keyboardFocus)selected?.focus({preventScroll:true});
    animate(selected,[{transform:'scale(.95)',opacity:.65},{transform:'scale(1.035)',opacity:1,offset:.55},{transform:'scale(1)',opacity:1}],380);
  }
  function renderGraph() {
    svg.replaceChildren();const groups=current.groups,n=groups.length;
    const height=n<=6?560:Math.ceil(n/3)*188+80;graphHeight=height;svg.setAttribute('viewBox',`0 0 1000 ${height}`);applyScale();
    svg.setAttribute('aria-label',`${scope||'项目根目录'}，${groups.length} 个代码位置节点`);
    positions=new Map(groups.map((g,i)=>[g.path, n===1 ? {x:500,y:height/2-30} : n===2 ? {x:220+i*560,y:height/2-30} : n<=6 ? {
      x:500+Math.cos(-Math.PI/2+2*Math.PI*i/Math.max(n,1))*335,
      y:height/2-20+Math.sin(-Math.PI/2+2*Math.PI*i/Math.max(n,1))*(height/2-100),
    } : {x:170+(i%3)*330,y:100+Math.floor(i/3)*188}]));
    const defs=svgEl('defs');
    for(const name of ['bound','candidate','mixed']) {
      const m=svgEl('marker',{id:'project-arrow-'+name,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto'});
      m.append(svgEl('path',{d:'M0 0 L10 5 L0 10 z',class:'project-arrow-'+name}));defs.append(m);
    }svg.append(defs);
    const endpoint=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.min(123/Math.max(Math.abs(dx),.001),35/Math.max(Math.abs(dy),.001));return{x:a.x+dx*t,y:a.y+dy*t};};
    for(const link of current.links) {
      const a=positions.get(link.from),b=positions.get(link.to),start=endpoint(a,b),end=endpoint(b,a);
      const dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy)||1;
      const cx=(start.x+end.x)/2-dy/len*32,cy=(start.y+end.y)/2+dx/len*32;
      const d=`M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`;
      const statuses=new Set(link.breakdown.map(b=>b.status));const state=statuses.size>1?'mixed':statuses.has('candidate')?'candidate':'bound';
      const bright=!focus||focus===link.from||focus===link.to;
      const group=svgEl('g',{class:'project-connection '+state+(bright?'':' dim'),tabindex:0,role:'button','aria-label':`${link.from} → ${link.to}，${link.count} 条记录`});
      group.dataset.from=link.from;group.dataset.to=link.to;
      group.append(svgEl('path',{d,class:'project-relation-line','marker-end':'url(#project-arrow-'+state+')'}),
        svgEl('path',{d,class:'edge-hit'}),svgEl('title',{},link.breakdown.map(info).join('\n')));
      if(bright){const tx=(start.x+2*cx+end.x)/4,ty=(start.y+2*cy+end.y)/4;
        const width=Math.max(32,String(link.count).length*8+16);
        group.append(svgEl('rect',{x:tx-width/2,y:ty-12,width,height:24,rx:12,class:'project-relation-badge'}),svgEl('text',{x:tx,y:ty+4,'text-anchor':'middle',class:'project-relation-count'},link.count));}
      const open=()=>showRecords({from:link.from,to:link.to});group.onclick=open;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};svg.append(group);
    }
    for(const g of groups) {
      const p=positions.get(g.path),selected=focus===g.path;
      const group=svgEl('g',{class:'project-node '+g.kind+(selected?' selected':'')+(g.indexedFiles?'':' unindexed'),tabindex:0,role:'button','aria-pressed':String(selected),'aria-label':`${g.path}，${g.kind==='directory'?'目录':'文件'}，${g.counts.all} 条关联，查看说明`});group.dataset.path=g.path;
      group.append(svgEl('text',{x:p.x,y:p.y-49,'text-anchor':'middle',class:'project-node-kind'},`${g.kind==='directory'?'目录':'文件'} · ${g.counts.all} 条关联`),
        svgEl('rect',{x:p.x-120,y:p.y-32,width:240,height:64,rx:32,class:'project-node-face'}),
        svgEl('text',{x:p.x,y:p.y+6,'text-anchor':'middle',class:'project-node-title'},truncate(g.name)),
        svgEl('text',{x:p.x,y:p.y+54,'text-anchor':'middle',class:'project-node-meta'},`${g.indexedFiles} 个已索引文件 · ${g.unindexedFiles} 个未索引文件`),svgEl('title',{},g.path));
      const open=()=>choose(g);group.onclick=open;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};svg.append(group);
      const available=g.kind==='directory'||Boolean(g.nodeId), action=svgEl('g',{class:'project-enter'+(available?'':' disabled'),tabindex:available?0:-1,role:'button','aria-disabled':String(!available),'aria-label':`${g.kind==='directory'?'进入目录':'查看文件与函数'} ${g.path}`});
      action.dataset.path=g.path;
      action.append(svgEl('rect',{x:p.x-61,y:p.y+66,width:122,height:30,rx:15}),svgEl('text',{x:p.x,y:p.y+86,'text-anchor':'middle'},available?(g.kind==='directory'?'进入目录 →':'查看代码 →'):'未索引实现'));
      const drill=()=>{if(available){if(g.kind==='directory')enter(g.path);else {focus=g.path;selection={group:g.path};offset=0;detailMode='records';lastEvidence=null;onFile(g.nodeId);}}};
      action.onclick=drill;action.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();drill();}};svg.append(action);
    }
    if(!n)svg.append(svgEl('text',{x:500,y:250,'text-anchor':'middle',class:'project-empty'},'此范围没有可显示的记录路径；请检查测试筛选与分析边界。'));
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
    detailMode='overview';const detail=$('detail');detail.replaceChildren();
    detail.append(make('span',scope?'当前目录':'项目代码地图','eyebrow'),make('h3',scope||'从一个节点开始'),
      make('p','按真实代码位置逐层浏览。先选择一个目录或文件，再决定继续深入，或查看它与其他代码的关系。'),
      make('h4','当前范围'),make('p',`${current.summary.indexedFiles} 个索引文件，${current.summary.unindexedFiles} 个未索引文件。`));
    const steps=make('ol',null,'project-reading-steps');
    for(const [title,text]of [['点击节点','在这里阅读范围、关联和分析边界。'],['进入下一层','目录可以继续展开，直到具体文件与代码实体。'],['打开一条连线','查看对应的原始记录和源码依据。']]) {
      const step=make('li');step.append(make('strong',title),make('span',text));steps.append(step);
    }
    detail.append(steps,button('查看当前范围的全部关联 →',()=>showRecords({category:'all'}),'detail-link'));
    const boundary=make('details',null,'project-inspector-fold');boundary.append(make('summary','无连线时，哪些关系仍然保留？'),
      make('p','无连线不等于无关联：组内关系、未解析目标、外部声明和当前范围外的关系保留在画布上方计数中。虚线节点表示没有已索引实现。','callout'));detail.append(boundary);
  }
  function showRecords(next = selection, nextOffset = 0, inspect = true) {
    selection=next;offset=nextOffset;detailMode='records';lastEvidence=null;const detail=$('detail');detail.replaceChildren();
    const g=next.group?inventory.groups.find(g=>g.path===next.group):null;
    const title=g?g.path:next.from?`${next.from} → ${next.to}`:scope||'项目全局结构';
    detail.append(make('span',g?(g.kind==='directory'?'目录说明':'文件说明'):next.from?'代码关系':'当前范围的关系','eyebrow'),make('h3',g?g.name:title));
    if(g)detail.append(make('p',g.path,'meta project-detail-path'));
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
    const boundary=make('details',null,'project-inspector-fold');boundary.append(make('summary','关系计数与分析边界'),
      make('p','目录名仅表示代码位置。计数按原始关系 ID 去重；多目标关系可出现在多个组或类别中，不能直接相加。候选和类型关系不代表运行时调用。','callout'),make('p','目录投影版本 '+api.revision,'meta'));detail.append(boundary);
    let result=api.records(data,options(),next,{offset,limit:25});
    if(offset && offset>=result.total) { offset=Math.max(0,Math.floor((result.total-1)/25)*25);result=api.records(data,options(),next,{offset,limit:25}); }
    detail.append(make('h4',`${labels[next.category||'all']} · ${result.total} 条`));
    const page=make('p',result.total?`第 ${Math.min(offset+1,result.total)}–${Math.min(offset+25,result.total)} 条 / ${result.total}`:'没有匹配记录；不代表运行时没有关联。','meta project-page');detail.append(page);
    const byId=new Map(graph.nodes.map(n=>[n.id,n]));
    for(const edge of result.relations) {
      const row=button('',()=>openEvidence(edge),'detail-link project-evidence');row.dataset.relation=edge.id;
      row.append(make('strong',`${byId.get(edge.from)?.name||edge.from} → ${edge.targetLabel}`),make('small',`${kinds[edge.kind]}${edge.typeOnly?' · 仅类型':''} · ${states[edge.status]} · ${edge.evidence.location.file}:${edge.evidence.location.line}`));detail.append(row);
    }
    const pager=make('div',null,'project-counts');
    if(offset) pager.append(button('上一页',()=>showRecords(next,Math.max(0,offset-25)),'project-prev'));
    if(result.nextOffset!==null)pager.append(button('下一页',()=>showRecords(next,result.nextOffset),'project-next'));detail.append(pager);
    if(inspect) { onInspect();$('detail').scrollTop=0;document.querySelector('.inspector').scrollTop=0; }
  }
  function openEvidence(edge, inspect=true) { detailMode='evidence';lastEvidence=edge;if(inspect){onEvidence(edge);onInspect();}else onEvidence(edge,{restore:true}); }
  viewport.addEventListener('scroll',rememberViewport,{passive:true});
  viewport.addEventListener('pointerdown',event=>{
    if(event.button!==0 || event.pointerType==='touch' || event.target.closest('.project-node,.project-enter,.project-connection'))return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    viewport.setPointerCapture(event.pointerId);viewport.dataset.dragging='true';event.preventDefault();
  });
  viewport.addEventListener('pointermove',event=>{
    if(!drag || event.pointerId!==drag.id)return;
    viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(type,stopDrag);
  viewport.addEventListener('wheel',event=>{
    if(!event.ctrlKey && !event.metaKey)return;event.preventDefault();
    const rect=viewport.getBoundingClientRect();setScale(scale*Math.exp(-event.deltaY*.002),[event.clientX-rect.left,event.clientY-rect.top]);
  },{passive:false});
  motion.addEventListener('change',()=>{if(motion.matches)stopMotion();});
  $('project-expand').onclick=()=>{nodeBudget=Math.min(60,nodeBudget+12);linkBudget=Math.min(240,linkBudget+24);refresh();};
  $('project-more-links').onclick=()=>{linkPage+=30;renderLinks();};
  return { enter, leave, refresh, renderList, get active(){return active;},
    backButton:()=>button('← 返回聚合关系',()=>showRecords(selection,offset),'detail-link project-back') };
}
