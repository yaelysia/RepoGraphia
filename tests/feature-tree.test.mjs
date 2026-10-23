import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createFeatureTreeApi } from '../dist/feature-tree.js';

const upstream = readFileSync(new URL('../third-party/archify/render-tree.upstream.mjs', import.meta.url), 'utf8');
const license = readFileSync(new URL('../third-party/archify/LICENSE', import.meta.url), 'utf8');
const { layout } = createFeatureTreeApi();
const clone = value => JSON.parse(JSON.stringify(value));
const size = (id, parentId, width = 200, height = 80) => ({ id, ...(parentId === undefined ? {} : { parentId }), width, height });

// Read only the pinned renderer's pure geometry block. Do not import its CLI,
// evaluate its top-level loader, render SVG, or execute an analyzed application.
function upstreamLayout(input, options = {}) {
  const start = upstream.indexOf('// ---- Layout ');
  const end = upstream.indexOf('\nfunction ancestorsOf', start);
  assert.ok(start > 0 && end > start, 'pinned original geometry block is present');
  const childrenOf = new Map(input.map(node => [node.id, []]));
  const measured = new Map(input.map(node => [node.id, {
    id: node.id, ...(node.parentId === undefined ? {} : { parent: node.parentId }),
    width: node.width, height: node.height, depth: 0, stacked: false,
  }]));
  const roots = input.filter(node => node.parentId === undefined);
  assert.equal(roots.length, 1, 'original renderer accepts one authored root');
  for (const node of input) if (node.parentId !== undefined) childrenOf.get(node.parentId).push(node.id);
  const order = [roots[0].id];
  for (const id of order) for (const child of childrenOf.get(id)) {
    measured.get(child).depth = measured.get(id).depth + 1;
    order.push(child);
  }
  const context = {
    down: false, measured, childrenOf,
    groupsOf: new Map([...childrenOf].map(([id, children]) => [id, children.map(single => ({ single }))])),
    authoredRoot: { id: roots[0].id }, tree: { nodes: [...measured.values()], meta: {} },
    layout: { gapX: options.gapX ?? 64, gapY: options.gapY ?? 24,
      margin: options.padding ?? 24, top: options.padding ?? 24, toggleR: 7.5 },
    asArray: value => Array.isArray(value) ? value : [],
  };
  runInNewContext(upstream.slice(start, end) + `
    globalThis.result = {
      nodes: all.map(({id, x, y, width, height}) => ({id, x, y, width, height})),
      edges: edges.map(({from, to, points}) => ({parentId: from, childId: to, points}))
    };`, context, { timeout: 1000 });
  return clone(context.result);
}

function assertNoOverlap(result) {
  const columns = new Map();
  for (const node of result.nodes) {
    const column = columns.get(node.x) ?? [];
    column.push(node); columns.set(node.x, column);
    assert.ok(node.x >= 0 && node.y >= 0, `non-negative position for ${node.id}`);
    assert.ok(node.x + node.width <= result.width && node.y + node.height <= result.height, `bounds contain ${node.id}`);
  }
  const bands = [...columns].sort(([left], [right]) => left - right);
  for (let i = 0; i < bands.length; i++) {
    const [x, nodes] = bands[i];
    if (i) assert.ok(bands[i - 1][0] + bands[i - 1][1][0].width <= x, 'depth bands do not overlap');
    nodes.sort((a, b) => a.y - b.y);
    for (let j = 1; j < nodes.length; j++) assert.ok(nodes[j - 1].y + nodes[j - 1].height <= nodes[j].y + 1e-9,
      `${nodes[j - 1].id} and ${nodes[j].id} do not overlap`);
  }
}

