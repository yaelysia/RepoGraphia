/** Shared chrome and finite transitions; all map content stays in its existing view. */
function createWorkbenchShell() {
  const $ = id => document.getElementById(id), body = document.body;
  const navigator = $('navigation'), inspector = $('inspector'), map = document.querySelector('.map-panel');
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), narrow = matchMedia('(max-width: 620px)');
  const saved = new Map(), animations = new Set();
  let view = 'project';
  const labels = {
    project: ['项目地图', '按目录探索代码与原始关系'],
    features: ['功能映射', '逐层查看功能组成与关联代码'],
    files: ['文件与代码', '查看源码快照及原始关系证据'],
    symbols: ['函数与类', '查看代码实体及声明位置'],
    gaps: ['分析边界', '查看未解析原因与索引范围'],
  };
  function animate(target, frames, duration) {
    if (!target || motion.matches) return;
    const animation = target.animate(frames, {duration, easing: 'cubic-bezier(.2,0,.2,1)'});
    animations.add(animation);animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  }
  function cancel() {for (const animation of animations) animation.cancel();animations.clear();}
  function syncInspector() {
    const visible = !body.classList.contains('feature-detail-closed') && (!narrow.matches || body.classList.contains('feature-detail-open'));
    inspector.inert = !visible;$('inspector-toggle').setAttribute('aria-expanded', String(visible));
  }
  function showDetails() {body.classList.remove('feature-detail-closed');body.classList.add('feature-detail-open');syncInspector();}
  function closeDetails(focus = true) {
    body.classList.add('feature-detail-closed');body.classList.remove('feature-detail-open');syncInspector();
    if (focus) $('inspector-toggle').focus();
  }
  function toggleNavigation(open = !body.classList.contains('navigator-open'), focus = true) {
    body.classList.toggle('navigator-open', open);body.classList.toggle('feature-tree-open', open);
    $('feature-tree-toggle').setAttribute('aria-expanded', String(open));navigator.inert = !open;
    if (focus) (open ? navigator.querySelector('button') : $('feature-tree-toggle'))?.focus();
  }
  function revealMap() {toggleNavigation(false, false);if (narrow.matches) closeDetails(false);}
  function remember() {
    saved.set(view, {scroll: map.scrollTop, opened: body.classList.contains('feature-detail-open'), closed: body.classList.contains('feature-detail-closed')});
  }
  function prepare(next, keepNavigation = false) {
    cancel();if (!keepNavigation) toggleNavigation(false, false);
    document.querySelector('.project-info').open = false;
    view = next;body.dataset.view = next;
    const state = saved.get(view);
    body.classList.toggle('feature-detail-open', state?.opened || false);
    body.classList.toggle('feature-detail-closed', state?.closed || false);
    const feature = next === 'features';
    $('search').hidden = feature;
    const featureSearch = document.querySelector('.feature-search');if (featureSearch) featureSearch.hidden = !feature;
    $('feature-tree-toggle').textContent = feature ? '☰ 功能树' : '☰ 项目导航';
    $('navigation-label').textContent = feature ? '功能树' : next === 'gaps' ? '分析边界' : '项目导航';
    $('workbench-title').textContent = labels[next][0];$('workbench-caption').textContent = labels[next][1];
    for (const [id, active] of [['project-tab', !feature], ['features-tab', feature]]) {
      $(id).classList.toggle('active', active);$(id).setAttribute('aria-pressed', String(active));
    }
    syncInspector();
  }
  function finish(previous, animated = true) {
    map.scrollTop = saved.get(view)?.scroll || 0;syncInspector();
    if (!animated || previous === view) return;
    const target = $(view === 'features' ? 'feature-view' : view === 'project' ? 'project-view' : 'local-view');
    const direction = view === 'features' ? 1 : -1;
    animate(target, [{opacity: .12, transform: `translateX(${direction * 44}px) scale(.975)`}, {opacity: 1, transform: 'translateX(0) scale(1)'}], 460);
    animate($('detail'), [{opacity: .2, transform: 'translateY(16px)'}, {opacity: 1, transform: 'translateY(0)'}], 360);
  }
  $('feature-tree-toggle').onclick = () => toggleNavigation();$('feature-tree-close').onclick = () => toggleNavigation(false);
  $('inspector-toggle').onclick = () => {$('inspector-toggle').getAttribute('aria-expanded') === 'true' ? closeDetails() : showDetails();};
  $('inspector-close').onclick = () => closeDetails();
  document.addEventListener('pointerdown', event => {
    if (body.classList.contains('navigator-open') && !navigator.contains(event.target) && !$('feature-tree-toggle').contains(event.target)) toggleNavigation(false, false);
    const info = document.querySelector('.project-info');if (info.open && !info.contains(event.target)) info.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (body.classList.contains('navigator-open')) {toggleNavigation(false);event.preventDefault();}
    else if (body.classList.contains('feature-detail-open')) {closeDetails();event.preventDefault();}
  });
  motion.addEventListener('change', () => {if (motion.matches) cancel();});narrow.addEventListener('change', syncInspector);
  toggleNavigation(false, false);syncInspector();
  return {remember, prepare, finish, showDetails, closeDetails, toggleNavigation, revealMap};
}
