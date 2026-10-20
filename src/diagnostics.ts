import type { CodeGraph, Relation, Status, UnresolvedReason } from './model.js';
import { CALL_KINDS } from './model.js';

/** Categories describe available evidence, not runtime failures or guaranteed fixes. */
export const REASONS: Record<UnresolvedReason | 'unclassified', { title: string; explanation: string }> = {
  'parameter-value': { title: '参数传入的函数', explanation: '调用值来自函数参数；当前证据未提供可导航的实现目标。若附值来源追踪，请查看停止原因与预算边界。' },
  'binding-pattern': { title: '解构得到的函数值', explanation: '编译器绑定到解构声明；当前证据未提供可导航的实现目标。不能仅凭返回类型推断函数值；若附来源追踪，请查看停止原因。' },
  'mutable-value': { title: '可变变量或其别名', explanation: '声明允许重新赋值；不能把初始化值当作该调用点的实际目标。' },
  'property-value': { title: '属性中的未知函数值', explanation: '只有属性声明或类型，没有可导航的函数初始化体；不按同名函数猜测。' },
  'returned-callable': { title: '调用或访问器返回的函数', explanation: '值来自调用、await 或 getter；返回值传播尚未实现，不把生产者当作被调用函数。' },
  'out-of-scope-declaration': { title: '已找到声明，实现未索引', explanation: '存在仓库内编译器声明证据，但实现不在选定索引中。不能仅按相似文件名关联实现。' },
  'dynamic-import': { title: '模块加载语法', explanation: 'import() 是模块加载边界，不是普通函数声明；独立模块关系可能已有目标。' },
  'missing-symbol': { title: '没有可绑定的符号', explanation: '编译器没有给出可用符号；可能涉及缺失类型或动态值，原因没有进一步证实。' },
  'unmapped-declaration': { title: '声明尚未映射到实现', explanation: '编译器有声明，但当前规则未得到函数实现节点；保留未解析，不穷举猜测。' },
  'complex-expression': { title: '复杂或循环值表达式', explanation: '表达式超出当前有限别名解析；没有全程序值流或路径可行性证明。' },
  'unclassified': { title: '未分类（旧报告或未知原因）', explanation: '没有当前可识别的结构化原因，不能从名称或旧解释反推新结论。请重新分析。' },
};
export type DiagnosticReason = keyof typeof REASONS;
export const reasonOf = (edge: Relation): DiagnosticReason =>
  edge.evidence.reason && Object.hasOwn(REASONS, edge.evidence.reason) ? edge.evidence.reason : 'unclassified';
const callsites = (graph: CodeGraph) => graph.relations.filter(e => CALL_KINDS.has(e.kind));
const testPath = (file: string) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
const order = (a: Relation, b: Relation) => Number(testPath(a.evidence.location.file)) - Number(testPath(b.evidence.location.file)) ||
  a.evidence.location.file.localeCompare(b.evidence.location.file) || a.evidence.location.start - b.evidence.location.start;

export function resolutionSummary(graph: CodeGraph, examplesPerGroup = 3) {
  if (!Number.isInteger(examplesPerGroup) || examplesPerGroup < 0 || examplesPerGroup > 20)
    throw new Error('examplesPerGroup must be 0..20');
  const calls = callsites(graph), counts: Record<Status, number> = { bound: 0, candidate: 0, unresolved: 0, external: 0 };
  const grouped = new Map<DiagnosticReason, Relation[]>();
  for (const e of calls) {
    counts[e.status]++;
    if (e.status !== 'unresolved') continue;
    const reason = reasonOf(e), rows = grouped.get(reason) ?? [];
    rows.push(e); grouped.set(reason, rows);
  }
  return { snapshot: graph.project.snapshot, analysisRevision: graph.project.analysisRevision ?? null,
    scope: 'Selected program, including test paths. Counts are not accuracy or runtime coverage.',
    totalCallsites: calls.length, counts,
    groups: [...grouped].map(([reason, rows]) => ({ reason, ...REASONS[reason], count: rows.length,
      testPathCount: rows.filter(e => testPath(e.evidence.location.file)).length,
      examples: rows.sort(order).slice(0, examplesPerGroup).map(e => e.id),
      omittedExamples: Math.max(0, rows.length - examplesPerGroup),
    })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

export function diagnosticRecords(graph: CodeGraph, reason: string, options: { offset?: number; limit?: number } = {}) {
  if (!Object.hasOwn(REASONS, reason)) throw new Error('Unknown diagnostic reason: ' + reason);
  const offset = options.offset ?? 0, limit = options.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('offset must be a non-negative safe integer and limit must be 1..100');
  const rows = callsites(graph).filter(e => e.status === 'unresolved' && reasonOf(e) === reason).sort(order);
  return { snapshot: graph.project.snapshot, reason, total: rows.length,
    relations: rows.slice(offset, offset + limit),
    boundary: { offset, limit, returned: Math.max(0, Math.min(limit, rows.length - offset)),
      hasMore: offset + limit < rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
      explanation: 'Only unresolved explicit call kinds in this snapshot and category. Absence is not proof of runtime absence.' } };
}
