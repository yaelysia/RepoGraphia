import type { DevelopmentIntent, DevelopmentReviewReport, DevelopmentReviewVersion } from './development-review.js';
import type { FeatureMap } from './feature-map.js';

/** These are declared local review records, not authenticated identities or executed checks. */
export interface DevelopmentTarget { kind: 'round' | 'feature' | 'file' | 'criterion'; id: string }
export type DevelopmentRecordInput =
  | { kind: 'review'; target: DevelopmentTarget; decision: 'reviewed' | 'needs-work' | 'unreviewed'; actor: string; reason: string }
  | { kind: 'verification'; target: DevelopmentTarget; status: 'passed' | 'failed' | 'blocked' | 'not-run';
      source: 'manual' | 'agent'; author: string; actor: string; method: string; evidence: string }
  | { kind: 'note'; target: DevelopmentTarget; source: 'manual' | 'agent'; author: string; actor: string; text: string };
export type DevelopmentRecord = DevelopmentRecordInput & { id: string; comparisonDigest: string; sequence: number; at: string };
export interface DevelopmentReportMeta {
  comparisonDigest: string; storageDigest: string; taskId: string; createdAt: string;
  before: DevelopmentReviewVersion; after: DevelopmentReviewVersion;
}
export interface DevelopmentReviewState { schemaVersion: 1; reports: DevelopmentReportMeta[]; records: DevelopmentRecord[] }
export interface RecordDevelopmentReview {
  taskId: string; snapshot: string; featureDigest: string | null; comparisonDigest: string;
  expectedRevision: number; record: DevelopmentRecordInput;
}
export interface DevelopmentReviewResponse {
  report: DevelopmentReviewReport; revision: number; records: DevelopmentRecord[];
  history: (Omit<DevelopmentReportMeta, 'storageDigest'> & { recordCount: number })[];
  current: { writable: boolean; reasons: string[] };
}
export class DevelopmentReviewError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export const emptyDevelopmentReview = (): DevelopmentReviewState => ({ schemaVersion: 1, reports: [], records: [] });
const digest = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9-]{36}$/, id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const object = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const date = (value: unknown) => text(value, 40) && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

export function validDevelopmentIntent(value: unknown): value is DevelopmentIntent {
  if (!object(value, ['goal', 'author', 'source', 'featureIds', 'checks']) || !text(value.goal, 2000) ||
    !text(value.author, 200) || !['manual', 'agent'].includes(value.source as string) || !Array.isArray(value.featureIds) ||
    value.featureIds.length > 1000 || value.featureIds.some(item => !text(item, 200) || !id.test(item)) ||
    new Set(value.featureIds).size !== value.featureIds.length || !Array.isArray(value.checks) || value.checks.length > 50) return false;
  return value.checks.every(check => object(check, ['id', 'text']) && text(check.id, 200) && id.test(check.id) && text(check.text, 2000)) &&
    new Set(value.checks.map(check => check.id)).size === value.checks.length;
}

/** Freeze only explicitly selected feature IDs; a parent selection does not authorize or imply descendants. */
export function prepareDevelopmentIntent(value: unknown, features: FeatureMap | undefined): DevelopmentIntent {
  if (!validDevelopmentIntent(value)) throw new DevelopmentReviewError('开发目标、声明来源、功能范围或验收点格式无效');
  if (value.featureIds.some(id => !features?.features.some(feature => feature.id === id)))
    throw new DevelopmentReviewError('目标中含有起点标注不存在的功能，请核对后重试');
  return structuredClone(value);
}

