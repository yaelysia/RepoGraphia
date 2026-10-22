/** Accessible HTML nodes; SVG adds membership rails and optional, original call edges. */
function createFeatureSceneView({graph, make, button, onFeature, onMapping, onRelations}) {
  const $=id=>document.getElementById(id), projection=FeatureScene.create(graph);
  const roleNames={entry:'触发入口',implementation:'核心实现',support:'共享与支撑',test:'测试代码'};
  const decisionNames={proposed:'待审',accepted:'人工接受（自述）',rejected:'已拒绝'};
  let feature=null, report=null, limits={}, mode='graph', listPage=25, selectedMapping=null, calls=false, scene=null, stage=null, frame=0, scrollLeft=0, scrollTop=0;
  const views=new Map(), reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const svg=(tag,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;};
  const compact=(text,n=55)=>Array.from(text).length>n?Array.from(text).slice(0,n).join('')+'…':text;
  function remember() {
    if(!feature)return;
    if(stage?.isConnected&&stage.offsetWidth){scrollLeft=stage.scrollLeft;scrollTop=stage.scrollTop;}
    views.set(feature.id,{limits:{...limits},mode,listPage,selectedMapping,calls,scrollLeft,scrollTop});
  }
  function restore(id) {
    const saved=views.get(id);
    limits={...saved?.limits};mode=saved?.mode??'graph';listPage=saved?.listPage??25;
    selectedMapping=saved?.selectedMapping??null;calls=saved?.calls??false;
    scrollLeft=saved?.scrollLeft??0;scrollTop=saved?.scrollTop??0;
  }
  function stopMotion() {for(const animation of stage?.getAnimations({subtree:true})||[])animation.cancel();}
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)stopMotion();});
  function changeGroup(role,limit,expanding) {
    const oldHeight=stage?.querySelector(`[data-role="${role}"]`)?.offsetHeight||0;
    limits[role]=limit;show(feature,report);
    const group=stage?.querySelector(`.feature-role-group[data-role="${role}"]`);if(!group)return;
    const control=group.querySelector(expanding?'.feature-group-expand,.feature-group-collapse':'.feature-group-expand');
    control?.focus({preventScroll:true});
    if(!reducedMotion.matches){
      const inset=expanding?Math.max(0,100-oldHeight/group.offsetHeight*100):22;
      group.animate([{opacity:.25,clipPath:`inset(0 0 ${inset}% 0)`},{opacity:1,clipPath:'inset(0 0 0 0)'}],{duration:expanding?330:280,easing:'cubic-bezier(.2,0,.2,1)'});
    }
  }
  function codeNode(a,shared=[]) {
    const m=a.mapping,label=projection.label(a),b=button('',()=>onMapping(m.id),'feature-mapping feature-code-node');
    b.dataset.mapping=m.id;b.dataset.role=m.role;b.dataset.current=String(a.current);b.dataset.decision=m.decision;
    b.classList.toggle('selected',selectedMapping===m.id);b.setAttribute('aria-pressed',String(selectedMapping===m.id));
    b.title=`${label.title}\n原符号：${label.original}\n${label.file}${label.line?':'+label.line:''}`;
    b.append(make('strong',label.title));
    if(mode==='graph')b.append(make('span',compact(m.rationale,80),'feature-node-summary'));
    // Long qualified symbols remain fully available in the inspector; file and line disambiguate identical names.
    b.append(make('small',label.file+(label.line?' : '+label.line:''),'feature-node-path'));
    const meta=make('span',`${decisionNames[m.decision]} · ${a.current?'证据匹配':'已失效'}`,'feature-node-status');b.append(meta);
    if(shared.length)b.append(make('small',`另有 ${shared.length} 个功能显式关联此代码`,'feature-shared'));
    if(mode==='list')b.append(make('p',compact(m.rationale,85),'feature-rationale-excerpt'));
    return b;
  }
  function schedule() {cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}
  const observer=new ResizeObserver(schedule);
  function show(f,next) {
    remember();stopMotion();observer.disconnect();cancelAnimationFrame(frame);stage=null;report=next;
    if(!f){feature=null;$('feature-mappings').replaceChildren(make('p','选择功能，再查看它的入口、实现与支撑代码。','feature-empty-state'));return;}
    restore(f.id);
    feature=f;scene=projection.project(next.mappings,f.id,limits);
    const box=$('feature-mappings');box.replaceChildren();
    const tools=make('div',null,'feature-scene-tools'),switcher=make('div',null,'feature-view-switch');
    for(const [value,title]of [['graph','关联图'],['list','全部关联']]){
      const b=button(title,()=>{mode=value;show(feature,report);},'feature-mode');b.dataset.mode=value;b.setAttribute('aria-pressed',String(mode===value));switcher.append(b);
    }
    tools.append(switcher,make('span',`${scene.total} 条显式映射 · 分组不是执行顺序`));box.append(tools);
    if(!scene.total){box.append(make('p','此功能尚无代码映射，不推测缺失的实现。','feature-empty-state'));return;}
    if(mode==='list') {
      const list=make('div',null,'feature-complete-list'),items=next.mappings.filter(a=>a.mapping.featureId===f.id);
      for(const a of items.slice(0,listPage)){
        const b=codeNode(a);b.prepend(make('span',roleNames[a.mapping.role],'feature-node-type'));list.append(b);
      }
      box.append(list);
      if(items.length>listPage)box.append(button(`更多关联（已显示 ${Math.min(listPage,items.length)} / ${items.length}）`,()=>{listPage+=25;show(feature,report);},'feature-list-more'));
      return;
    }
    const legend=make('div',null,'feature-scene-legend');
    legend.append(make('span','─ 功能关联（非调用）','feature-membership-key'));
    const toggle=make('label'),input=make('input');input.type='checkbox';input.id='feature-show-calls';input.checked=calls;
    input.onchange=()=>{calls=input.checked;show(feature,report);};toggle.append(input,document.createTextNode('叠加原始调用箭头'));legend.append(toggle);
    box.append(legend);
    stage=make('div',null,'feature-scene');stage.id='feature-scene';stage.dataset.feature=f.id;
    stage.setAttribute('role','region');stage.setAttribute('aria-label','功能与代码关联图，可横向滚动');stage.tabIndex=0;
    const overlay=svg('svg',{'class':'feature-connectors','aria-hidden':'true'});stage.append(overlay);
    const focus=button('',()=>onFeature(f.id),'feature-focus-node');focus.append(make('small','当前功能'),make('strong',f.title));stage.append(focus);
    const columns=make('div',null,'feature-role-columns');stage.append(columns);
    for(const group of scene.groups.filter(g=>g.total)) {
      const section=make('section',null,'feature-role-group');section.dataset.role=group.role;
      const header=make('h4');header.append(make('span',roleNames[group.role]),make('small',String(group.total)));section.append(header);
      const stack=make('div',null,'feature-code-stack');
      for(const item of group.items)stack.append(codeNode(item.assessment,item.sharedWith));section.append(stack);
      if(group.hidden) {
        const b=button(group.items.length?`展开更多 · 还有 ${group.hidden} 条`:`展开 ${group.total} 条${roleNames[group.role]}`,()=>{
          changeGroup(group.role,Math.min(50,group.items.length+5),true);
        },'feature-group-expand');b.dataset.role=group.role;b.disabled=group.items.length>=50;section.append(b);
      }
      if(group.items.length && (group.role==='support'||group.role==='test'||group.items.length>(group.role==='entry'?3:4))) {
        const b=button('收起此组',()=>changeGroup(group.role,group.role==='entry'?3:group.role==='implementation'?4:0,false),'feature-group-collapse');b.dataset.role=group.role;section.append(b);
      }
      columns.append(section);
    }
    box.append(stage);
    box.append(make('p',`当前展示 ${scene.shown} / ${scene.total} 条映射。支撑与测试默认折叠；原始标注完整保留，可切换「全部关联」。失效或已拒绝节点仅作记录展示。`,'feature-scope-note'));
    if(calls)renderCalls(box);
    draw();stage.scrollLeft=scrollLeft;stage.scrollTop=scrollTop;
    stage.onscroll=event=>{if(event.currentTarget===stage)remember();};
    observer.observe(stage);remember();
  }
  function renderCalls(box) {
    const c=scene.calls;
    box.append(make('p',`仅连接当前展开且证据匹配、未拒绝的实体；候选用虚线。${c.hiddenRelations} 条内部调用涉及折叠节点，${c.boundaryRelations} 条出边含功能外/未知目标，${c.selfRelations} 条自调用不画箭头；预算省略 ${c.omittedPairs} 对。各边界计数可能重叠。`,'feature-call-note'));
    box.append(make('p','当前视口较窄，调用箭头通过下方原始记录查看。','feature-scope-note feature-call-viewport-note'));
    const details=make('details',null,'feature-call-records');details.append(make('summary',`原始调用记录 · ${c.edges.length} 组（不是运行轨迹）`));
    for(const e of c.edges){
      const from=report.mappings.find(a=>a.mapping.id===e.from),to=report.mappings.find(a=>a.mapping.id===e.to);
      const b=button(`${projection.label(from).title} → ${projection.label(to).title} · ${e.kind} / ${e.status} · ${e.relationIds.length} 条`,()=>onRelations(e.relationIds),'detail-link feature-call-evidence');
      b.dataset.from=e.from;b.dataset.to=e.to;details.append(b);
    }
    if(!c.edges.length)details.append(make('p','当前展开范围没有可画的原始调用；不表示运行时无关联。'));
    box.append(details);
  }
  function draw() {
    if(!stage?.isConnected||!stage.offsetWidth||mode!=='graph')return;
    const canvas=stage.querySelector('svg');canvas.replaceChildren();
    const bounds=stage.getBoundingClientRect(),w=stage.scrollWidth,h=stage.scrollHeight;
    canvas.setAttribute('viewBox',`0 0 ${w} ${h}`);canvas.setAttribute('width',w);canvas.setAttribute('height',h);
    canvas.style.width=w+'px';canvas.style.height=h+'px';
    const rect=el=>{const r=el.getBoundingClientRect();return{x:r.left-bounds.left+stage.scrollLeft-stage.clientLeft,y:r.top-bounds.top+stage.scrollTop-stage.clientTop,w:r.width,h:r.height};};
    const origin=rect(stage.querySelector('.feature-focus-node strong'));
    for(const group of stage.querySelectorAll('.feature-role-group')){
      const target=rect(group.querySelector('h4')),x=origin.x+origin.w,y=origin.y+origin.h/2,tx=target.x,ty=target.y+target.h/2,trunk=x+22,rail=Math.max(9,target.y-16);
      canvas.append(svg('path',{d:`M${x} ${y} H${trunk} V${rail} H${tx-13} V${ty} H${tx}`,'class':'feature-membership-line'}));
    }
    const narrow=stage.clientWidth<620,note=$('feature-mappings').querySelector('.feature-call-viewport-note');if(note)note.hidden=!narrow;
    // Keep all source records reachable while omitting dense call arrows in narrow viewports.
    if(!calls||narrow)return;
    const defs=svg('defs');
    for(const status of ['bound','candidate','unresolved','external']){
      const marker=svg('marker',{id:'feature-arrow-'+status,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto'});
      marker.append(svg('path',{d:'M0 0 L10 5 L0 10 z',class:'feature-arrow-fill '+status}));defs.append(marker);
    }
    canvas.append(defs);
    const targets=new Map([...stage.querySelectorAll('.feature-code-node')].map(n=>[n.dataset.mapping,n]));
    for(const e of scene.calls.edges){
      const a=targets.get(e.from),b=targets.get(e.to);if(!a||!b)continue;
      const from=rect(a.querySelector('strong')),to=rect(b.querySelector('strong')),same=Math.abs(from.x-to.x)<10,forward=to.x>from.x;
      const x1=same||forward?from.x+from.w:from.x,y1=from.y+from.h/2,x2=same||!forward?to.x+to.w:to.x,y2=to.y+to.h/2;
      const bend=same?Math.min(w-4,Math.max(x1,x2)+15):(x1+x2)/2;
      const path=svg('path',{d:`M${x1} ${y1} C${bend} ${y1} ${bend} ${y2} ${x2} ${y2}`,class:'feature-call-line '+e.status+((selectedMapping&&e.from!==selectedMapping&&e.to!==selectedMapping)?' dim':''),'marker-end':`url(#feature-arrow-${e.status})`});
      canvas.append(path);
    }
  }
  function select(id){selectedMapping=id;for(const n of $('feature-mappings').querySelectorAll('.feature-code-node')){n.classList.toggle('selected',n.dataset.mapping===id);n.setAttribute('aria-pressed',String(n.dataset.mapping===id));}remember();schedule();}
  function leave(){remember();stopMotion();observer.disconnect();cancelAnimationFrame(frame);}
  function reset(){leave();views.clear();feature=null;report=null;scene=null;stage=null;restore(null);$('feature-mappings').replaceChildren();}
  return {show,select,leave,reset,label:projection.label};
}