test('tree reuse pins the complete upstream source and preserves the full embedded MIT notice', () => {
  const bytes = Buffer.from(upstream, 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '4e2ba7d4a3f567760c3801e7439bd18fa28acfe51e581479bd56ad549e240b68');
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), '2fd00e1e0570674be2298aed1f72c86cfee38b12');
  assert.equal(createHash('sha256').update(license).digest('hex'), 'b799ab081703e7821ae5096d2c1abdf14bbdc75e8ea1c4045998c36ed6db9706');
  // TypeScript can emit CRLF on Windows; renderHtml normalizes that runtime to
  // LF before embedding and hashing it. Only normalize the embedded comment,
  // never the fixed upstream bytes used by the digest checks above.
  const factory = createFeatureTreeApi.toString();
  for (const source of [factory, factory.replace(/\r\n?|\n/g, '\r\n')]) {
    const embedded = source.replace(/\r\n?/g, '\n').replace(/^\s*\* ?/gm, '');
    assert.ok(embedded.includes(license.trim()), 'the full MIT license travels with the browser factory');
  }
});

test('rightward node positions and edge routes match the actual pinned upstream geometry', () => {
  const examples = [
    [size('root'), size('left', 'root'), size('middle', 'root'), size('right', 'root')],
    [size('root', undefined, 180, 80), size('branch-a', 'root', 220, 64), size('branch-b', 'root', 320, 96),
      size('leaf-a', 'branch-a', 200, 64), size('leaf-b', 'branch-b', 260, 64), size('leaf-c', 'branch-b', 200, 96),
      size('deep-leaf', 'leaf-c', 340, 80)],
    [size('root', undefined, 180, 400), size('one', 'root', 380, 160), size('two', 'root', 240, 160)],
  ];
  for (const input of examples) {
    const actual = layout(input), original = upstreamLayout(input);
    assert.deepEqual(actual.nodes, original.nodes);
    assert.deepEqual(actual.edges, original.edges);
    assertNoOverlap(actual);
  }
});

test('forest layout keeps original IDs and authored sibling order without a fabricated root', () => {
  const input = [size('child / <> 中文', '__proto__', 320, 100), size('__proto__', undefined, 240, 80),
    size('constructor', undefined, 180, 60), size('second child', '__proto__', 200, 60),
    size('toString', 'constructor', 180, 80)];
  const result = layout(input);
  assert.deepEqual(result.nodes.map(node => node.id), input.map(node => node.id));
  assert.deepEqual(result.edges.map(({ parentId, childId }) => ({ parentId, childId })),
    input.filter(node => node.parentId !== undefined).map(({ parentId, id }) => ({ parentId, childId: id })));
  const nodes = new Map(result.nodes.map(node => [node.id, node]));
  assert.equal(nodes.get('__proto__').x, nodes.get('constructor').x);
  assert.ok(nodes.get('child / <> 中文').y < nodes.get('second child').y);
  assert.ok(nodes.get('second child').y + nodes.get('second child').height < nodes.get('toString').y);
  assertNoOverlap(result);
});

test('tall cards in unbalanced subtrees stay inside their span where the upstream layout overlaps', () => {
  const input = [size('root', undefined, 200, 24), size('tall-parent', 'root', 200, 1000),
    size('following-sibling', 'root', 200, 24), size('tall-leaf', 'tall-parent', 200, 1000),
    size('short-leaf', 'tall-parent', 200, 24)];
  const original = upstreamLayout(input);
  const originalNodes = new Map(original.nodes.map(node => [node.id, node]));
  const tall = originalNodes.get('tall-parent'), following = originalNodes.get('following-sibling');
  assert.ok(tall.y + tall.height > following.y, 'the pinned original exhibits the specific overlap');
  assertNoOverlap(layout(input));
});

test('caller dimensions stay readable, with widths expanded only to their depth band', () => {
  const input = [size('root', undefined, 540, 180), size('long-description', 'root', 680, 420),
    size('short-description', 'root', 240, 120), size('detail', 'long-description', 800, 360)];
  const result = layout(input);
  const nodes = new Map(result.nodes.map(node => [node.id, node]));
  for (const node of input) {
    assert.equal(nodes.get(node.id).height, node.height);
    assert.ok(nodes.get(node.id).width >= node.width);
  }
  assert.equal(nodes.get('short-description').width, 680);
  assert.equal(nodes.get('root').width, 540);
  assert.equal(nodes.get('detail').width, 800);
  assertNoOverlap(result);
});