function validTarget(value: unknown): value is DevelopmentTarget {
  return object(value, ['kind', 'id']) && ['round', 'feature', 'file', 'criterion'].includes(value.kind as string) && text(value.id, 4096);
}
export function validDevelopmentRecordInput(value: unknown): value is DevelopmentRecordInput {
  if (!value || typeof value !== 'object') return false;
  const row = value as DevelopmentRecordInput;
  if (!validTarget(row.target) || !text(row.actor, 200)) return false;
  if (row.kind === 'review') return object(row, ['kind', 'target', 'decision', 'actor', 'reason']) &&
    ['reviewed', 'needs-work', 'unreviewed'].includes(row.decision) && text(row.reason, 8000);
  if (!['manual', 'agent'].includes(row.source) || !text(row.author, 200)) return false;
  if (row.kind === 'verification') return object(row, ['kind', 'target', 'status', 'source', 'author', 'actor', 'method', 'evidence']) &&
    ['passed', 'failed', 'blocked', 'not-run'].includes(row.status) && text(row.method, 2000) && text(row.evidence, 12000);
  return row.kind === 'note' && object(row, ['kind', 'target', 'source', 'author', 'actor', 'text']) && text(row.text, 12000);
}
export function prepareDevelopmentRecord(value: unknown, report: DevelopmentReviewReport): DevelopmentRecordInput {
  if (!validDevelopmentRecordInput(value) || Buffer.byteLength(JSON.stringify(value)) > 32 * 1024)
    throw new DevelopmentReviewError('审阅记录格式无效或超过 32 KiB，请保留简要结论和证据摘录');
  const target = value.target;
  const exists = target.kind === 'round' ? target.id === report.task.id
    : target.kind === 'feature' ? report.features.some(feature => feature.id === target.id)
    : target.kind === 'file' ? report.code.files.some(file => file.path === target.id)
    : report.task.intent?.checks.some(check => check.id === target.id);
  if (!exists) throw new DevelopmentReviewError('审阅对象不属于正在查看的固定比较版本');
  return structuredClone(value);
}
export function validateDevelopmentRecordRequest(value: unknown): asserts value is RecordDevelopmentReview {
  if (!object(value, ['taskId', 'snapshot', 'featureDigest', 'comparisonDigest', 'expectedRevision', 'record']) ||
    !uuid.test(value.taskId as string) || !digest.test(value.snapshot as string) ||
    !(value.featureDigest === null || typeof value.featureDigest === 'string' && digest.test(value.featureDigest)) ||
    !digest.test(value.comparisonDigest as string) || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0)
    throw new DevelopmentReviewError('需要固定的任务、代码、标注、比较版本与审阅序号');
}
function validVersion(value: unknown): value is DevelopmentReviewVersion {
  return object(value, ['snapshot', 'featureDigest', 'featureRevision']) && digest.test(value.snapshot as string) &&
    (value.featureDigest === null ? value.featureRevision === null : typeof value.featureDigest === 'string' && digest.test(value.featureDigest) &&
      Number.isSafeInteger(value.featureRevision) && (value.featureRevision as number) >= 0);
}

/** Validate every append and sequence. Do not repair or migrate damaged review history. */
export function validDevelopmentReviewState(value: unknown): value is DevelopmentReviewState {
  if (!object(value, ['schemaVersion', 'reports', 'records']) || value.schemaVersion !== 1 ||
    !Array.isArray(value.reports) || !Array.isArray(value.records) || value.reports.length > 10000 || value.records.length > 100000) return false;
  const reports = new Set<string>(), ids = new Set<string>(), sequences = new Map<string, number>();
  for (const report of value.reports) {
    if (!object(report, ['comparisonDigest', 'storageDigest', 'taskId', 'createdAt', 'before', 'after']) ||
      !digest.test(report.comparisonDigest as string) || !digest.test(report.storageDigest as string) ||
      !uuid.test(report.taskId as string) || !date(report.createdAt) || !validVersion(report.before) || !validVersion(report.after) ||
      reports.has(report.comparisonDigest as string)) return false;
    reports.add(report.comparisonDigest as string);
  }
  for (const entry of value.records) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const { id: entryId, comparisonDigest, sequence, at, ...record } = entry as Record<string, unknown>;
    if (typeof entryId !== 'string' || !uuid.test(entryId) || ids.has(entryId) || typeof comparisonDigest !== 'string' ||
      !reports.has(comparisonDigest) || !date(at) || sequence !== (sequences.get(comparisonDigest) ?? 0) + 1 ||
      !validDevelopmentRecordInput(record) || Buffer.byteLength(JSON.stringify(record)) > 32 * 1024) return false;
    ids.add(entryId); sequences.set(comparisonDigest, sequence as number);
  }
  return true;
}
