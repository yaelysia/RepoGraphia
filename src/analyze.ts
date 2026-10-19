import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import type { CodeGraph, CodeNode, Evidence, Relation, RelationKind, Status, UnresolvedReason } from './model.js';
import { ANALYSIS_REVISION, CALL_KINDS } from './model.js';
import { loadProject, locate, normalize, hash, gitState, isSource, inside, fileKey, isDependency } from './project.js';

const executable = (n: ts.Node): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction |
  ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);
const named = (n: ts.Node): n is ts.NamedDeclaration => 'name' in n;
const transparent = (n: ts.Node): n is ts.ParenthesizedExpression | ts.AsExpression |
  ts.NonNullExpression | ts.TypeAssertion | ts.SatisfiesExpression =>
  ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) ||
  ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n);
function unwrap(n: ts.Node): ts.Node {
  while (transparent(n)) n = n.expression;
  return n;
}
/** A computed method/accessor name is evaluated outside that method's body. */
const inDefinitionContext = (node: ts.Node, child: ts.Node): boolean =>
  executable(node) && ts.isComputedPropertyName(child);
function label(n: ts.Node): string {
  if (named(n) && n.name) return n.name.getText();
  if (ts.isConstructorDeclaration(n)) return 'constructor';
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
    let value: ts.Node = n;
    while (value.parent && transparent(value.parent)) value = value.parent;
    const parent = value.parent;
    if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent))) return parent.name.getText();
    const p = n.getSourceFile().getLineAndCharacterOfPosition(n.getStart());
    return `<callback:${p.line + 1}:${p.character + 1}>`;
  }
  return '<anonymous>';
}

