import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { CodeGraph } from './model.js';
import { createProjectMapApi } from './project-map.js';
import { createFeatureMapApi } from './feature-map.js';
import { resolutionSummary } from './diagnostics.js';

/** Prevent repository text from breaking out of a non-executable JSON script. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}
export function renderHtml(graph: CodeGraph, features?: unknown): string {
  const css = ['style.css', 'project-map.css', 'feature-map.css'].map(name =>
    fs.readFileSync(new URL('../viewer/' + name, import.meta.url), 'utf8')).join('\n');
  const ui = fs.readFileSync(new URL('../viewer/project-map-view.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../viewer/app.js', import.meta.url), 'utf8');
  const featureApi = createFeatureMapApi();
  const featureData = features === undefined ? null : featureApi.validate(features);
  if (featureData) featureApi.assess(graph, featureData);
  const featureUi = fs.readFileSync(new URL('../viewer/feature-map-view.js', import.meta.url), 'utf8');
  const script = `(() => { const FeatureMap = (${createFeatureMapApi.toString()})();\n${featureUi}\nconst ProjectMap = (${createProjectMapApi.toString()})();\n${ui}\n${app}\n})();`;
  const template = fs.readFileSync(new URL('../viewer/body.html', import.meta.url), 'utf8');
  const digest = createHash('sha256').update(script).digest('base64');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>RepoGraphia · Code Explorer</title><style>${css}</style></head><body>${template}
<script id="graph-data" type="application/json">${safeJson(graph)}</script>
<script id="feature-data" type="application/json">${safeJson(featureData)}</script>
<script id="resolution-data" type="application/json">${safeJson(resolutionSummary(graph))}</script><script>${script}</script></body></html>`;
}
