import { createHash } from 'node:crypto';
import type { CodeGraph, CodeNode, Location, Relation, Status } from './model.js';

export interface WorkspaceGraphVersion {
  snapshot: string; createdAt: string; analysisRevision: number | null; compilerVersion: string; config: string | null;
}
export interface WorkspaceFileVersion {
  snapshot: string; hash: string; lines: number; source?: string; sourceTruncated: boolean;
  declarations: number; relationsByStatus: Record<Status, number>;
}
export type WorkspaceNodeRef = CodeNode & { snapshot: string };
export type WorkspaceRelationRef = Relation & { snapshot: string };
/** Unmatched records, not proof that a function or runtime behavior was added/deleted. */
export interface WorkspaceRecordChanges<T> {
  added: number; removed: number; unchanged: number; before: T[]; after: T[]; truncated: boolean;
}
export interface WorkspaceDiffLine {
  kind: 'context' | 'added' | 'removed'; beforeLine: number | null; afterLine: number | null;
  text: string; textTruncated?: boolean;
}
export interface WorkspaceLineDiff {
  available: boolean; reason?: string; truncated: boolean; lines: WorkspaceDiffLine[];
  omittedBeforeLines: number; omittedAfterLines: number;
}
export interface WorkspaceFileChange {
  path: string; kind: 'added' | 'removed' | 'modified' | 'analysis';
  before: WorkspaceFileVersion | null; after: WorkspaceFileVersion | null;
  declarations: WorkspaceRecordChanges<WorkspaceNodeRef>;
  relations: WorkspaceRecordChanges<WorkspaceRelationRef>;
  diff: WorkspaceLineDiff;
}
export interface WorkspaceGraphComparison {
  comparisonVersion: 1;
  before: WorkspaceGraphVersion; after: WorkspaceGraphVersion; inputSnapshotChanged: boolean;
  summary: { added: number; removed: number; modified: number; analysisChanged: number; unchanged: number };
  files: WorkspaceFileChange[]; contractChanges: string[];
  scope: { before: CodeGraph['coverage']; after: CodeGraph['coverage'] };
  diagnostics: { before: CodeGraph['diagnostics']; after: CodeGraph['diagnostics']; changed: boolean };
  limits: { recordsPerSide: number; sourceCharactersPerSide: number; diffLinesPerSide: number; diffCharacters: number };
  limitations: string[];
}

const LIMITS = { recordsPerSide: 40, sourceCharactersPerSide: 32768, diffLinesPerSide: 120, diffCharacters: 32768 };
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
};
const version = (graph: CodeGraph): WorkspaceGraphVersion => ({ snapshot: graph.project.snapshot,
  createdAt: graph.project.createdAt, analysisRevision: graph.project.analysisRevision ?? null,
  compilerVersion: graph.project.compilerVersion, config: graph.project.config });

function index(graph: CodeGraph) {
  const files = new Map(graph.files.map(file => [file.path, file]));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const byFile = new Map<string, CodeNode[]>(), relations = new Map<string, Relation[]>();
  for (const node of graph.nodes) {
    if (node.kind === 'file') continue;
    const list = byFile.get(node.location.file) ?? []; list.push(node); byFile.set(node.location.file, list);
  }
  for (const relation of graph.relations) {
    const list = relations.get(relation.evidence.location.file) ?? []; list.push(relation); relations.set(relation.evidence.location.file, list);
  }
  for (const list of byFile.values()) list.sort((a,b) => (a.location.end-a.location.start)-(b.location.end-b.location.start));
  return { graph, files, nodes, byFile, relations, keys: new Map<string,string>() };
}
type GraphIndex = ReturnType<typeof index>;
const declarationLabel = (name:string):string => /^<callback:\d+:\d+>$/.test(name) ? '<callback>' : name;

function ancestry(data: GraphIndex, node: CodeNode): { kind: string; name: string }[] {
  const result: { kind: string; name: string }[] = [], seen = new Set<string>();
  let parent = node.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent); const item = data.nodes.get(parent); if (!item || item.kind === 'file') break;
    result.push({ kind: item.kind, name: declarationLabel(item.name) }); parent = item.parent;
  }
  return result.reverse();
}

