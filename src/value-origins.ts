import ts from 'typescript';
import type { OriginPoint, ValueOrigins } from './model.js';

/** These limits bound each query, not the whole program's static indexing cost. */
export const ORIGIN_LIMITS = Object.freeze({ maxDepth: 12, maxSteps: 64, maxSources: 16, maxStops: 16, maxCallsites: 16 });
type Projection = { key: string; array: boolean }[];
type Step = ValueOrigins['sources'][number]['path'][number];
type Call = ts.CallExpression | ts.NewExpression;
interface Host {
  sources: readonly ts.SourceFile[];
  checker: ts.TypeChecker;
  ids: ReadonlyMap<ts.Node, string>;
  unwrap(node: ts.Node): ts.Node;
  declarations(node: ts.Node): readonly ts.Declaration[];
  /** Only existing lexical bindings; never consult this tracer recursively. */
  directTarget(node: ts.Node): ts.Node | undefined;
  point(node: ts.Node): OriginPoint;
}
const isFunction = (n: ts.Node): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.ConstructorDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isConstructorDeclaration(n);
function keyOf(name: ts.Node): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression))) return name.expression.text;
  return undefined;
}

/** Reuses compiler identity for variables/parameters; never matches unrelated names. */
export function createValueOriginTracer(h: Host): (expr: ts.Node) => ValueOrigins {
  const sites = new Map<ts.Node, { calls: Call[]; total: number }>();
  const written = new Set<ts.Declaration>();
  const indexed = new Set(h.sources);
  const markWrite = (input: ts.Node): void => {
    const n = h.unwrap(input);
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      for (const d of h.declarations(n)) written.add(d);
    } else if (ts.isObjectLiteralExpression(n)) for (const p of n.properties) {
      if (ts.isShorthandPropertyAssignment(p)) {
        const symbol = h.checker.getShorthandAssignmentValueSymbol(p);
        for (const d of symbol?.declarations ?? []) written.add(d);
      } else if (ts.isPropertyAssignment(p)) markWrite(p.initializer);
      else if (ts.isSpreadAssignment(p)) markWrite(p.expression);
    } else if (ts.isArrayLiteralExpression(n)) for (const p of n.elements) markWrite(ts.isSpreadElement(p) ? p.expression : p);
  };
  for (const sf of h.sources) {
    const scan = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = h.directTarget(node.expression);
        if (target && isFunction(target) && target.body) {
          let row = sites.get(target);
          if (!row) sites.set(target, row = { calls: [], total: 0 });
          row.total++;
          if (row.calls.length < ORIGIN_LIMITS.maxCallsites) row.calls.push(node);
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) markWrite(node.left);
      if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
        if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) markWrite(node.operand);
      }
      if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) markWrite(node.initializer);
      ts.forEachChild(node, scan);
    };
    scan(sf);
  }
  return expr => {
    const result: ValueOrigins = { complete: false, truncated: false, visited: 0, limits: { ...ORIGIN_LIMITS }, sources: [], stops: [] };
    const stopKeys = new Set<string>(), sourceKeys = new Set<string>();
    const stop = (reason: string, node: ts.Node): void => {
      const point = h.point(node), key = `${reason}:${point.location.file}:${point.location.start}`;
      if (stopKeys.has(key)) return;
      stopKeys.add(key);
      if (result.stops.length < ORIGIN_LIMITS.maxStops) result.stops.push({ reason, ...point });
      else result.truncated = true;
    };
    const step = (node: ts.Node, kind: string): Step => ({ kind, ...h.point(node) });
    const walk = (input: ts.Node, projection: Projection, chain: Step[], ancestors: Set<string>, depth: number): void => {
      const node = h.unwrap(input);
      if (depth > ORIGIN_LIMITS.maxDepth || result.visited >= ORIGIN_LIMITS.maxSteps) {
        result.truncated = true; stop('budget', node); return;
      }
      result.visited++;
      const loc = h.point(node).location;
      const key = JSON.stringify([loc.file, loc.start, node.kind, projection]);
      if (ancestors.has(key)) { stop('cycle', node); return; }
      const active = new Set(ancestors); active.add(key);
      const next = (n: ts.Node, kind: string, p = projection) => walk(n, p, [...chain, step(node, kind)], active, depth + 1);
      if (!indexed.has(node.getSourceFile())) { stop('outside-index', node); return; }
      if (isFunction(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const id = h.ids.get(node);
        if (projection.length || !id || ('body' in node && !node.body)) { stop('unavailable-implementation', node); return; }
        const route = [...chain, step(node, 'implementation')];
        const identity = `${id}:${route.map(s => `${s.location.file}:${s.location.start}`).join('>')}`;
        if (sourceKeys.has(identity)) return;
        sourceKeys.add(identity);
        if (result.sources.length < ORIGIN_LIMITS.maxSources) result.sources.push({ target: id, path: route });
        else { result.truncated = true; stop('source-budget', node); }
        return;
      }
      if (ts.isBindingElement(node)) {
        let d: ts.Node = node;
        const path: Projection = [];
        while (ts.isBindingElement(d)) {
          if (d.dotDotDotToken) { stop('rest-binding', d); return; }
          if (d.initializer) { stop('default-binding', d); return; }
          const pattern = d.parent;
          if (ts.isArrayBindingPattern(pattern)) {
            if (pattern.elements.some(e => ts.isBindingElement(e) && e.dotDotDotToken)) { stop('rest-binding', pattern); return; }
            path.unshift({ key: String(pattern.elements.indexOf(d)), array: true });
          } else {
            const key = keyOf(d.propertyName ?? d.name);
            if (key === undefined) { stop('dynamic-key', d); return; }
            path.unshift({ key, array: false });
          }
          d = pattern.parent;
        }
        next(d, 'destructure', [...path, ...projection]); return;
      }
      if (ts.isVariableDeclaration(node)) {
        if (!ts.isVariableDeclarationList(node.parent) || !(node.parent.flags & ts.NodeFlags.Const)) { stop('mutable-binding', node); return; }
        if (node.initializer) next(node.initializer, 'initializer');
        else stop('missing-initializer', node);
        return;
      }
      if (ts.isParameter(node)) {
        if (node.dotDotDotToken) { stop('rest-binding', node); return; }
        if (written.has(node)) { stop('written-value', node); return; }
        const fn = node.parent;
        if (!isFunction(fn)) { stop('unsupported-caller', node); return; }
        if (written.has(fn) || ts.isConstructorDeclaration(fn) && written.has(fn.parent)) { stop('written-callee', node); return; }
        // Indexed direct callsites are never all possible callers, even for unexported functions.
        stop('open-callers', node);
        const row = sites.get(fn);
        if (!row) return;
        if (row.total > row.calls.length) { result.truncated = true; stop('caller-budget', node); }
        const params = fn.parameters.filter(p => !(ts.isIdentifier(p.name) && p.name.text === 'this'));
        const index = params.indexOf(node);
        if (index < 0) { stop('unsupported-caller', node); return; }
        for (const call of row.calls) {
          const args = call.arguments ?? [];
          if (args.some(ts.isSpreadElement)) { stop('spread-arguments', call); continue; }
          const arg = args[index];
          const route = [...chain, step(node, 'parameter'), step(call, 'direct-callsite')];
          if (arg) walk(arg, projection, route, active, depth + 1);
          else if (node.initializer) walk(node.initializer, projection, [...route, step(node, 'default-argument')], active, depth + 1);
          else stop('missing-argument', call);
        }
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const [head, ...tail] = projection;
        if (!head || head.array) { stop('nonliteral-projection', node); return; }
        if (node.properties.some(ts.isSpreadAssignment)) { stop('spread-source', node); return; }
        if (node.properties.some(p => p.name && keyOf(p.name) === undefined)) { stop('dynamic-key', node); return; }
        stop('heap-state', node);
        const prop = [...node.properties].reverse().find(p => p.name && keyOf(p.name) === head.key);
        if (!prop) { stop('missing-property', node); return; }
        if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) { stop('getter-result', prop); return; }
        if (ts.isShorthandPropertyAssignment(prop)) {
          const ds = h.checker.getShorthandAssignmentValueSymbol(prop)?.declarations ?? [];
          if (!ds.length) { stop('unknown-value', prop); return; }
          for (const d of ds) walk(d, tail, [...chain, step(prop,'property')], active, depth + 1);
        } else if (ts.isPropertyAssignment(prop)) walk(prop.initializer, tail, [...chain, step(prop,'property')], active, depth + 1);
        else walk(prop, tail, [...chain, step(node,'property')], active, depth + 1);
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        const [head, ...tail] = projection;
        if (!head || !head.array || !/^(0|[1-9]\d*)$/.test(head.key)) { stop('nonliteral-projection', node); return; }
        if (node.elements.some(ts.isSpreadElement)) { stop('spread-source', node); return; }
        const value = node.elements[Number(head.key)];
        if (!value || ts.isOmittedExpression(value)) { stop('missing-property', node); return; }
        stop('heap-state', node);
        next(value, 'array-element', tail); return;
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)) { stop('call-result', node); return; }
      if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) { stop('getter-result', node); return; }
      const ds = h.declarations(node);
      if (ds.some(ts.isGetAccessorDeclaration)) { stop('getter-result', node); return; }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        // Parameter properties are compiler-bound constructor parameters, not name matches.
        if (ds.length === 1 && ts.isParameter(ds[0]!)) { next(ds[0]!, 'parameter-property'); return; }
        const key = ts.isPropertyAccessExpression(node) ? node.name.text
          : ts.isStringLiteralLike(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (key === undefined) { stop('dynamic-key', node); return; }
        next(node.expression, 'property-read', [{ key, array: false }, ...projection]); return;
      }
      if (ts.isIdentifier(node)) {
        if (!ds.length) { stop('unknown-value', node); return; }
        // Prefer an available overload body, as the base lexical resolver does.
        const bodies = ds.filter(d => isFunction(d) && d.body);
        for (const d of bodies.length ? bodies : ds) next(d, 'reference');
        return;
      }
      stop('unknown-value', node);
    };
    walk(expr, [], [], new Set(), 0);
    return result;
  };
}
