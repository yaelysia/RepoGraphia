/** The embedded report has no network access. Only its same-origin parent saves data. */
function createWorkspaceBridge() {
  const element = document.getElementById('workspace-data');
  if (!element || window.parent === window) return null;
  const config = JSON.parse(element.textContent), origin = window.origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return null;
  const channel = 'repographia-workspace-v1', instance = crypto.randomUUID();
  let hooks = null, sequence = 0, pending = null, draft = false;
  const inputs = new Map();
  const send = (type, data = {}) => window.parent.postMessage({channel, instance, snapshot: config.snapshot, type, ...data}, origin);
  const state = () => send('state', {dirty: pending !== null, draft, readOnly: !!config.readOnly});
  const valueOf = input => input.type === 'checkbox' ? input.checked : input.value;
  function reconcileDraft() {
    for (const input of inputs.keys()) if (!input.isConnected) inputs.delete(input);
    const next = [...inputs].some(([input, initial]) => valueOf(input) !== initial);
    if (next !== draft) {draft = next;state();}
  }
  const editable = target => !config.readOnly && target instanceof Element &&
    target.matches('input:not([type=file]),textarea,select') && target.closest('.feature-field,[data-workspace-edit]');
  document.addEventListener('focusin', event => {
    if (editable(event.target) && !inputs.has(event.target)) inputs.set(event.target, valueOf(event.target));
  });
  document.addEventListener('input', event => {
    if (!editable(event.target)) return;
    // Focus normally records the original value. Programmatic edits still stay dirty.
    if (!inputs.has(event.target)) inputs.set(event.target, Symbol('initial'));
    reconcileDraft();
  });
  document.addEventListener('change', event => {if (editable(event.target)) reconcileDraft();});
  new MutationObserver(reconcileDraft).observe(document.body, {childList: true, subtree: true});
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || event.origin !== origin || data?.channel !== channel || data.instance !== instance) return;
    if (data.type === 'saved' && data.editId === pending) {
      pending = null;hooks?.saved();state();
    } else if (data.type === 'save-error' && data.editId === pending) {
      hooks?.failed(String(data.message || '保存失败'));state();
    } else if (data.type === 'export-draft') {
      const blob = new Blob([JSON.stringify(hooks?.document(), null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url;link.download = 'features-unsaved.json';link.click();setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });
  window.addEventListener('beforeunload', event => {if (pending !== null || draft) {event.preventDefault();event.returnValue = '';}});
  const footer = document.querySelector('footer > span');
  if (footer) footer.textContent = '固定审阅版本 · 代码只读 · 标注保存到本地工作区';
  const info = document.querySelector('.project-info-content > .meta');
  if (info) info.textContent = '代码是固定快照；应用标注修改后自动保存到本地工作区。';
  const hint = document.querySelector('#feature-view > .callout');
  if (hint) hint.textContent = config.readOnly ? '本轮起点的历史标注，只读查看。原审阅决定仍绑定当时的依据。' :
    '关联不等于调用。应用修改后自动保存；旧依据保留原版本，不会自动迁移到新代码。';
  return {
    readOnly: !!config.readOnly,
    attach(callbacks) {
      hooks = callbacks;
      send('ready', {featureDigest: config.featureDigest, basisSnapshot: callbacks.document().basis.snapshot,
        revision: callbacks.document().revision, readOnly: !!config.readOnly});state();
    },
    changed(document) {
      if (config.readOnly) return;
      inputs.clear();draft = false;pending = ++sequence;
      send('features', {editId: pending, document});state();
    },
  };
}