/** Compare exact source records. These temporary keys are never written back as entity identities. */
function assignKeys(before: GraphIndex, after: GraphIndex): Set<string> {
  const unchangedFiles = new Set([...before.files].filter(([file, old]) => old.hash === after.files.get(file)?.hash).map(([file]) => file));
  const signatures = (data: GraphIndex, side: string) => {
    const groups = new Map<string, string[]>();
    for (const node of data.nodes.values()) {
      if (node.kind === 'file') { data.keys.set(node.id, 'file:' + node.location.file); continue; }
      const { file, start, end } = node.location, source = data.files.get(file)?.source;
      let signature: string | undefined;
      if (unchangedFiles.has(file)) signature = canonical({ file, start, end, kind: node.kind, name: declarationLabel(node.name),
        hasBody: node.hasBody, parents: ancestry(data,node) });
      else if (source !== undefined && start >= 0 && end >= start && end <= source.length) {
        // Full declaration text, not its truncated snippet or its name, must match uniquely.
        signature = canonical({ file, kind: node.kind, name: declarationLabel(node.name), hasBody: node.hasBody,
          parents: ancestry(data,node), text: digest(source.slice(start,end)), length: end-start });
      }
      data.keys.set(node.id, side + ':' + node.id);
      if (signature !== undefined) {
        const key = digest(signature), list = groups.get(key) ?? []; list.push(node.id); groups.set(key,list);
      }
    }
    return groups;
  };
  const oldGroups = signatures(before,'before'), newGroups = signatures(after,'after');
  for (const [key, old] of oldGroups) {
    const current = newGroups.get(key);
    if (old.length === 1 && current?.length === 1) {
      before.keys.set(old[0]!, 'match:' + key); after.keys.set(current[0]!, 'match:' + key);
    }
  }
  return unchangedFiles;
}

function relationKey(data: GraphIndex, unchangedFiles: Set<string>) {
  const points = new Map<string, unknown>();
  const node = (id: string) => data.keys.get(id) ?? 'missing-node:' + id;
  const point = (location: Location, fileHash: string) => {
    const cacheKey = canonical([location.file,location.start,location.end,fileHash]);
    if (points.has(cacheKey)) return points.get(cacheKey);
    let result: unknown;
    if (unchangedFiles.has(location.file)) result = { file:location.file, start:location.start, end:location.end, fileHash };
    else {
      const owner = data.byFile.get(location.file)?.find(item => data.keys.get(item.id)?.startsWith('match:') &&
        item.location.start <= location.start && item.location.end >= location.end);
      result = owner ? { owner:node(owner.id), start:location.start-owner.location.start, end:location.end-owner.location.start }
        : { file:location.file, start:location.start, end:location.end, fileHash };
    }
    points.set(cacheKey,result); return result;
  };
  return (relation: Relation): string => {
    const evidence = relation.evidence, origins = evidence.valueOrigins;
    const originPoint = (p: { location: Location; fileHash: string; excerpt: string }) => ({
      location:point(p.location,p.fileHash), excerpt:p.excerpt });
    return digest(canonical({ from:node(relation.from), targets:relation.targets.map(node).sort(),
      kind:relation.kind, status:relation.status, targetLabel:relation.targetLabel, typeOnly:relation.typeOnly,
      evidence:{ location:point(evidence.location,evidence.fileHash), rule:evidence.rule,
        explanation:evidence.explanation, reason:evidence.reason, excerpt:evidence.excerpt,
        declaration:evidence.declaration ? point(evidence.declaration.location,evidence.declaration.fileHash) : undefined,
        valueOrigins:origins ? { complete:origins.complete, truncated:origins.truncated, visited:origins.visited, limits:origins.limits,
          sources:origins.sources.map(source => ({ target:node(source.target), path:source.path.map(p => ({...originPoint(p),kind:p.kind})) })).sort((a,b)=>canonical(a).localeCompare(canonical(b))),
          stops:origins.stops.map(p => ({...originPoint(p),reason:p.reason})).sort((a,b)=>canonical(a).localeCompare(canonical(b))) } : undefined } }));
  };
}

