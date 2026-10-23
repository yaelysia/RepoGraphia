// Authored reading fixture, not an inferred architecture or a target execution.
// The exported JSON pair also permits old/new renderers to show identical content.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture as workbenchFixture, chain} from './feature-workbench.mjs';
import {createFeatureMapApi} from '../../dist/feature-map.js';
import {renderHtml} from '../../dist/report.js';

const extraLevels = [
  ['保留尚未处理的显示请求', '记录上层仍需确认的显示条件'],
  ['核对本次恢复的边界', '先看本次请求明确允许的范围'],
  ['检查重复出现的恢复条件', '保留多次请求之间尚不确定的条件'],
  ['说明这次请求的已知限制', '把需要人工判断的限制继续展开'],
  ['确认仍待补充的恢复说明', '让复杂功能的更细一层保持可读'],
  ['保留最后一项人工确认', '仅展示已有说明与关联的依据'],
  ['核对连续恢复之后仍未结束的最后一项请求与人工确认边界', '即使功能很深，也保留准确说明与待确认条件'],
];

export function fixture() {
  const {graph, doc: base} = workbenchFixture(), api = createFeatureMapApi();
  let doc = base;
  const edit = operation => {
    doc = api.edit(graph, doc, operation, {
      expectedRevision: doc.revision, actor: 'tree-reading-fixture', actorKind: 'agent',
      reason: 'Explicit reading fixture; containment is not runtime order', at: '2026-10-23T00:00:00.000Z',
    });
  };
  const add = (id, parentId, title, summary, questions = []) => edit({op: 'feature', feature: {
    id, parentId, title, summary, questions,
    description: title + '。这是明确编写的阅读夹具。浏览只展示记录，不会执行源码，也不会代表功能已被人工接受。',
  }});
  const deepPath = chain.map(item => item.id);
  for (const [index, [title, summary]] of extraLevels.entries()) {
    const id = 'deep-' + String(index + chain.length).padStart(2, '0');
    add(id, deepPath.at(-1), title, summary, ['静态关系没有证明这些功能的运行顺序；这层说明仍有待人工确认。']);
    deepPath.push(id);
  }
  const deepTarget = deepPath.at(-1);
  edit({op: 'mapping', id: 'deep-entry', featureId: deepTarget, nodeId: 'scene:0', role: 'entry',
    rationale: '深层说明明确关联原始声明；候选调用仍需复核，功能包含不等于执行顺序。', relationIds: ['scene:call']});
  edit({op: 'mapping', id: 'deep-support', featureId: deepTarget, nodeId: 'scene:4', role: 'support',
    rationale: '仅保留明确指定的支撑代码，不自动补充后续调用。', relationIds: []});

  add('limits', 'prepare', '检查恢复条件的边界', '与继续恢复的说明并列，保留独立的限制');
  add('limits:manual', 'limits', '等待人工确认的特殊条件', '暂无代码关联，也不表示已经分析完成', ['这一条件还需要进一步说明。']);
  add('1.related', 'shared', '共享依据的独立说明', '共享代码不建立两个功能之间的调用关系');

  const wideBranch = 'wide-group', wideIds = [];
  add(wideBranch, 'window', '逐项阅读不同显示条件', '同级内容可以很多，每一项仍保持正常文字大小');
  for (let index = 1; index <= 20; index++) {
    const id = 'reading-sibling-' + String(index).padStart(2, '0');
    add(id, wideBranch, index === 20 ? '跨页的中文验证目标' : '独立显示条件 ' + String(index).padStart(2, '0'),
      '这是明确记录的同级条件，展开不代表执行这些步骤');
    wideIds.push(id);
  }
  doc = api.edit(graph, doc, {op: 'review', id: 'level-open', decision: 'accepted'}, {
    expectedRevision: doc.revision, actor: 'tree-reading-reviewer', actorKind: 'manual',
    reason: 'Fixture acceptance remains distinct from candidate evidence', at: '2026-10-23T00:00:00.000Z',
  });
  const metadata = {
    kind: 'explicit UI reading fixture; not real user acceptance or a runtime trace',
    rootIds: ['window', 'shared'], deepPath, deepTarget, wideBranch, wideIds,
    wideTarget: wideIds.at(-1), unevenPath: ['window', 'open', 'prepare', 'limits', 'limits:manual'],
    outsideTarget: '1.related',
    featureCount: doc.features.length,
    parents: Object.fromEntries(doc.features.map(feature => [feature.id, feature.parentId ?? null])),
  };
  return {graph, doc, metadata};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output) throw new Error('Expected a new feature-tree reading fixture directory');
  fs.mkdirSync(path.dirname(path.resolve(output)), {recursive: true});
  fs.mkdirSync(output);
  const {graph, doc, metadata} = fixture();
  const write = (name, value) => fs.writeFileSync(path.join(output, name), value, {flag: 'wx'});
  write('reading.html', renderHtml(graph, doc));
  write('graph.json', JSON.stringify(graph, null, 2));
  write('features.json', JSON.stringify(doc, null, 2));
  write('fixture.json', JSON.stringify(metadata, null, 2));
  const stale = structuredClone(graph);
  stale.project.snapshot = '0'.repeat(64);
  write('stale.html', renderHtml(stale, doc));
  const hostile = structuredClone(doc);
  hostile.features.find(feature => feature.id === 'window').summary = '<img src=x onerror="globalThis.treeReadingInjected=1">';
  write('hostile.html', renderHtml(graph, hostile));
}