export function analyze(input: string, options: { project?: string; includeSource?: boolean } = {}): CodeGraph {
  const p = loadProject(input, options.project), checker = p.program.getTypeChecker();
  const nodes: CodeNode[] = [], relations: Relation[] = [];
  const ids = new Map<ts.Node, string>(), astById = new Map<string, ts.Node>(), bodies = new Map<string, CodeNode>();
  const hashes = new Map(p.sources.map(sf => [sf.fileName, hash(sf.text)]));
  const fileId = (sf: ts.SourceFile): string => 'file:' + normalize(path.relative(p.root, sf.fileName));
  const evidence = (node: ts.Node, rule: string, explanation: string): Evidence => ({
    rule, explanation, location: locate(node, p.root), excerpt: node.getText().slice(0, 1200),
    fileHash: hashes.get(node.getSourceFile().fileName)!,
  });
  const add = (owner: string, node: ts.Node, kind: RelationKind, targets: string[], status: Status,
    rule: string, explanation: string, targetLabel: string, typeOnly?: boolean) => {
    const loc = locate(node, p.root);
    const relation: Relation = { id: 'edge:' + hash(`${owner}:${kind}:${loc.start}:${loc.end}:${relations.length}`).slice(0, 20),
      from: owner, targets: [...new Set(targets)].sort(), kind, status, targetLabel,
      ...(typeOnly === undefined ? {} : { typeOnly }), evidence: evidence(node, rule, explanation) };
    relations.push(relation);
    return relation;
  };
  for (const sf of p.sources) {
    const id = fileId(sf);
    const rootNode: CodeNode = { id, name: normalize(path.relative(p.root, sf.fileName)), kind: 'file', parent: null,
      location: locate(sf, p.root), snippet: sf.text.slice(0, 900), hasBody: true };
    nodes.push(rootNode); bodies.set(id, rootNode); ids.set(sf, id);
    const visit = (node: ts.Node, parent: string) => {
      const enclosing = parent;
      let kind: CodeNode['kind'] | undefined;
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) kind = 'class';
      else if (ts.isInterfaceDeclaration(node)) kind = 'interface';
      else if (ts.isMethodSignature(node) || ts.isCallSignatureDeclaration(node)) kind = 'signature';
      else if (executable(node)) kind = !node.body ? 'signature' : ts.isConstructorDeclaration(node) ? 'constructor'
        : ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) ? 'method' : 'function';
      if (kind) {
        const loc = locate(node, p.root), id = 'node:' + hash(`${loc.file}:${kind}:${loc.start}:${loc.end}`).slice(0, 20);
        const item: CodeNode = { id, name: label(node), kind, parent, location: loc,
          snippet: node.getText().slice(0, 1400), hasBody: executable(node) && !!node.body };
        nodes.push(item); bodies.set(id, item); ids.set(node, id); astById.set(id, node); parent = id;
      }
      ts.forEachChild(node, child => visit(child, inDefinitionContext(node, child) ? enclosing : parent));
    };
    ts.forEachChild(sf, n => visit(n, id));
  }
  function unalias(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
    const seen = new Set<ts.Symbol>();
    while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
      seen.add(symbol); symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol;
  }
  function symbolDeclarations(node: ts.Node): readonly ts.Declaration[] {
    node = unwrap(node);
    return unalias(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node))?.declarations ?? [];
  }
  const outside = (d: ts.Declaration): boolean =>
    !inside(p.root, d.getSourceFile().fileName) || isDependency(d.getSourceFile().fileName);
  function declarations(node: ts.Node, seen = new Set<ts.Node>()): ts.Declaration[] {
    node = unwrap(node);
    if (seen.has(node)) return [];
    seen.add(node);
    if (ids.has(node) && !ts.isSourceFile(node)) return [node as ts.Declaration];
    const ds = symbolDeclarations(node);
    const expanded: ts.Declaration[] = [];
    for (const d of ds) {
      if ((ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d)) && d.initializer) {
        const next = unwrap(d.initializer);
        if (executable(next) || ts.isClassExpression(next)) expanded.push(next as ts.Declaration);
        else if (ts.isIdentifier(next) || ts.isPropertyAccessExpression(next) || ts.isElementAccessExpression(next)) expanded.push(...declarations(next, seen));
        else expanded.push(d);
      } else expanded.push(d);
    }
    const implementations = expanded.filter(d => executable(d) && !!d.body);
    return implementations.length ? implementations : expanded;
  }
  function indirectBinding(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    node = unwrap(node);
    if (seen.has(node)) return true;
    seen.add(node);
    return symbolDeclarations(node).some(d => {
      if (ts.isParameter(d) || ts.isBindingElement(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d) || ts.isPropertySignature(d)) return true;
      if (!ts.isVariableDeclaration(d)) return false;
      if (!(ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const)) return true;
      const value = d.initializer && unwrap(d.initializer);
      return !!value && (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value) ||
        ts.isIdentifier(value) && indirectBinding(value, seen));
    });
  }
  /** Describe observed declaration syntax, not a guessed runtime cause or fix. */
  function unresolvedReason(expr: ts.Node, ds: readonly ts.Declaration[], seen = new Set<ts.Node>()): UnresolvedReason {
    expr = unwrap(expr);
    if (seen.has(expr)) return 'complex-expression';
    seen.add(expr);
    if (expr.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic-import';
    const direct = symbolDeclarations(expr);
    if (direct.some(ts.isParameter)) return 'parameter-value';
    if (direct.some(ts.isBindingElement)) return 'binding-pattern';
    if (direct.some(ts.isGetAccessorDeclaration)) return 'returned-callable';
    if (ds.some(d => d.getSourceFile().isDeclarationFile && !outside(d))) return 'out-of-scope-declaration';
    for (const d of direct) if (ts.isVariableDeclaration(d)) {
      if (!(ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const)) return 'mutable-value';
      if (d.initializer) {
        const value = unwrap(d.initializer);
        if (ts.isCallExpression(value) || ts.isAwaitExpression(value)) return 'returned-callable';
        if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))
          return unresolvedReason(value, symbolDeclarations(value), seen);
      }
    }
    if (direct.some(d => ts.isPropertyDeclaration(d) || ts.isPropertySignature(d) || ts.isPropertyAssignment(d))) return 'property-value';
    if (ds.some(d => !outside(d) && !ids.has(d) && !p.sources.includes(d.getSourceFile()))) return 'out-of-scope-declaration';
    if (ts.isCallExpression(expr) || ts.isAwaitExpression(expr)) return 'returned-callable';
    if (!direct.length && !ds.length && !(ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr))) return 'complex-expression';
    return direct.length || ds.length ? 'unmapped-declaration' : 'missing-symbol';
  }
  function resolve(expr: ts.Node, signature?: ts.Signature): {
    targets: string[]; status: Status; rule: string; why: string;
    reason?: UnresolvedReason; declaration?: Evidence['declaration'];
  } {
    expr = unwrap(expr);
    const direct = symbolDeclarations(expr);
    let ds = declarations(expr);
    if (!ds.length && signature?.declaration) ds = [signature.declaration];
    // Reading a getter or an alias of it is not invoking the returned callable.
    if ([...direct, ...ds].some(ts.isGetAccessorDeclaration)) return { targets: [], status: 'unresolved',
      rule: 'accessor-return-value', reason: 'returned-callable',
      why: 'Property access uses a getter; its returned callable is not resolved. This call is not a direct call of the getter body.' };
    const targets = ds.flatMap(d => ids.has(d) ? [ids.get(d)!] : []);
    const indirect = indirectBinding(expr) || !(ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) ||
      ts.isElementAccessExpression(expr) || ts.isArrowFunction(expr) || ts.isFunctionExpression(expr));
    if (targets.length) {
      const virtual = ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr);
      const contract = targets.some(id => bodies.get(id)?.kind === 'signature' || bodies.get(id)?.kind === 'interface');
      const uncertain = virtual || contract || indirect || targets.length > 1;
      return { targets, status: uncertain ? 'candidate' : 'bound',
        rule: contract ? 'type-contract' : indirect ? 'indirect-reference' : virtual ? 'member-binding' : 'symbol-binding',
        why: contract ? 'Bound to a type contract, not a runtime implementation. Implementations are not enumerated.'
          : uncertain ? 'Compiler declaration/initializer candidate only. Receiver/value flow, reassignment and dispatch are not exhaustively modeled.'
            : 'Compiler-resolved lexical declaration (aliases and overload bodies normalized). Does not prove execution or runtime exclusivity.' };
    }
    // An external var/property declaration is still a known TYPE boundary. Do not require
    // it to be immutable. A LOCAL parameter or mutable alias cannot use this shortcut.
    const directExternal = direct.length > 0 && direct.every(outside);
    const external = ds.length > 0 && ds.every(outside);
    if (directExternal || external && !indirect) return { targets: [], status: 'external', rule: 'external-declaration',
      why: 'Compiler-bound declaration is outside indexed source (dependency or standard library). Implementation not analyzed; not runtime execution or target exclusivity.' };
    const reason = unresolvedReason(expr, ds);
    const boundary = reason === 'out-of-scope-declaration' ? ds.find(d => !outside(d)) : undefined;
    return { targets: [], status: 'unresolved', rule: indirect ? 'unknown-callable-value' : 'no-project-target', reason,
      ...(boundary ? { declaration: { location: locate(boundary, p.root), fileHash: hash(boundary.getSourceFile().text) } } : {}),
      why: indirect ? 'Callable value is supplied through a parameter/property/assignment. No whole-program value-flow proof.'
        : 'No indexed implementation binding. The diagnostic reason describes syntax/declaration evidence, not a proven runtime target.' };
  }
  function moduleRelation(owner: string, node: ts.Node, spec: ts.Expression, kind: RelationKind, typeOnly = false) {
    if (!ts.isStringLiteralLike(spec)) {
      add(owner, node, kind, [], 'unresolved', 'dynamic-module', 'Module specifier is not a static string.', spec.getText(), typeOnly); return;
    }
    const symbol = checker.getSymbolAtLocation(spec);
    const boundFile = symbol?.declarations?.find(ts.isSourceFile);
    const ambientFile = symbol?.declarations?.find(ts.isModuleDeclaration)?.getSourceFile().fileName;
    const resolvedFile = boundFile?.fileName ?? ts.resolveModuleName(spec.text, node.getSourceFile().fileName, p.options, ts.sys).resolvedModule?.resolvedFileName;
    const target = resolvedFile ? ids.get(p.program.getSourceFile(resolvedFile)!) : undefined;
    const externalFile = resolvedFile ?? ambientFile;
    const external = !!externalFile && (!inside(p.root, externalFile) || isDependency(externalFile));
    add(owner, node, kind, target ? [target] : [], target ? 'bound' : external ? 'external' : 'unresolved',
      'module-resolution', target ? 'Resolved using the project compiler module settings. Import is not a function call.'
        : external ? 'Resolved dependency module outside indexed source.' : 'Module has no indexed source target; not assumed absent.', spec.text, typeOnly);
  }
  for (const sf of p.sources) {
    const walk = (node: ts.Node, owner: string) => {
      const enclosing = owner;
      if (ids.has(node)) owner = ids.get(node)!;
      let call: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression | undefined;
      let expr: ts.Expression | undefined, kind: RelationKind = 'call';
      if (ts.isCallExpression(node)) { call = node; expr = node.expression; }
      if (ts.isNewExpression(node)) { call = node; expr = node.expression; kind = 'construct'; }
      if (ts.isTaggedTemplateExpression(node)) { call = node; expr = node.tag; kind = 'tag'; }
      if (call && expr) {
        const result = resolve(expr, checker.getResolvedSignature(call));
        if (kind === 'construct') {
          result.targets = result.targets.map(id => {
            const declaration = astById.get(id);
            if (declaration && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
              const ctor = declaration.members.find(member => ts.isConstructorDeclaration(member) && member.body);
              if (ctor && ids.has(ctor)) return ids.get(ctor)!;
            }
            return id;
          });
        }
        const relation = add(owner, call, kind, result.targets, result.status, result.rule, result.why, expr.getText());
        if (result.reason) relation.evidence.reason = result.reason;
        if (result.declaration) relation.evidence.declaration = result.declaration;
        if (ts.isCallExpression(call) && call.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (call.arguments[0]) moduleRelation(owner, call, call.arguments[0], 'import');
        }
        if (ts.isCallExpression(call) || ts.isNewExpression(call)) {
          for (const arg of call.arguments ?? []) {
            const r = resolve(arg);
            if (r.targets.some(t => bodies.get(t)?.hasBody)) add(owner, arg, 'callback', r.targets, r.status,
              'callable-argument', 'Callable passed as an argument; NOT evidence that the callee invokes it.', arg.getText().slice(0, 160));
          }
        }
      }
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const only = clause?.isTypeOnly || !!(clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length && clause.namedBindings.elements.every(e => e.isTypeOnly));
        moduleRelation(fileId(sf), node, node.moduleSpecifier, 'import', !!only);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const only = node.isTypeOnly || !!(node.exportClause && ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length && node.exportClause.elements.every(e => e.isTypeOnly));
        moduleRelation(fileId(sf), node, node.moduleSpecifier, 'reexport', only);
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression)
        moduleRelation(fileId(sf), node, node.moduleReference.expression, 'import', node.isTypeOnly);
      if (ts.isHeritageClause(node)) for (const item of node.types) {
        const r = resolve(item.expression);
        const typeOnly = node.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(node.parent);
        add(owner, item, node.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends', r.targets,
          typeOnly && r.targets.length ? 'bound' : r.status,
          typeOnly ? 'heritage-type-declaration' : 'heritage-value-binding',
          typeOnly ? 'Explicit type relationship, not runtime dispatch or a call edge.'
            : 'Superclass value expression. ' + r.why + ' This inheritance record is not a call edge.',
          item.getText(), typeOnly);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const text = node.tagName.getText();
        if (!/^[a-z][\w-]*$/.test(text)) {
          const r = resolve(node.tagName);
          add(owner, node, 'jsx', r.targets, r.targets.length ? 'candidate' : r.status, 'jsx-component-reference',
            'JSX component reference; framework rendering is not a direct function call.', text);
        }
      }
      ts.forEachChild(node, child => walk(child, inDefinitionContext(node, child) ? enclosing : owner));
    };
    walk(sf, fileId(sf));
  }
  const rawDiagnostics = ts.getPreEmitDiagnostics(p.program);
  p.diagnostics.push(...rawDiagnostics.map(d => ({
    category: d.category === ts.DiagnosticCategory.Error ? 'error' as const : 'warning' as const,
    code: 'TS' + d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    ...(d.file ? { file: normalize(path.relative(p.root, d.file.fileName)),
      line: d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 } : {}),
  })));
  const indexed = new Set(p.sources.map(sf => fileKey(sf.fileName)));
  const files = p.sources.map(sf => ({ path: normalize(path.relative(p.root, sf.fileName)), hash: hashes.get(sf.fileName)!,
    lines: sf.getLineStarts().length, ...(options.includeSource ? { source: sf.text } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
  // Rule changes must invalidate identity even when source/compiler inputs are identical.
  const configText = p.configPath ? fs.readFileSync(p.configPath, 'utf8') : '';
  const snapshot = hash(JSON.stringify({ analysisRevision: ANALYSIS_REVISION, files: [...p.readHashes].sort(),
    options: p.options, configText, compiler: ts.version }));
  const counts: Record<Status, number> = { bound: 0, candidate: 0, unresolved: 0, external: 0 };
  for (const edge of relations) if (CALL_KINDS.has(edge.kind)) counts[edge.status]++;
  return { schemaVersion: 1, project: { name: path.basename(p.root), ...gitState(p.root), snapshot,
      analysisRevision: ANALYSIS_REVISION, compilerVersion: ts.version, config: p.configPath ? normalize(path.relative(p.root, p.configPath)) : null, createdAt: new Date().toISOString() },
    files, nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), relations, diagnostics: p.diagnostics,
    coverage: { indexedFiles: files.length, inventorySourceFiles: p.found.files.filter(isSource).length,
      unindexed: p.found.files.filter(f => (isSource(f) || /\.(py|ps1|cs|cpp|c|go|rs|java)$/.test(f)) && !indexed.has(fileKey(f)))
        .map(f => ({ path: normalize(path.relative(p.root, f)), reason: isSource(f) ? 'outside-selected-program' : 'unsupported-language' })),
      skippedSymlinks: p.found.symlinks, ignoredDirectories: p.found.ignored,
      syntaxCalls: Object.values(counts).reduce((a, b) => a + b, 0), callsByStatus: counts,
      limitations: ['Static bindings are not runtime proof or a complete call graph.',
        'No whole-program points-to analysis, reflection, callback invocation inference, or cross-process/IPC/HTTP bridging.',
        'Function bodies in dependencies and declaration files are outside the index; diagnostics can reduce resolution quality.',
        'Single selected tsconfig; referenced projects require separate analysis. JavaScript follows allowJs in that configuration.',
        'Getters, setters, decorators, implicit coercions and implicit constructor calls are not exhaustively modeled.',
        'Full rebuild only; node offsets are snapshot-local identities. No incremental-update claims.'] } };
}
