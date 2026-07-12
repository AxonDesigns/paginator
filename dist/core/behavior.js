// The single extension point every node type plugs into — pagination, both renderers, and column
// shrink-wrap sizing all dispatch purely through this registry. Adding a new node type never touches
// paginate.ts, this file's dispatch functions, shadow-dom.ts, or pdf-render.ts:
//   1. Add the variant to the `Node` union in nodes.ts (+ its builder function).
//   2. Create src/nodes/<type>.ts implementing NodeTypeDefinition<NewNode, NewRenderedNode> and
//      calling registerNode('<type>', {...}) once at the bottom.
//   3. Add one `import './<type>.ts'` line to src/nodes/index.ts.
//
// Each per-type module self-registers as an import side effect rather than being statically
// imported here. The previous design (this file importing every concrete module to build a
// `registry` object literal) made an ESM circular dependency unavoidable for any node type whose
// layout needs to recurse into arbitrary children (group/table/container) — those three files had
// to hand-roll their own duplicate copy of this exact dispatch just to avoid importing back from
// here. Self-registration breaks the cycle: this file never imports a concrete node module, so any
// node module is free to import the generic dispatchers below with nothing to cycle against.
// src/nodes/index.ts imports every node module once, purely for its registerNode() side effect, and
// is itself imported first thing in src/index.ts — the public entry point every consumer (including
// this repo's own main.ts) already goes through — so the registry is always fully populated before
// paginate()/mount()/generatePdf() can run.
const registry = new Map();
export function registerNode(type, def) {
    registry.set(type, def);
}
function entryFor(type) {
    const def = registry.get(type);
    if (def === undefined) {
        throw new Error(`[paginator] no node type registered for "${type}" — src/nodes/index.ts must be imported (e.g. via this package's own entry point) before pagination/rendering runs.`);
    }
    return def;
}
export function measureNodeHeight(node, width) {
    return entryFor(node.type).measureHeight(node, width);
}
export function isSplittable(node) {
    return entryFor(node.type).isSplittable(node);
}
let nextSplitGroupId = 0;
export function splitNode(node, width, availableHeight) {
    const def = entryFor(node.type);
    if (def.split === undefined)
        return null;
    const result = def.split(node, width, availableHeight);
    if (result === null)
        return null;
    // Stamp every fragment produced by this split with a shared, internal lineage id — reused from
    // `node` itself when it's already a continuation of an earlier split, otherwise minted fresh —
    // so findFragments() can later recover every fragment of the same authored node without the
    // caller having to assign an `id` themselves. Every split() implementation sets `rendered.node`
    // to the literal input `node` reference, so this clones rather than mutates it.
    const splitGroupId = node.__splitGroupId ?? `split-${nextSplitGroupId++}`;
    const rendered = { ...result.rendered, node: { ...result.rendered.node, __splitGroupId: splitGroupId } };
    const rest = result.rest === null ? null : { ...result.rest, __splitGroupId: splitGroupId };
    return { rendered, consumedHeight: result.consumedHeight, rest };
}
export function layoutNodeFull(node, width) {
    return entryFor(node.type).layout(node, width);
}
/** Shrink-to-fit width for cross/main-axis sizing in Group/Table layout. */
export function naturalWidth(node, availableWidth) {
    const def = entryFor(node.type);
    return def.naturalWidth === undefined ? availableWidth : Math.min(def.naturalWidth(node, availableWidth), availableWidth);
}
// A node's own explicit `cursor` wins; otherwise `interactive`/`draggable` resolve a sensible
// default (`droppable` alone gets none — not obviously clickable). Returns undefined when this node
// has no opinion of its own, so renderNodeDom() below falls back to whatever its ancestor resolved.
function resolveCursor(node) {
    if (node.cursor !== undefined)
        return node.cursor;
    if (node.interactive === true)
        return node.draggable === true ? 'grab' : 'pointer';
    return undefined;
}
export function renderNodeDom(rendered, originX, originY, ctx) {
    const x = originX + rendered.box.x;
    const y = originY + rendered.box.y;
    // A node needs both interactive+draggable to actually be a drag source (see attach-interactions.ts),
    // so that's the same check that decides whether text here (or under here) should be unselectable.
    const isDraggable = rendered.node.interactive === true && rendered.node.draggable === true;
    const unselectable = ctx.unselectable || isDraggable;
    // Same bubble-down shape as `unselectable` above, but resolving a string instead of OR-ing a
    // bool: a non-opinionated node inherits its nearest interactive/cursor-setting ancestor's value,
    // matching hit-test's own "descendant wins if it has an opinion, else bubble up" resolution.
    const cursor = resolveCursor(rendered.node) ?? ctx.cursor;
    entryFor(rendered.type).renderDom(rendered, x, y, { container: ctx.container, originX, originY, unselectable, cursor });
}
export async function drawPdfNode(rendered, originX, originY, pdf) {
    const x = originX + rendered.box.x;
    const y = originY + rendered.box.y;
    await entryFor(rendered.type).drawPdf(rendered, x, y, { pdf, originX, originY });
}
