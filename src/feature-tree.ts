/** Caller-measured geometry only. IDs and hierarchy are never inferred here. */
export interface FeatureTreeNode {
  id: string;
  parentId?: string;
  width: number;
  height: number;
}

export interface FeatureTreeOptions {
  gapX?: number;
  gapY?: number;
  padding?: number;
}

export interface FeatureTreeLayout {
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  edges: { parentId: string; childId: string; points: [number, number][] }[];
  width: number;
  height: number;
}

/**
 * Rightward geometry for a caller-supplied forest. The caller may provide the
 * complete forest and filter visibility, or provide a visible ancestor-closed
 * projection and compensate its reflow in the view. No collapse state lives here.
 * Widths expand to the maximum measured width at each depth; heights stay exact.
 * This factory has no external runtime dependencies and may be embedded offline.
 */
export function createFeatureTreeApi() {
  /*
   * Adapted from Archify's render-tree.mjs, rightward layout and edge geometry:
   * https://github.com/tt-a1i/archify/blob/25cf37080fc8b1dbe758a4efc3935b55f3327083/archify/renderers/tree/render-tree.mjs
   * See docs/archify-tree-reuse.md for the bounded adaptation and comparison.
   * Keep this notice INSIDE the factory: exported offline HTML embeds toString().
   *
   * MIT License
   *
   * Copyright (c) 2026 tt-a1i (Archify)
   * Copyright (c) 2025 Cocoon AI
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  function layout(input: readonly FeatureTreeNode[], options: FeatureTreeOptions = {}): FeatureTreeLayout {
    if (!Array.isArray(input)) throw new Error('Feature tree: nodes must be an array');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Feature tree: options must be an object');
    function dimension(value: number, name: string, allowZero = false) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
        throw new Error(`Feature tree: ${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
      }
      return value;
    }
    const gapX = dimension(options.gapX === undefined ? 64 : options.gapX, 'gapX', true);
    const gapY = dimension(options.gapY === undefined ? 24 : options.gapY, 'gapY', true);
    const padding = dimension(options.padding === undefined ? 24 : options.padding, 'padding', true);
    type Node = FeatureTreeNode & {
      depth: number; children: Node[]; span: number; childrenSpan: number; start: number; x: number; y: number;
    };
    const byId = new Map<string, Node>();
    for (const item of input) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.length) {
        throw new Error('Feature tree: every node needs a non-empty string id');
      }
      if (byId.has(item.id)) throw new Error(`Feature tree: duplicate id ${item.id}`);
      if (item.parentId !== undefined && (typeof item.parentId !== 'string' || !item.parentId.length)) {
        throw new Error(`Feature tree: invalid parentId for ${item.id}`);
      }
      byId.set(item.id, { id: item.id, parentId: item.parentId,
        width: dimension(item.width, 'width'), height: dimension(item.height, 'height'),
        depth: 0, children: [], span: 0, childrenSpan: 0, start: 0, x: 0, y: 0 });
    }
    if (!byId.size) return { nodes: [], edges: [], width: 0, height: 0 };
    const roots: Node[] = [];
    for (const node of byId.values()) {
      if (node.parentId === undefined) roots.push(node);
      else {
        const parent = byId.get(node.parentId);
        if (!parent) throw new Error(`Feature tree: missing parent ${node.parentId}`);
        parent.children.push(node);
      }
    }

    // A node has at most one parent. Any component unreachable from a root is a
    // cycle. Iterative traversal also keeps deep authored trees off the JS stack.
    const order = [...roots];
    const bandSize: number[] = [];
    for (let i = 0; i < order.length; i++) {
      const node = order[i]!;
      bandSize[node.depth] = Math.max(bandSize[node.depth] ?? 0, node.width);
      for (const child of node.children) { child.depth = node.depth + 1; order.push(child); }
    }
    if (order.length !== byId.size) throw new Error('Feature tree: hierarchy contains a cycle');
    const bandStart: number[] = [];
    let column = padding;
    for (let depth = 0; depth < bandSize.length; depth++) {
      bandStart[depth] = column;
      column += bandSize[depth]! + gapX;
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const node = order[i]!;
      node.width = bandSize[node.depth]!;
      node.childrenSpan = node.children.reduce((sum, child, index) => sum + child.span + (index ? gapY : 0), 0);
      node.span = Math.max(node.height, node.childrenSpan);
    }
    let rootStart = padding;
    for (const root of roots) { root.start = rootStart; rootStart += root.span + gapY; }
    if (!Number.isFinite(column) || !Number.isFinite(rootStart)) throw new Error('Feature tree: layout exceeds finite coordinates');
    for (const node of order) {
      let cursor = node.start + (node.span - node.childrenSpan) / 2;
      for (const child of node.children) { child.start = cursor; cursor += child.span + gapY; }
    }
    const centerOf = (node: Node) => node.y + node.height / 2;
    for (let i = order.length - 1; i >= 0; i--) {
      const node = order[i]!, children = node.children;
      let center = children.length ? (centerOf(children[0]!) + centerOf(children[children.length - 1]!)) / 2 : node.start + node.span / 2;
      const half = node.height / 2;
      const middle = children.slice(1, -1).map(centerOf)
        .find(attach => Math.abs(attach - center) < 24 && attach - half >= node.start && attach + half <= node.start + node.span);
      if (middle !== undefined) center = middle;
      // A tall parent with unequal child spans can otherwise leave its reserved
      // span and overlap a sibling. Preserve that span rather than moving peers.
      center = Math.max(node.start + half, Math.min(node.start + node.span - half, center));
      // DOM measurements can be fractional. Retain CSS-pixel precision so
      // rounding cannot push a card into its neighbour when a gap is zero.
      node.x = bandStart[node.depth]!;
      node.y = center - half;
    }
    function edgePoints(parent: Node, child: Node): [number, number][] {
      const start: [number, number] = [parent.x + parent.width, centerOf(parent)];
      const end: [number, number] = [child.x, centerOf(child)];
      const midX = bandStart[child.depth]! - gapX / 2;
      const y = (start[1] + end[1]) / 2;
      if (Math.abs(start[1] - end[1]) < 2 && y >= Math.max(parent.y, child.y) &&
        y <= Math.min(parent.y + parent.height, child.y + child.height)) return [[start[0], y], [end[0], y]];
      return [start, [midX, start[1]], [midX, end[1]], end];
    }
    const nodes: FeatureTreeLayout['nodes'] = [];
    const edges: FeatureTreeLayout['edges'] = [];
    let width = 0, height = 0;
    for (const node of byId.values()) {
      nodes.push({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height });
      width = Math.max(width, node.x + node.width + padding);
      height = Math.max(height, node.y + node.height + padding);
      if (node.parentId !== undefined) edges.push({ parentId: node.parentId, childId: node.id,
        points: edgePoints(byId.get(node.parentId)!, node) });
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Feature tree: layout exceeds finite coordinates');
    return { nodes, edges, width, height };
  }
  return { layout };
}