test('wide synthetic trees preserve order and deep synthetic trees require no recursion', () => {
  const wide = [size('root'), ...Array.from({ length: 512 }, (_, i) => size(`wide-${i}`, 'root', 200 + (i % 3) * 20, 60 + (i % 5) * 20))];
  const wideResult = layout(wide);
  assert.equal(wideResult.nodes.length, 513);
  assert.equal(wideResult.edges.length, 512);
  assertNoOverlap(wideResult);
  const deep = Array.from({ length: 10000 }, (_, i) => size(`deep-${i}`, i ? `deep-${i - 1}` : undefined, 200, 80));
  const deepResult = layout(deep);
  assert.equal(deepResult.nodes.length, 10000);
  assert.equal(deepResult.edges.length, 9999);
  assert.equal(deepResult.nodes.at(-1).x, 24 + 9999 * 264);
  assert.ok(deepResult.nodes.every(node => node.y === 24));
});

test('fractional DOM measurements with zero gaps do not overlap or escape the bounds', () => {
  const input = [size('root', undefined, 201.6, 24.3), size('one', 'root', 144.7, 47.3),
    size('two', 'root', 144.1, 100.1), size('one-a', 'one', 123.8, 30.1),
    size('one-b', 'one', 123.1, 21.8)];
  const result = layout(input, { gapX: 0, gapY: 0, padding: 0 });
  assertNoOverlap(result);
  assert.equal(result.nodes.find(node => node.id === 'two').height, 100.1);
  for (const edge of result.edges) assert.ok(edge.points.flat().every(Number.isFinite));
});

test('geometry is deterministic, immutable and free of feature semantics', () => {
  const input = Object.freeze([Object.freeze({ ...size('root'), summary: '保留原说明', decision: 'proposed' }),
    Object.freeze({ ...size('child', 'root'), referenceStatus: 'needs-review' })]);
  const options = Object.freeze({ gapX: 40, gapY: 20, padding: 10 });
  const before = clone(input), result = layout(input, options);
  assert.deepEqual(input, before);
  assert.deepEqual(layout(input, options), result);
  for (const node of result.nodes) assert.deepEqual(Object.keys(node), ['id', 'x', 'y', 'width', 'height']);
  for (const edge of result.edges) assert.deepEqual(Object.keys(edge), ['parentId', 'childId', 'points']);
  result.nodes[0].x = -999;
  assert.equal(layout(input, options).nodes[0].x, 10, 'returned geometry is not retained mutable state');
});

test('the factory works in an isolated browser-style realm without imports or closure state', () => {
  const api = runInNewContext(`(${createFeatureTreeApi.toString()})()`, {}, { timeout: 1000 });
  const input = [size('root'), size('child', 'root')];
  assert.deepEqual(clone(api.layout(input)), layout(input));
});

test('empty input has empty bounds and malformed structures or dimensions are rejected', () => {
  assert.deepEqual(layout([]), { nodes: [], edges: [], width: 0, height: 0 });
  for (const input of [null, {}, [null], [size('')], [size('same'), size('same')],
    [size('child', 'missing')], [size('self', 'self')], [size('a', 'b'), size('b', 'a')],
    [size('valid-root'), size('cycle-a', 'cycle-b'), size('cycle-b', 'cycle-a')],
    [{ ...size('root'), parentId: null }], [{ ...size('root'), width: NaN }],
    [{ ...size('root'), height: Infinity }], [{ ...size('root'), width: 0 }],
    [{ ...size('root'), height: -1 }], [{ ...size('root'), width: '200' }]]) {
    assert.throws(() => layout(input), /Feature tree:/);
  }
  for (const options of [null, [], { gapX: -1 }, { gapY: Infinity }, { padding: NaN }, { gapX: null }]) {
    assert.throws(() => layout([size('root')], options), /Feature tree:/);
  }
  assert.throws(() => layout([size('root', undefined, Number.MAX_VALUE), size('child', 'root', Number.MAX_VALUE)]), /finite coordinates/);
});
