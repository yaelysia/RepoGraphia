/** Offline function navigation. Only explicit parentId links become containment lines. */
function createFeatureWorkbenchView({graph, api, make, button, onSelect, onEnter, onCode, onParent, onMode, onJump, shell, referenceFor=()=>null}) {
  const $=id=>document.getElementById(id), panel=$('feature-view'), host=$('feature-cards');
  const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  const motion=matchMedia('(prefers-reduced-motion: reduce)'), cameras=new Map(), views=new Map();
  let report=null, hierarchy=null, scopeId=null, mode='features', selected=null, world=null, viewport=null, scene=null;
  let cameraFrame=0, cameraTarget=null, drag=null, size=null, searchLimit=12, origin=null, rootId=null;
  let nodes=new Map(), positions=new Map(), mappingIndex=new Map();
  const key=()=>scopeId, caption=f=>f.summary||f.description, compact=(text,limit)=>Array.from(text).length>limit?Array.from(text).slice(0,limit).join('')+'…':text;
  const view=()=>{if(!views.has(key()))views.set(key(),{expanded:new Set(),limits:new Map()});return views.get(key());};
  const limitFor=id=>view().limits.get(id)||12;
  const nav=make('nav',null,'feature-workbench-nav');nav.setAttribute('aria-label','功能图导航');
  const back=button('← 返回',()=>onParent(),'feature-tool');back.id='feature-parent';
  const crumbs=make('nav');crumbs.id='feature-breadcrumb';crumbs.setAttribute('aria-label','功能层级路径');nav.append(back,crumbs);
  const heading=make('div',null,'feature-workbench-heading'),titles=make('div',null,'feature-workbench-titles'),title=make('h2'),summary=make('p');title.id='feature-scope-title';summary.id='feature-scope-summary';titles.append(title,summary);
  const switches=make('div');switches.id='feature-map-mode';
  for(const [value,label]of [['features','子功能'],['code','关联代码']]){const b=button(label,()=>onMode(value));b.dataset.mode=value;switches.append(b);}
  heading.append(titles,switches);
  const files=make('details',null,'feature-document-tools');files.append(make('summary','标注与文件'),panel.querySelector('.feature-actions'));
  const about=make('details',null,'feature-about');about.append(make('summary','阅读范围与保存说明'),panel.querySelector('.callout'));
  panel.prepend(nav,heading);$('feature-summary').before(files);files.append($('feature-summary'),about);
  $('feature-selected').classList.add('feature-sr-only');
  const searchBox=make('div',null,'feature-search'),search=make('input'),results=make('div',null,'feature-search-results');
  search.id='feature-search';search.type='search';search.placeholder='搜索功能或说明…';search.setAttribute('aria-label','全局搜索功能名称和说明');search.setAttribute('aria-expanded','false');search.setAttribute('aria-controls','feature-search-results');
  results.id='feature-search-results';results.hidden=true;searchBox.hidden=true;searchBox.append(search,results);$('global-search').append(searchBox);
  function showDetails(){shell.showDetails();}
  function closeDetails(){shell.closeDetails();}
  function closeSearch(){results.hidden=true;search.setAttribute('aria-expanded','false');}
  function renderSearch(){
    results.replaceChildren();const query=search.value.trim().toLocaleLowerCase();if(!query||!report){closeSearch();return;}
    const words=query.split(/\s+/),matches=report.features.filter(f=>words.every(w=>`${f.title} ${f.summary||''} ${f.description} ${f.id}`.toLocaleLowerCase().includes(w)));
    results.append(make('small',`${matches.length} 个匹配功能`));
    for(const f of matches.slice(0,searchLimit)){
      const b=button('',()=>{closeSearch();onJump(f.id);},'feature-search-result');b.dataset.feature=f.id;
      b.append(make('strong',f.title),make('small',hierarchy.path(f.id).map(n=>n.title).join(' › ')));results.append(b);
    }
    if(matches.length>searchLimit)results.append(button('显示更多结果',()=>{searchLimit+=12;renderSearch();},'feature-search-more'));
    results.hidden=false;search.setAttribute('aria-expanded','true');
  }
  search.oninput=()=>{searchLimit=12;renderSearch();};search.onfocus=()=>{if(search.value.trim())renderSearch();};
  searchBox.addEventListener('keydown',event=>{
    const rows=[...results.querySelectorAll('.feature-search-result')];
    if(event.key==='Escape'){closeSearch();search.focus();event.preventDefault();event.stopPropagation();}
    else if(event.target===search&&rows.length&&['Enter','ArrowDown'].includes(event.key)){event.preventDefault();if(event.key==='Enter')rows[0].click();else rows[0].focus();}
    else if(rows.includes(event.target)&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();rows[(rows.indexOf(event.target)+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length].focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!searchBox.contains(event.target))closeSearch();});
  function cancelCamera(){if(cameraFrame)cancelAnimationFrame(cameraFrame);cameraFrame=0;cameraTarget=null;}
  function applyCamera(){
    const c=cameras.get(key());if(!world||!viewport||!c)return;
    world.style.transform=`translate(${c.x}px,${c.y}px) scale(${c.k})`;
    Object.assign(viewport.dataset,{x:String(c.x),y:String(c.y),scale:String(c.k)});$('feature-zoom-label').textContent=Math.round(c.k*100)+'%';
  }
  function cameraTo(next,duration=380){
    cancelCamera();const c=cameras.get(key());if(!c)return;
    if(motion.matches||!duration){Object.assign(c,next);applyCamera();return;}
    const from={...c},start=performance.now(),route=key();cameraTarget=next;
    const tick=now=>{if(route!==key()||!viewport?.isConnected){cancelCamera();return;}const t=Math.min(1,(now-start)/duration),e=1-Math.pow(1-t,3);for(const p of ['x','y','k'])c[p]=from[p]+(next[p]-from[p])*e;applyCamera();if(t<1)cameraFrame=requestAnimationFrame(tick);else{cameraFrame=0;cameraTarget=null;}};
    cameraFrame=requestAnimationFrame(tick);
  }
  function fit(explicit=true){
    if(!viewport||!size)return;const w=viewport.clientWidth,h=viewport.clientHeight;if(!w)return;
    // Normal reading starts at actual text size. Fit is a separate explicit overview.
    const k=explicit?Math.max(.28,Math.min(1,(w-44)/size.w,(h-80)/size.h)):1;
    const first=positions.get(hierarchy.children(scopeId)[0]?.id);
    const next={x:explicit?Math.max(18,(w-size.w*k)/2):size.w<=w-44?(w-size.w)/2:Math.min(18,w-(first?first.x+first.width:288)-24),
      y:explicit?Math.max(24,(h-55-size.h*k)/2):size.h<=h-44?(h-size.h)/2:24-(first?.y||0),k};
    if(!cameras.has(key()))cameras.set(key(),{...next,w,h});cameraTo(next,explicit?380:0);
  }
  function zoom(factor,point){
    if(!viewport)return;const c=cameras.get(key());if(!c)return;const x=point?.[0]??viewport.clientWidth/2,y=point?.[1]??viewport.clientHeight/2,k=Math.max(.28,Math.min(1.8,c.k*factor));
    cameraTo({x:x-(x-c.x)*k/c.k,y:y-(y-c.y)*k/c.k,k},point?0:260);
  }
  function locate(id,animated=true){
    if(!viewport||!world)return;const node=nodes.get(id)||(id===scopeId?origin:null),c=cameras.get(key());if(!node||!c)return;
    let {x,y,k}=c;const margin=20,l=node.offsetLeft*k+x,r=l+node.offsetWidth*k,t=node.offsetTop*k+y,b=t+node.offsetHeight*k;
    if(l<margin)x+=margin-l;else if(r>viewport.clientWidth-margin)x-=r-viewport.clientWidth+margin;
    if(t<margin)y+=margin-t;else if(b>viewport.clientHeight-50)y-=b-viewport.clientHeight+50;
    if(x!==c.x||y!==c.y)cameraTo({x,y,k},animated?380:0);
  }
  const observer=new ResizeObserver(()=>{if(!viewport?.clientWidth||!world)return;if(!size){renderCanvas();return;}const c=cameras.get(key());if(!c)fit(false);else if(c.w!==viewport.clientWidth||c.h!==viewport.clientHeight){cancelCamera();c.x+=(viewport.clientWidth-c.w)/2;c.y+=(viewport.clientHeight-c.h)/2;c.w=viewport.clientWidth;c.h=viewport.clientHeight;applyCamera();}});
  function animate(target,frames,duration=340,options={}){if(!target||motion.matches)return;for(const a of target.getAnimations())a.cancel();return target.animate(frames,{duration,easing:'cubic-bezier(.2,0,.2,1)',...options});}
  function stopTransitions(){
    for(const target of [scene,$('feature-mappings')])for(const a of target?.getAnimations({subtree:true})||[])a.cancel();
    for(const ghost of panel.querySelectorAll('.feature-motion-ghost'))ghost.remove();drag=null;
  }
  function capture(id){
    for(const ghost of panel.querySelectorAll('.feature-motion-ghost'))ghost.remove();
    if(motion.matches||mode!=='features'||!scene||!viewport)return null;
    const bounds=viewport.getBoundingClientRect(),node=[...world.querySelectorAll('.feature-node-wrap')].find(n=>n.dataset.feature===id),r=node?.getBoundingClientRect(),clone=scene.cloneNode(true),style=getComputedStyle(scene);
    clone.classList.add('feature-motion-ghost');clone.inert=true;clone.setAttribute('aria-hidden','true');clone.style.pointerEvents='none';
    return {clone,origin:r?`${Math.max(8,Math.min(92,(r.x+r.width/2-bounds.x)/bounds.width*100))}% ${Math.max(8,Math.min(92,(r.y+r.height/2-bounds.y)/bounds.height*100))}%`:'50% 40%',transform:style.transform,opacity:style.opacity};
  }
  function transition(returning,snapshot){
    if(motion.matches)return;const target=mode==='features'?scene:$('feature-mappings');if(!target)return;const direction=returning?-1:1;
    target.style.transformOrigin=snapshot?.origin||'50% 40%';
    if(snapshot&&mode==='features'&&viewport){const old=snapshot.clone;old.style.transformOrigin=snapshot.origin;viewport.append(old);const a=animate(old,[{opacity:snapshot.opacity,transform:snapshot.transform},{opacity:0,transform:`translateX(${-direction*32}px) scale(${returning ? .94 : 1.08})`}],330);a?.finished.then(()=>old.remove(),()=>old.remove());}
    animate(target,[{opacity:.15,transform:`translateX(${direction*56}px) scale(${returning?1.08:.92})`},{opacity:1,transform:'translateX(0) scale(1)'}],460);
  }
  function select(id,{locateNode=false}={}){
    const changed=selected!==id;selected=id;
    for(const b of host.querySelectorAll('.feature-card')){const active=b.dataset.feature===id;b.classList.toggle('selected',active);b.closest('.feature-node-wrap').classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));}
    if(changed){const b=[...host.querySelectorAll('.feature-card')].find(n=>n.dataset.feature===id),pill=b?.querySelector('strong');animate(pill,[{boxShadow:'0 0 0 1px var(--fm-accent)'},{boxShadow:'0 0 0 7px transparent'}],380);}
    updateSelectionLocation();if(locateNode)locate(id);showDetails();
  }
  function updateSelectionLocation(){
    const control=$('feature-locate-selected');if(!control)return;
    control.hidden=!selected||selected===scopeId||nodes.has(selected);
    control.textContent='定位已收起的选择';
    control.title=report.features.find(f=>f.id===selected)?.title||'';
  }
  function visibleFeatures(){
    const visible=[],state=view(),stack=[...hierarchy.children(scopeId).slice(0,limitFor(scopeId))].reverse();
    while(stack.length){
      const f=stack.pop();visible.push(f);
      if(state.expanded.has(f.id))stack.push(...[...hierarchy.children(f.id).slice(0,limitFor(f.id))].reverse());
    }
    return visible;
  }
  function reveal(id){
    if(!hierarchy)return;
    const path=hierarchy.path(id),start=scopeId?path.findIndex(f=>f.id===scopeId)+1:0;
    if(scopeId&&!start)return;
    for(let index=start;index<path.length;index++){
      const f=path[index],parent=f.parentId||null,siblings=hierarchy.children(parent),position=siblings.findIndex(item=>item.id===f.id);
      view().limits.set(parent,Math.max(limitFor(parent),Math.ceil((position+1)/12)*12));
      if(index<path.length-1)view().expanded.add(f.id);
    }
  }
  function toggle(id){
    const state=view(),open=!state.expanded.has(id);
    if(open)state.expanded.add(id);else state.expanded.delete(id);
    renderCanvas({anchor:id,focus:{id,action:'feature-branch-toggle'},animateChange:true});
    if(open){const first=hierarchy.children(id)[0];if(first)locate(first.id);}
  }
  function more(id){
    const previous=limitFor(id);view().limits.set(id,previous+12);
    renderCanvas({anchor:id===scopeId?rootId:id,focus:{id,action:'feature-branch-more'},animateChange:true});
    const first=hierarchy.children(id)[previous];if(first)locate(first.id);
  }
  function node(f){
    const outer=make('div',null,'feature-node-wrap'+(selected===f.id?' selected':''));outer.dataset.feature=f.id;
    const b=button('',()=>onSelect(f.id),'feature-card'+(selected===f.id?' selected':''));
    b.dataset.feature=f.id;b.setAttribute('aria-pressed',String(selected===f.id));b.setAttribute('aria-label','查看'+f.title+'的说明');b.title=f.title;
    const children=hierarchy.children(f.id),items=mappingIndex.get(f.id)||[],stale=items.filter(m=>!m.current).length;
    const references=items.map(item=>referenceFor(item.mapping.id)),checked=references.some(Boolean),pending=checked?references.filter(ref=>ref?.status!=='matched').length:stale;
    b.append(make('strong',f.title),make('span',compact(caption(f),88),'feature-node-summary'));
    const state=checked?(pending?' · '+pending+' 条需复核':' · 引用已核对'):(stale?' · '+stale+' 条失效':'');
    const stats=make('span',items.length+' 条代码关联'+state,'feature-node-stats');if(pending)stats.classList.add('feature-stale-text');b.append(stats);
    const actions=make('div',null,'feature-node-actions');
    if(children.length){
      const expanded=view().expanded.has(f.id),branch=button((expanded?'收起':'展开')+' · '+children.length,()=>toggle(f.id),'feature-branch-toggle');
      branch.dataset.feature=f.id;branch.setAttribute('aria-expanded',String(expanded));
      branch.setAttribute('aria-label',(expanded?'收起':'展开')+f.title+'的 '+children.length+' 个子功能');actions.append(branch);
    }else actions.append(make('span','暂无子功能','feature-leaf-note'));
    const enter=button(children.length?'聚焦 →':'查看实现',()=>onEnter(f.id),'feature-enter'),code=button('代码',()=>onCode(f.id),'feature-open-code');
    enter.dataset.feature=f.id;code.dataset.feature=f.id;code.setAttribute('aria-label','查看'+f.title+'的关联代码');actions.append(enter,code);outer.append(b,actions);
    if(view().expanded.has(f.id)&&children.length>limitFor(f.id)){
      const next=button('更多子功能 · 已显示 '+limitFor(f.id)+' / '+children.length,()=>more(f.id),'feature-branch-more');
      next.dataset.feature=f.id;outer.append(next);
    }
    outer.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      if(event.key==='ArrowRight'&&children.length&&!view().expanded.has(f.id))toggle(f.id);
      else if(event.key==='ArrowLeft'&&view().expanded.has(f.id))toggle(f.id);
      else if(event.key==='ArrowLeft'){locate(f.parentId);nodes.get(f.parentId)?.querySelector('.feature-card')?.focus({preventScroll:true});}
      else {const first=hierarchy.children(f.id)[0];if(first){locate(first.id);nodes.get(first.id)?.querySelector('.feature-card')?.focus({preventScroll:true});}}
    });
    return outer;
  }
  function drawHierarchy(features){
    // Only the visible projection consumes space. Collapsed, large subtrees do
    // not leave empty bands. IDs, sibling order and parentage remain untouched.
    const input=[{id:rootId,width:origin.offsetWidth,height:origin.offsetHeight}];
    for(const f of features){const n=nodes.get(f.id);input.push({id:f.id,parentId:f.parentId===scopeId||!f.parentId?rootId:f.parentId,width:n.offsetWidth,height:n.offsetHeight});}
    const layout=FeatureTree.layout(input,{gapX:64,gapY:28,padding:24});
    positions=new Map(layout.nodes.map(n=>[n.id,n]));
    for(const n of layout.nodes){const element=n.id===rootId?origin:nodes.get(n.id);element.style.left=n.x+'px';element.style.top=n.y+'px';element.style.width=n.width+'px';}
    size={w:layout.width,h:layout.height};world.style.width=size.w+'px';world.style.height=size.h+'px';
    const lines=world.querySelector('.feature-hierarchy-lines');
    for(const [k,v]of Object.entries({width:size.w,height:size.h,viewBox:'0 0 '+size.w+' '+size.h}))lines.setAttribute(k,v);
    for(const edge of layout.edges){
      const d=edge.points.map((point,index)=>(index?'L ':'M ')+point.join(' ')).join(' ');
      lines.append(svg('path',{class:'feature-containment-line',d,'data-parent':edge.parentId===rootId?scopeId||'':edge.parentId,'data-child':edge.childId}));
    }
  }
  function renderCanvas({anchor=null,focus=null,animateChange=false}={}){
    const previous=positions,previousCamera=cameras.has(key())?{...cameras.get(key())}:null;
    observer.disconnect();cancelCamera();stopTransitions();
    host.replaceChildren();nodes=new Map();positions=new Map();
    viewport=make('div',null,'feature-viewport');viewport.setAttribute('role','group');viewport.setAttribute('aria-label','功能包含树，可展开分支、拖动并缩放');
    scene=make('div',null,'feature-scene-layer');world=make('div',null,'feature-world');
    world.append(svg('svg',{class:'feature-hierarchy-lines','aria-hidden':'true'}));
    const current=report.features.find(f=>f.id===scopeId),children=hierarchy.children(scopeId);
    rootId='__repographia_reading_root__';const ids=new Set(report.features.map(f=>f.id));while(ids.has(rootId))rootId+='_';
    origin=make('div',null,'feature-parent-node');
    origin.append(make('span',current?'聚焦范围':'全部功能','feature-node-type'),make('strong',current?.title||graph.project.name),
      make('span',children.length+' 个'+(current?'直接子功能':'顶层功能'),'feature-node-summary'));
    if(children.length>limitFor(scopeId)){
      const next=button('显示更多功能 · '+limitFor(scopeId)+' / '+children.length,()=>more(scopeId),'feature-branch-more feature-hierarchy-more');
      next.dataset.feature=scopeId||'';origin.append(next);
    }
    world.append(origin);
    const features=visibleFeatures();for(const f of features){const element=node(f);nodes.set(f.id,element);world.append(element);}
    scene.append(world);viewport.append(scene);host.append(viewport);
    const toolbar=make('div',null,'feature-canvas-toolbar'),meaning=make('span','连线表示包含 · 不代表执行顺序'),controls=make('div',null,'feature-canvas-controls');
    const out=button('−',()=>zoom(1/1.16)),zin=button('+',()=>zoom(1.16)),fitButton=button('适应',()=>fit()),percent=make('span','100%');
    out.id='feature-zoom-out';zin.id='feature-zoom-in';fitButton.id='feature-fit';percent.id='feature-zoom-label';
    out.setAttribute('aria-label','缩小功能图');zin.setAttribute('aria-label','放大功能图');controls.append(out,percent,zin,fitButton);
    const locateSelection=button('定位已收起的选择',()=>{reveal(selected);renderCanvas();locate(selected);nodes.get(selected)?.querySelector('.feature-card')?.focus({preventScroll:true});},'feature-selection-location');locateSelection.id='feature-locate-selected';
    toolbar.append(meaning,locateSelection,controls);host.append(toolbar,make('p','展开查看已有子功能 · 聚焦后可返回原位置 · 拖动画布移动','feature-canvas-note'));
    if(!children.length)host.append(make('p',current?'尚未标注子功能，不表示分析已经完成。可查看关联代码，或继续准备分析任务。':'尚未添加功能。可新建功能或导入标注 JSON。','feature-empty-state'));
    // Workspace panes can hide this iframe while a save/reference refresh arrives.
    // Measure only a visible canvas; ResizeObserver resumes the same view later.
    if(!viewport.clientWidth||!origin.offsetWidth){size=null;observer.observe(viewport);updateSelectionLocation();return;}
    drawHierarchy(features);
    const camera=cameras.get(key());
    if(camera){
      camera.x+=(viewport.clientWidth-camera.w)/2;camera.y+=(viewport.clientHeight-camera.h)/2;camera.w=viewport.clientWidth;camera.h=viewport.clientHeight;
      const before=previous.get(anchor),after=positions.get(anchor);
      if(before&&after){camera.x+=(before.x-after.x)*camera.k;camera.y+=(before.y-after.y)*camera.k;}
      applyCamera();
    }else fit(false);
    if(animateChange&&!motion.matches){
      const camera=cameras.get(key());
      for(const [id,element]of nodes){
        const before=previous.get(id),after=positions.get(id);
        if(before&&previousCamera){
          const dx=before.x-after.x+(previousCamera.x-camera.x)/camera.k,dy=before.y-after.y+(previousCamera.y-camera.y)/camera.k;
          if(dx||dy)animate(element,[{transform:'translate('+dx+'px,'+dy+'px)'},{transform:'translate(0,0)'}],360);
        }else animate(element,[{opacity:0,transform:'translateX(-28px)'},{opacity:1,transform:'translateX(0)'}],360);
      }
      animate(world.querySelector('.feature-hierarchy-lines'),[{opacity:.25},{opacity:1}],360);
    }
    updateSelectionLocation();observer.observe(viewport);
    if(focus){const element=nodes.get(focus.id)||origin;(element.querySelector('.'+focus.action)||element.querySelector('button'))?.focus({preventScroll:true});}
    viewport.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button'))return;cancelCamera();const c=cameras.get(key());if(!c)return;
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:c.x,startY:c.y};viewport.setPointerCapture(event.pointerId);viewport.dataset.dragging='true';event.preventDefault();
    });
    viewport.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const c=cameras.get(key());c.x=drag.startX+event.clientX-drag.x;c.y=drag.startY+event.clientY-drag.y;applyCamera();});
    const stop=event=>{if(!drag||drag.id!==event.pointerId)return;drag=null;if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);viewport.dataset.dragging='false';};
    viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);viewport.addEventListener('lostpointercapture',stop);
    viewport.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.002),[event.clientX-r.left,event.clientY-r.top]);},{passive:false});
    controls.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();cancelCamera();const c=cameras.get(key());
      c.x+=event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0;c.y+=event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0;applyCamera();
    });
  }
  function render(next,state){
    observer.disconnect();cancelCamera();stopTransitions();report=next;hierarchy=api.hierarchy(next.map.features);scopeId=state.scopeId;mode=state.mode;selected=state.selected;
    mappingIndex=new Map();for(const item of next.mappings){const id=item.mapping.featureId;if(!mappingIndex.has(id))mappingIndex.set(id,[]);mappingIndex.get(id).push(item);}
    panel.dataset.scope=scopeId||'';panel.dataset.mode=mode;
    const current=next.features.find(f=>f.id===scopeId),children=hierarchy.children(scopeId),path=current?hierarchy.path(scopeId):[];
    title.textContent=current?.title||graph.project.name;summary.textContent=current?compact(caption(current),160):'点选阅读说明，原地展开组成；需要专注时再聚焦一支。';
    back.disabled=!scopeId&&!state.canReturn;back.textContent=state.canReturn?'← 返回阅读位置':'← 上一层';
    crumbs.replaceChildren();const root=button('全部功能',()=>onEnter(null,'features',{resetHistory:true}));crumbs.append(root);
    if(!path.length)root.setAttribute('aria-current','page');
    for(const [i,f]of path.entries()){
      crumbs.append(make('span','›'));const item=i===path.length-1?make('span',f.title):button(f.title,()=>onEnter(f.id,'features',{resetHistory:true}));
      item.dataset.feature=f.id;if(i===path.length-1)item.setAttribute('aria-current','page');crumbs.append(item);
    }
    switches.hidden=!current;
    for(const b of switches.children){b.setAttribute('aria-pressed',String(b.dataset.mode===mode));b.textContent=b.dataset.mode==='features'?'子功能 · '+children.length:'关联代码 · '+(mappingIndex.get(scopeId)?.length||0);}
    host.hidden=mode!=='features';$('feature-mappings').hidden=mode!=='code';$('feature-selected').hidden=true;
    if(mode!=='features'){world=null;viewport=null;scene=null;nodes=new Map();return;}
    if(state.revealId)reveal(state.revealId);
    renderCanvas();
  }
  motion.addEventListener('change',()=>{if(!motion.matches)return;const target=cameraTarget;cancelCamera();if(target){Object.assign(cameras.get(key()),target);applyCamera();}for(const a of panel.getAnimations({subtree:true}))a.cancel();for(const ghost of panel.querySelectorAll('.feature-motion-ghost'))ghost.remove();});
  function readingSnapshot(){
    const state=view(),camera=cameras.get(key());
    return {scopeId,camera:camera?{...camera}:null,expanded:[...state.expanded],limits:[...state.limits]};
  }
  function restoreReading(saved){
    if(!saved)return;
    views.set(saved.scopeId,{expanded:new Set(saved.expanded),limits:new Map(saved.limits)});
    if(saved.camera)cameras.set(saved.scopeId,{...saved.camera});else cameras.delete(saved.scopeId);
  }
  function leave(){observer.disconnect();cancelCamera();stopTransitions();closeSearch();}
  function reset(){cancelCamera();stopTransitions();cameras.clear();views.clear();search.value='';closeSearch();shell.revealMap();}
  return {render,select,locate,reveal,capture,transition,animate,readingSnapshot,restoreReading,showDetails,closeDetails,leave,reset};
}
