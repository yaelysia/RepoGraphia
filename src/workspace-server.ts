import http from 'node:http';
import fs from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ContinuousWorkspace, WorkspaceError } from './workspace.js';
import { compareWorkspaceGraphs } from './workspace-diff.js';
import { renderHtml } from './report.js';

const bodyLimit = 16 * 1024 * 1024;
const noCache = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const parentPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
interface ReportTicket { snapshot: string; featureDigest: string | null; readOnly: boolean; expiresAt: number }

async function jsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new WorkspaceError('Content-Type must be application/json', 415);
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > bodyLimit) throw new WorkspaceError('Request is too large', 413);
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new WorkspaceError('Invalid JSON'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new WorkspaceError('Expected a JSON object');
  return value as Record<string, unknown>;
}

/** The only network service is bound to IPv4 loopback; its token never enters report frames. */
export async function startWorkspaceServer(workspace: ContinuousWorkspace, options: { port?: number; start?: boolean } = {}) {
  const token = randomBytes(32).toString('hex');
  const tickets = new Map<string, ReportTicket>();
  let origin = '';
  const json = (response: http.ServerResponse, value: unknown, code = 200) => {
    response.writeHead(code, { ...noCache, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const send = (response: http.ServerResponse, content: string, type: string, headers: Record<string, string> = {}) => {
    response.writeHead(200, { ...noCache, 'Content-Type': type, ...headers }); response.end(content);
  };
  const authenticated = (request: http.IncomingMessage) => {
    const provided = request.headers['x-repographia-token'];
    if (typeof provided !== 'string') return false;
    const bytes = Buffer.from(provided), expected = Buffer.from(token);
    return bytes.length === expected.length && timingSafeEqual(bytes, expected);
  };
  const server = http.createServer((request, response) => {
    void (async () => {
      if (request.headers.host !== new URL(origin).host) throw new WorkspaceError('Invalid local host', 403);
      if (request.headers.origin && request.headers.origin !== origin) throw new WorkspaceError('Cross-origin requests are not allowed', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new WorkspaceError('Cross-site requests are not allowed', 403);
      const url = new URL(request.url ?? '/', origin), method = request.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/') {
        send(response, fs.readFileSync(new URL('../viewer/workspace.html', import.meta.url), 'utf8'), 'text/html; charset=utf-8', { 'Content-Security-Policy': parentPolicy }); return;
      }
      if (method === 'GET' && ['/workspace.js', '/workspace.css'].includes(url.pathname)) {
        send(response, fs.readFileSync(new URL('../viewer' + url.pathname, import.meta.url), 'utf8'), url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'); return;
      }
      if (method === 'GET' && url.pathname.startsWith('/report/')) {
        const ticket = tickets.get(url.pathname.slice('/report/'.length));
        if (!ticket || ticket.expiresAt < Date.now()) throw new WorkspaceError('Report link expired; reopen this version in the workspace', 404);
        const graph = workspace.getGraph(ticket.snapshot), features = workspace.getFeatures(ticket.featureDigest);
        send(response, renderHtml(graph, features, { workspace: { snapshot: ticket.snapshot, featureDigest: ticket.featureDigest, readOnly: ticket.readOnly } }), 'text/html; charset=utf-8', { 'Content-Security-Policy': "frame-ancestors 'self'" }); return;
      }
      if (!url.pathname.startsWith('/api/')) throw new WorkspaceError('Not found', 404);
      if (!authenticated(request)) throw new WorkspaceError('Open the complete workspace URL printed in the terminal', 401);
      if (method === 'GET' && url.pathname === '/api/state') { json(response, workspace.state()); return; }
      if (method === 'GET' && ['/api/report', '/api/export', '/api/graph'].includes(url.pathname)) {
        const snapshot = url.searchParams.get('snapshot') ?? workspace.state().latestSnapshot;
        if (!snapshot) throw new WorkspaceError('The first code version is still being prepared', 409);
        const graph = workspace.getGraph(snapshot);
        if (url.pathname === '/api/graph') { json(response, graph); return; }
        const selectedDigest = url.searchParams.get('featureDigest');
        const featureDigest = url.searchParams.has('featureDigest') ? selectedDigest === 'none' ? null : selectedDigest || null : workspace.featureDigest;
        const features = workspace.getFeatures(featureDigest);
        if (url.pathname === '/api/export') {
          send(response, renderHtml(graph, features), 'text/html; charset=utf-8', { 'Content-Disposition': `attachment; filename="repographia-${snapshot.slice(0, 12)}.html"` }); return;
        }
        const ticket = randomBytes(24).toString('hex');
        for (const [key, value] of tickets) if (value.expiresAt < Date.now()) tickets.delete(key);
        while (tickets.size >= 64) tickets.delete(tickets.keys().next().value!);
        const readOnly = url.searchParams.get('readOnly') === '1' || featureDigest !== workspace.featureDigest;
        tickets.set(ticket, { snapshot, featureDigest, readOnly, expiresAt: Date.now() + 60 * 60 * 1000 });
        json(response, { snapshot, featureDigest, readOnly, url: `/report/${ticket}` }); return;
      }
      if (method === 'GET' && url.pathname === '/api/diff') {
        const task = workspace.getTask(url.searchParams.get('task') ?? '');
        const snapshot = url.searchParams.get('snapshot') ?? workspace.state().latestSnapshot;
        if (!snapshot) throw new WorkspaceError('The first code version is still being prepared', 409);
        json(response, compareWorkspaceGraphs(workspace.getGraph(task.snapshot), workspace.getGraph(snapshot))); return;
      }
      if (method === 'POST' && url.pathname === '/api/refresh') {
        await jsonBody(request); void workspace.refresh().catch(() => undefined); json(response, { queued: true }, 202); return;
      }
      if (method === 'POST' && url.pathname === '/api/baseline') {
        const body = await jsonBody(request);
        if (typeof body.title !== 'string' || !(body.expectedFeatureDigest === null || typeof body.expectedFeatureDigest === 'string')) throw new WorkspaceError('Expected a title and saved annotation version');
        json(response, { task: await workspace.beginTask(body.title, body.expectedFeatureDigest) }, 201); return;
      }
      if (method === 'PUT' && url.pathname === '/api/features') {
        const body = await jsonBody(request);
        if (!(body.expectedDigest === null || typeof body.expectedDigest === 'string')) throw new WorkspaceError('Expected the saved annotation version');
        json(response, { feature: workspace.saveFeatures(body.document, body.expectedDigest) }); return;
      }
      if (method === 'PUT' && url.pathname === '/api/view') {
        const body = await jsonBody(request);
        if (!(body.snapshot === null || typeof body.snapshot === 'string') || !(body.taskId === null || typeof body.taskId === 'string') ||
          body.featureDigest !== undefined && body.featureDigest !== null && typeof body.featureDigest !== 'string' ||
          body.readOnly !== undefined && typeof body.readOnly !== 'boolean') throw new WorkspaceError('Invalid saved view');
        workspace.saveView({ snapshot: body.snapshot, taskId: body.taskId,
          ...(body.featureDigest === undefined ? {} : { featureDigest: body.featureDigest as string | null }),
          ...(body.readOnly === undefined ? {} : { readOnly: body.readOnly as boolean }) }); json(response, { saved: true }); return;
      }
      throw new WorkspaceError('Unknown operation', 404);
    })().catch(error => {
      if (response.headersSent || response.destroyed) { response.end(); return; }
      json(response, { error: error instanceof Error ? error.message : String(error) }, error instanceof WorkspaceError ? error.statusCode : 500);
    });
  });
  server.requestTimeout = 210_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to determine local workspace address');
  origin = `http://127.0.0.1:${address.port}`;
  if (options.start !== false) workspace.start();
  return { server, origin, token, url: `${origin}/#token=${token}`, async close() {
    await workspace.close(); tickets.clear();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
  } };
}