function records<T>(before: readonly T[], after: readonly T[], beforeKey:(item:T)=>string, afterKey:(item:T)=>string,
  oldSnapshot:string, newSnapshot:string): WorkspaceRecordChanges<T & {snapshot:string}> {
  const remaining = new Map<string, number[]>();
  after.forEach((item,i) => { const key=afterKey(item), list=remaining.get(key) ?? [];list.push(i);remaining.set(key,list); });
  const used = new Set<number>(), removed:T[] = [];
  for (const item of before) {
    const match = remaining.get(beforeKey(item))?.pop();
    if (match === undefined) removed.push(item); else used.add(match);
  }
  const added = after.filter((_,i)=>!used.has(i));
  return { added:added.length, removed:removed.length, unchanged:used.size,
    before:removed.slice(0,LIMITS.recordsPerSide).map(item=>({...structuredClone(item),snapshot:oldSnapshot})),
    after:added.slice(0,LIMITS.recordsPerSide).map(item=>({...structuredClone(item),snapshot:newSnapshot})),
    truncated:removed.length>LIMITS.recordsPerSide || added.length>LIMITS.recordsPerSide };
}

function fileVersion(data: GraphIndex, file: string): WorkspaceFileVersion | null {
  const input=data.files.get(file);if(!input)return null;
  const relationsByStatus:Record<Status,number>={bound:0,candidate:0,unresolved:0,external:0};
  for(const relation of data.relations.get(file) ?? []) relationsByStatus[relation.status]++;
  return { snapshot:data.graph.project.snapshot, hash:input.hash, lines:input.lines,
    ...(input.source===undefined?{}:{source:input.source.slice(0,LIMITS.sourceCharactersPerSide)}),
    sourceTruncated:input.source!==undefined&&input.source.length>LIMITS.sourceCharactersPerSide,
    declarations:data.byFile.get(file)?.length ?? 0, relationsByStatus };
}

/** Bounded changed-region display: no claim to be a minimal edit script. */
function lineDiff(before:string|undefined,after:string|undefined,kind:WorkspaceFileChange['kind']):WorkspaceLineDiff {
  const result:WorkspaceLineDiff={available:true,truncated:false,lines:[],omittedBeforeLines:0,omittedAfterLines:0};
  if(kind==='analysis')return {...result,reason:'源码内容未变；静态分析记录发生变化。'};
  if(before===undefined&&kind!=='added' || after===undefined&&kind!=='removed')
    return {...result,available:false,reason:'该快照未保存完整源码，可通过前后版本查看已有声明与关系证据。'};
  const old=before===undefined?[]:before.replace(/\r\n?/g,'\n').split('\n');
  const current=after===undefined?[]:after.replace(/\r\n?/g,'\n').split('\n');
  let prefix=0,suffix=0;
  while(prefix<old.length&&prefix<current.length&&old[prefix]===current[prefix])prefix++;
  while(suffix<old.length-prefix&&suffix<current.length-prefix&&old[old.length-1-suffix]===current[current.length-1-suffix])suffix++;
  if(prefix===old.length&&prefix===current.length)return {...result,reason:'可见行内容相同，文件哈希变化可能来自换行形式；请查看原始快照。'};
  const context=3,oldEnd=old.length-suffix,newEnd=current.length-suffix;
  let remaining=LIMITS.diffCharacters;
  const add=(line:WorkspaceDiffLine)=>{
    if(remaining<=0){result.truncated=true;if(line.kind!=='added')result.omittedBeforeLines++;if(line.kind!=='removed')result.omittedAfterLines++;return;}
    const limit=Math.min(remaining,4096);
    if(line.text.length>limit){line={...line,text:line.text.slice(0,limit),textTruncated:true};result.truncated=true;}
    remaining-=line.text.length;result.lines.push(line);
  };
  for(let i=Math.max(0,prefix-context);i<prefix;i++)add({kind:'context',beforeLine:i+1,afterLine:i+1,text:old[i]!});
  const oldBudget=Math.min(oldEnd-prefix,LIMITS.diffLinesPerSide),newBudget=Math.min(newEnd-prefix,LIMITS.diffLinesPerSide);
  // Divide the character budget between sides so a long old line cannot hide the new text entirely.
  const firstBudget=remaining;remaining=Math.floor(firstBudget/2);
  for(let i=prefix;i<prefix+oldBudget;i++)add({kind:'removed',beforeLine:i+1,afterLine:null,text:old[i]!});
  remaining+=firstBudget-Math.floor(firstBudget/2);
  for(let i=prefix;i<prefix+newBudget;i++)add({kind:'added',beforeLine:null,afterLine:i+1,text:current[i]!});
  result.omittedBeforeLines+=oldEnd-prefix-oldBudget;result.omittedAfterLines+=newEnd-prefix-newBudget;
  for(let i=0;i<Math.min(suffix,context);i++)add({kind:'context',beforeLine:oldEnd+i+1,afterLine:newEnd+i+1,text:old[oldEnd+i]!});
  result.truncated ||= result.omittedBeforeLines>0||result.omittedAfterLines>0;
  return result;
}

