/** Offline function navigation. Only explicit parentId links become containment lines. */
function createFeatureWorkbenchView({graph, api, make, button, onSelect, onEnter, onCode, onParent, onMode, onJump, shell}) {
  const $=id=>document.getElementById(id), panel=$('feature-view'), host=$('feature-cards');
  const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  const motion=matchMedia('(prefers-reduced-motion: reduce)'), cameras=new Map(), pages=new Map();
  let report=null, hierarchy=null, scopeId=null, mode='features', selected=null, world=null, viewport=null, scene=null;
  let cameraFrame=0, cameraTarget=null, drag=null, size=null, searchLimit=12;
  const key=()=>scopeId, caption=f=>f.summary||f.description, compact=(text,limit)=>Array.from(text).length>limit?Array.from(text).slice(0,limit).join('')+'…':text;
  const nav=make('nav',null,'feature-workbench-nav');nav.setAttribute('aria-label','功能图导航');
  const back=button('← 上一层',()=>onParent(),'feature-tool');back.id='feature-parent';
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
    // Initial reading size stays 1:1. On a narrow canvas keep the first child readable;
    // users can explicitly fit the full graph, or drag back to its parent.
    const k=explicit?Math.max(.28,Math.min(1,(w-44)/size.w,(h-80)/size.h)):1;
    const next={x:explicit?Math.max(18,(w-size.w*k)/2):size.w<=w-44?(w-size.w)/2:Math.min(18,w-534),y:Math.max(24,(h-55-size.h*k)/2),k};
    if(!cameras.has(key()))cameras.set(key(),{...next,w,h});cameraTo(next,explicit?380:0);
  }
  function zoom(factor,point){
    if(!viewport)return;const c=cameras.get(key());if(!c)return;const x=point?.[0]??viewport.clientWidth/2,y=point?.[1]??viewport.clientHeight/2,k=Math.max(.28,Math.min(1.8,c.k*factor));
    cameraTo({x:x-(x-c.x)*k/c.k,y:y-(y-c.y)*k/c.k,k},point?0:260);
  }
  function locate(id,animated=true){
    if(!viewport||!world)return;const node=[...world.querySelectorAll('.feature-node-wrap')].find(n=>n.dataset.feature===id),c=cameras.get(key());if(!node||!c)return;
    let {x,y,k}=c;const margin=20,l=node.offsetLeft*k+x,r=l+node.offsetWidth*k,t=node.offsetTop*k+y,b=t+node.offsetHeight*k;
    if(l<margin)x+=margin-l;else if(r>viewport.clientWidth-margin)x-=r-viewport.clientWidth+margin;
    if(t<margin)y+=margin-t;else if(b>viewport.clientHeight-50)y-=b-viewport.clientHeight+50;
    if(x!==c.x||y!==c.y)cameraTo({x,y,k},animated?380:0);
  }
  const observer=new ResizeObserver(()=>{if(!viewport?.clientWidth||!world)return;const c=cameras.get(key());if(!c)fit(false);else if(c.w!==viewport.clientWidth||c.h!==viewport.clientHeight){cancelCamera();c.x+=(viewport.clientWidth-c.w)/2;c.y+=(viewport.clientHeight-c.h)/2;c.w=viewport.clientWidth;c.h=viewport.clientHeight;applyCamera();}});
  function animate(target,frames,duration=340,options={}){if(!target||motion.matches)return;for(const a of target.getAnimations())a.cancel();return target.animate(frames,{duration,easing:'cubic-bezier(.2,0,.2,1)',...options});}
  function stopTransitions(){
    for(const target of [scene,$('feature-mappings')])for(const a of target?.getAnimations()||[])a.cancel();
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
    for(const b of host.querySelectorAll('.feature-card')){const active=b.dataset.feature===id;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));}
    if(changed){const b=[...host.querySelectorAll('.feature-card')].find(n=>n.dataset.feature===id),pill=b?.querySelector('strong');animate(pill,[{boxShadow:'0 0 0 1px var(--fm-accent)'},{boxShadow:'0 0 0 7px transparent'}],380);}
    if(locateNode)locate(id);showDetails();
  }
  function node(f){
    const outer=make('div',null,'feature-node-wrap');outer.dataset.feature=f.id;
    const b=button('',()=>onSelect(f.id),'feature-card'+(selected===f.id?' selected':''));b.dataset.feature=f.id;b.setAttribute('aria-pressed',String(selected===f.id));b.setAttribute('aria-label',`查看${f.title}的说明`);b.title=f.title;
    const children=hierarchy.children(f.id),items=report.mappings.filter(m=>m.mapping.featureId===f.id),stale=items.filter(m=>!m.current).length;
    b.append(make('span',children.length?'包含子功能':'功能','feature-node-type'),make('strong',f.title),make('span',compact(caption(f),88),'feature-node-summary'));
    const stats=make('span',`${children.length?children.length+' 个子功能 · ':''}${items.length} 条关联${stale?' · '+stale+' 条失效':''}`,'feature-node-stats');if(stale)stats.classList.add('feature-stale-text');b.append(stats);
    const actions=make('div',null,'feature-node-actions'),enter=button(children.length?'进入功能 →':'查看实现 →',()=>onEnter(f.id),'feature-enter'),code=button('代码',()=>onCode(f.id),'feature-open-code');enter.dataset.feature=f.id;code.dataset.feature=f.id;code.setAttribute('aria-label',`查看${f.title}的关联代码`);actions.append(enter,code);outer.append(b,actions);return outer;
  }
  function drawHierarchy(){
    const cards=[...world.querySelectorAll('.feature-node-wrap')],origin=world.querySelector('.feature-parent-node'),lines=world.querySelector('.feature-hierarchy-lines');
    const gap=46,nodeWidth=220,rowHeight=Math.max(160,...cards.map(n=>n.offsetHeight))+36;
    const rows=Math.min(cards.length,Math.max(1,Math.min(3,Math.floor((viewport.clientHeight-64)/rowHeight))));
    cards.forEach((n,i)=>{n.style.left=(290+Math.floor(i/Math.max(rows,1))*(nodeWidth+gap))+'px';n.style.top=(28+i%Math.max(rows,1)*rowHeight)+'px';});
    const h=cards.length?28+rows*rowHeight-36:260;origin.style.left='18px';origin.style.top=Math.max(28,(h-origin.offsetHeight)/2)+'px';
    const w=Math.max(260,...cards.map(n=>n.offsetLeft+n.offsetWidth))+24;size={w,h:Math.max(h,origin.offsetTop+origin.offsetHeight)+24};world.style.width=size.w+'px';world.style.height=size.h+'px';
    lines.replaceChildren();for(const [k,v]of Object.entries({width:size.w,height:size.h,viewBox:`0 0 ${size.w} ${size.h}`}))lines.setAttribute(k,v);
    const start=[origin.offsetLeft+origin.offsetWidth,origin.offsetTop+origin.querySelector('strong').offsetTop+origin.querySelector('strong').offsetHeight/2];
    for(const n of cards){
      const pill=n.querySelector('strong'),end=[n.offsetLeft,n.offsetTop+pill.offsetTop+pill.offsetHeight/2],trunk=start[0]+24;
      // Later columns use the clear space above the node rows, never earlier nodes.
      const d=n.offsetLeft>290?`M ${start} H ${trunk} V 8 H ${end[0]-24} V ${end[1]} H ${end[0]}`:`M ${start} C ${trunk} ${start[1]} ${trunk} ${end[1]} ${end}`;
      lines.append(svg('path',{class:'feature-containment-line',d,'data-child':n.dataset.feature}));
    }
  }
  function render(next,state){
    observer.disconnect();cancelCamera();stopTransitions();report=next;hierarchy=api.hierarchy(next.map.features);scopeId=state.scopeId;mode=state.mode;selected=state.selected;
    panel.dataset.scope=scopeId||'';panel.dataset.mode=mode;const current=next.features.find(f=>f.id===scopeId),children=hierarchy.children(scopeId),path=current?hierarchy.path(scopeId):[];
    title.textContent=current?.title||graph.project.name;summary.textContent=current?compact(caption(current),160):'从一个功能开始，逐层查看组成与关联代码。';
    back.disabled=!scopeId;crumbs.replaceChildren();const root=button('全部功能',()=>onEnter(null,'features'));crumbs.append(root);
    if(!path.length)root.setAttribute('aria-current','page');
    for(const [i,f]of path.entries()){crumbs.append(make('span','›'));const item=i===path.length-1?make('span',f.title):button(f.title,()=>onEnter(f.id,'features'));item.dataset.feature=f.id;if(i===path.length-1)item.setAttribute('aria-current','page');crumbs.append(item);}
    switches.hidden=!current;for(const b of switches.children){b.setAttribute('aria-pressed',String(b.dataset.mode===mode));b.textContent=b.dataset.mode==='features'?`子功能 · ${children.length}`:`关联代码 · ${next.mappings.filter(m=>m.mapping.featureId===scopeId).length}`;}
    host.hidden=mode!=='features';$('feature-mappings').hidden=mode!=='code';$('feature-selected').hidden=true;
    if(mode!=='features'){world=null;viewport=null;scene=null;return;}
    host.replaceChildren();viewport=make('div',null,'feature-viewport');viewport.setAttribute('role','group');viewport.setAttribute('aria-label','功能包含图，可拖动并缩放');
    scene=make('div',null,'feature-scene-layer');world=make('div',null,'feature-world');const lines=svg('svg',{class:'feature-hierarchy-lines','aria-hidden':'true'});world.append(lines);
    const origin=make('div',null,'feature-parent-node');origin.append(make('span',current?'当前功能':'项目','feature-node-type'),make('strong',current?.title||graph.project.name),make('span',`${children.length} 个${current?'直接子功能':'顶层功能'}`,'feature-node-summary'));world.append(origin);
    const selectedIndex=children.findIndex(f=>f.id===selected),pageSize=Math.max(pages.get(key())||12,Math.ceil((selectedIndex+1)/12)*12);pages.set(key(),pageSize);
    for(const f of children.slice(0,pageSize))world.append(node(f));scene.append(world);viewport.append(scene);host.append(viewport);
    const toolbar=make('div',null,'feature-canvas-toolbar'),meaning=make('span','连线表示包含 · 不代表执行顺序'),controls=make('div',null,'feature-canvas-controls');
    const out=button('−',()=>zoom(1/1.16)),zin=button('+',()=>zoom(1.16)),fitButton=button('适应',()=>fit()),percent=make('span','100%');
    out.id='feature-zoom-out';zin.id='feature-zoom-in';fitButton.id='feature-fit';percent.id='feature-zoom-label';out.setAttribute('aria-label','缩小功能图');zin.setAttribute('aria-label','放大功能图');controls.append(out,percent,zin,fitButton);toolbar.append(meaning,controls);host.append(toolbar,make('p','拖动画布移动 · Ctrl + 滚轮缩放','feature-canvas-note'));
    if(!children.length)host.append(make('p',current?'还没有标注子功能。可查看当前功能的关联代码，或在「新建功能」中指定父功能。':'尚未添加功能。可新建功能或导入标注 JSON。','feature-empty-state'));
    if(children.length>pageSize)host.append(button(`显示更多功能（${pageSize} / ${children.length}）`,()=>{pages.set(key(),pageSize+12);render(report,{scopeId,mode,selected});},'feature-hierarchy-more'));
    drawHierarchy();const camera=cameras.get(key());if(camera){camera.x+=(viewport.clientWidth-camera.w)/2;camera.y+=(viewport.clientHeight-camera.h)/2;camera.w=viewport.clientWidth;camera.h=viewport.clientHeight;applyCamera();}else fit(false);observer.observe(viewport);
    viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;cancelCamera();const c=cameras.get(key());if(!c)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:c.x,startY:c.y};viewport.setPointerCapture(event.pointerId);viewport.dataset.dragging='true';event.preventDefault();});
    viewport.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const c=cameras.get(key());c.x=drag.startX+event.clientX-drag.x;c.y=drag.startY+event.clientY-drag.y;applyCamera();});
    const stop=event=>{if(!drag||drag.id!==event.pointerId)return;drag=null;if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);viewport.dataset.dragging='false';};viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);viewport.addEventListener('lostpointercapture',stop);
    viewport.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.002),[event.clientX-r.left,event.clientY-r.top]);},{passive:false});
    controls.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();cancelCamera();const c=cameras.get(key());c.x+=event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0;c.y+=event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0;applyCamera();});
  }
  motion.addEventListener('change',()=>{if(!motion.matches)return;const target=cameraTarget;cancelCamera();if(target){Object.assign(cameras.get(key()),target);applyCamera();}for(const a of panel.getAnimations({subtree:true}))a.cancel();for(const ghost of panel.querySelectorAll('.feature-motion-ghost'))ghost.remove();});
  function leave(){observer.disconnect();cancelCamera();stopTransitions();closeSearch();}
  function reset(){cancelCamera();stopTransitions();cameras.clear();pages.clear();search.value='';closeSearch();shell.revealMap();}
  return {render,select,locate,capture,transition,animate,showDetails,closeDetails,leave,reset};
}
