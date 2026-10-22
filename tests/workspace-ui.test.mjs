import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderHtml} from '../dist/report.js';
import {graph, runtimeOf} from './helpers/report-line-endings.mjs';

test('embedded workspace report keeps its own hash-only CSP and carries no service credential', () => {
  const html = renderHtml(graph, undefined, {workspace:{snapshot:graph.project.snapshot,featureDigest:null}});
  const script = runtimeOf(html), policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const digest = createHash('sha256').update(script).digest('base64');
  assert.match(policy, /connect-src 'none'/);
  assert.equal(/script-src ([^;]+)/.exec(policy)[1], `'sha256-${digest}'`);
  assert.deepEqual(JSON.parse(/id="workspace-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]),
    {snapshot:graph.project.snapshot,featureDigest:null});
  assert.ok(!html.includes('X-RepoGraphia-Token'));
  assert.ok(!script.includes('repoGraphiaInjected'));
  assert.doesNotThrow(() => new Function(script));
});

test('offline reports retain their standalone behavior without a live bridge or workspace metadata', () => {
  const html = renderHtml(graph);
  assert.ok(!html.includes('id="workspace-data"'));
  assert.ok(!html.includes('function createWorkspaceBridge'));
  assert.ok(!html.includes('workspace-embedded'));
  assert.match(html, /connect-src 'none'/);
});

test('workspace metadata must bind the rendered snapshot and a valid saved digest', () => {
  assert.throws(() => renderHtml(graph, undefined, {workspace:{snapshot:'0'.repeat(64),featureDigest:null}}), /metadata/);
  assert.throws(() => renderHtml(graph, undefined, {workspace:{snapshot:graph.project.snapshot,featureDigest:'<script>bad</script>'}}), /metadata/);
  const html = renderHtml(graph, undefined, {workspace:{snapshot:graph.project.snapshot,featureDigest:'a'.repeat(64),readOnly:true}});
  assert.match(html, /"readOnly":true/);
});