/** Compare observed source and static records; never attribute an author or infer runtime behavior. */
export function compareWorkspaceGraphs(before:CodeGraph,after:CodeGraph):WorkspaceGraphComparison {
  const old=index(before),current=index(after),unchangedFiles=assignKeys(old,current);
  const oldRelationKey=relationKey(old,unchangedFiles),newRelationKey=relationKey(current,unchangedFiles);
  const files:WorkspaceFileChange[]=[],summary={added:0,removed:0,modified:0,analysisChanged:0,unchanged:0};
  for(const file of [...new Set([...old.files.keys(),...current.files.keys()])].sort()) {
    const left=old.files.get(file),right=current.files.get(file);
    const declarations=records(old.byFile.get(file)??[],current.byFile.get(file)??[],
      node=>old.keys.get(node.id)!,node=>current.keys.get(node.id)!,before.project.snapshot,after.project.snapshot);
    const relations=records(old.relations.get(file)??[],current.relations.get(file)??[],oldRelationKey,newRelationKey,before.project.snapshot,after.project.snapshot);
    const kind=!left?'added':!right?'removed':left.hash!==right.hash?'modified':
      declarations.added||declarations.removed||relations.added||relations.removed?'analysis':null;
    if(!kind){summary.unchanged++;continue;}
    if(kind==='analysis')summary.analysisChanged++;else summary[kind]++;
    files.push({path:file,kind,before:fileVersion(old,file),after:fileVersion(current,file),declarations,relations,
      diff:lineDiff(left?.source,right?.source,kind)});
  }
  const contractChanges:string[]=[];
  if((before.project.analysisRevision??null)!==(after.project.analysisRevision??null))contractChanges.push('分析规则版本变化');
  if(before.project.compilerVersion!==after.project.compilerVersion)contractChanges.push('编译器版本变化');
  if(before.project.config!==after.project.config)contractChanges.push('所选配置变化');
  if(before.project.name!==after.project.name)contractChanges.push('项目名称变化');
  return {comparisonVersion:1,before:version(before),after:version(after),inputSnapshotChanged:before.project.snapshot!==after.project.snapshot,
    summary,files,contractChanges,scope:{before:structuredClone(before.coverage),after:structuredClone(after.coverage)},
    diagnostics:{before:structuredClone(before.diagnostics),after:structuredClone(after.diagnostics),
      changed:canonical(before.diagnostics.map(canonical).sort())!==canonical(after.diagnostics.map(canonical).sort())},limits:{...LIMITS},
    limitations:['新增与移出指代码索引范围，移出不证明磁盘文件已删除；未索引区域另见分析范围。',
      '声明及关系数量是前后未匹配的静态记录，不代表功能增删、执行次数或正确率。',
      '同文件内仅比较精确位置或唯一的完整声明文本及词法上下文；不按名称猜测，不追踪改名，也不建立跨版本实体身份。',
      '行变化展示共同前后文之间的区域，未计算最小编辑序列；展示预算截断时可打开对应完整快照。',
      '代码事实、Agent 解释、人工审阅和测试验证分别记录；本比较不判断运行时行为或任务完成。']};
}
