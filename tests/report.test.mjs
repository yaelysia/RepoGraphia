import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { graph, variants, renderVariant, runtimeOf, wrongHashReport } from './helpers/report-line-endings.mjs';

const digest = text => createHash('sha256').update(text).digest('base64');
const allowedHash = html => /script-src 'sha256-([^']+)'/.exec(html)?.[1];
const browserText = text => text.replace(/\r\n?/g, '\n');

for (const style of variants) test(`report CSP matches browser text for ${style} viewer assets AND compiled factories`, async () => {
  const html = await renderVariant(style), runtime = runtimeOf(html);
  assert.ok(!runtime.includes('\r'), 'runtime must be normalized before both embedding and hashing');
  assert.equal(allowedHash(html), digest(browserText(runtime)));
  const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.equal(/script-src ([^;]+)/.exec(policy)[1], `'sha256-${digest(runtime)}'`);
  assert.deepEqual(JSON.parse(/id="graph-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]), graph,
    'do not normalize CRLF inside embedded source or change source hashes');
  assert.ok(!runtime.includes('repoGraphiaInjected'), 'source text cannot enter executable code');
  assert.match(html, /<p id="viewer-startup"[^>]*>[^<]+<\/p>/, 'startup failure remains visible without JavaScript');
});

test('wrong raw CRLF hash and changed runtime are rejected by the retained hash-only policy', async () => {
  const html = await renderVariant('lf');
  const wrong = wrongHashReport(html), runtime = runtimeOf(wrong);
  assert.ok(runtime.includes('\r\n'));
  assert.equal(allowedHash(wrong), digest(runtime));
  assert.notEqual(allowedHash(wrong), digest(browserText(runtime)), 'old Windows output must fail the browser hash');
  assert.notEqual(allowedHash(html), digest(runtimeOf(html) + '\nglobalThis.reportTampered = true;'));
});
