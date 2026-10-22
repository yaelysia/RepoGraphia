import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { CodeGraph } from './model.js';
import { createProjectMapApi } from './project-map.js';
import { createFeatureMigrationApi } from './feature-migration.js';
import { createFeatureSceneApi } from './feature-scene.js';
import { createFeatureMapApi } from './feature-map.js';
import { resolutionSummary } from './diagnostics.js';

/** Prevent repository text from breaking out of a non-executable JSON script. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}
export interface WorkspaceRenderOptions {
  workspace?: { snapshot: string; featureDigest: string | null; readOnly?: boolean };
}
export function renderHtml(graph: CodeGraph, features?: unknown, options: WorkspaceRenderOptions = {}): string {
  if (options.workspace && (options.workspace.snapshot !== graph.project.snapshot ||
      options.workspace.featureDigest !== null && !/^[a-f0-9]{64}$/.test(options.workspace.featureDigest)))
    throw new Error('Workspace report metadata does not match its pinned graph');
  const css = ['style.css', 'project-map.css', 'feature-map.css', 'feature-workbench.css', 'workbench-shell.css'].map(name =>
    fs.readFileSync(new URL('../viewer/' + name, import.meta.url), 'utf8')).join('\n');
  const ui = fs.readFileSync(new URL('../viewer/project-map-view.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../viewer/app.js', import.meta.url), 'utf8');
  const featureApi = createFeatureMapApi();
  const featureData = features === undefined ? null : featureApi.validate(features);
  if (featureData) featureApi.assess(graph, featureData);
  const featureUi = fs.readFileSync(new URL('../viewer/feature-map-view.js', import.meta.url), 'utf8');
  const sceneUi = fs.readFileSync(new URL('../viewer/feature-scene-view.js', import.meta.url), 'utf8');
  const workbenchUi = fs.readFileSync(new URL('../viewer/feature-workbench-view.js', import.meta.url), 'utf8');
  const shellUi = fs.readFileSync(new URL('../viewer/workbench-shell-view.js', import.meta.url), 'utf8');
  const migrationUi = fs.readFileSync(new URL('../viewer/feature-migration-view.js', import.meta.url), 'utf8');
  const bridgeUi = options.workspace ? fs.readFileSync(new URL('../viewer/workspace-bridge.js', import.meta.url), 'utf8') : '';
  // HTML parsing normalizes CRLF and lone CR before CSP hashes inline script text.
  // Hash and embed the same normalized runtime, including factory toString() output.
  const script = `(() => { const FeatureMap = (${createFeatureMapApi.toString()})();\nconst FeatureMigration = (${createFeatureMigrationApi.toString()})(FeatureMap);\n${migrationUi}\nconst FeatureScene = (${createFeatureSceneApi.toString()})();\n${sceneUi}\n${workbenchUi}\n${featureUi}\nconst ProjectMap = (${createProjectMapApi.toString()})();\n${ui}\n${shellUi}\n${bridgeUi}\n${app}\ndocument.getElementById('viewer-startup')?.remove();\n})();`.replace(/\r\n?/g, '\n');
  const template = fs.readFileSync(new URL('../viewer/body.html', import.meta.url), 'utf8');
  const digest = createHash('sha256').update(script).digest('base64');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>RepoGraphia · Code Explorer</title><style>${css}${options.workspace ? '\nbody.workspace-embedded .topbar .brand { display:none; } body.workspace-embedded .topbar { height:60px; } body.workspace-embedded .workspace { min-height:480px; height:calc(100dvh - 156px); } @media(max-width:736px){body.workspace-embedded .topbar{height:104px;grid-template-columns:1fr;grid-template-rows:36px 36px}body.workspace-embedded .primary-modes{grid-column:1;grid-row:1;justify-self:start}body.workspace-embedded .workspace{height:calc(100dvh - 200px)}}' : ''}</style></head><body class="workbench${options.workspace ? ' workspace-embedded' : ''}" data-view="project"><p id="viewer-startup" class="callout" role="status">正在加载代码地图。若此提示一直显示且地图为空，页面脚本未成功启动；请更新 RepoGraphia、重新构建并生成新报告。无需关闭浏览器安全设置。</p>${template}
<script id="graph-data" type="application/json">${safeJson(graph)}</script>
<script id="feature-data" type="application/json">${safeJson(featureData)}</script>
${options.workspace ? '<script id="workspace-data" type="application/json">' + safeJson(options.workspace) + '</script>' : ''}
<script id="resolution-data" type="application/json">${safeJson(resolutionSummary(graph))}</script><script>${script}</script></body></html>`;
}
