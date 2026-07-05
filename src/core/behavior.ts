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

import type { Node } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'
import type { PdfContext } from '../render/pdf-render.ts'

export type SplitOutcome<T extends Node> = {
  /** The portion that fit this page, box-local (x=0, y=0). */
  rendered: RenderedNode
  consumedHeight: number
  /** null when the node finished exactly on this page. */
  rest: T | null
} | null // null = zero content fit (orphan case) — caller pushes the whole node to the next page

export type DomRenderCtx = { container: HTMLElement; originX: number; originY: number; unselectable: boolean }
export type PdfRenderCtx = { pdf: PdfContext; originX: number; originY: number }

export interface NodeTypeDefinition<T extends Node = Node, R extends RenderedNode = RenderedNode> {
  /** Full natural height this node occupies at `width`, ignoring page boundaries entirely. */
  measureHeight(node: T, width: number): number
  /** Whether this node can be split across a page boundary. A function, not a static bool — group
   *  and container's splittability depends on runtime fields (direction/splitColumns/child), not
   *  just type. */
  isSplittable(node: T): boolean
  /** Only ever called when `isSplittable(node)` is true. */
  split?(node: T, width: number, availableHeight: number): SplitOutcome<T>
  /** Full, unpaginated layout, box-local (x=0, y=0). */
  layout(node: T, width: number): R
  /** Shrink-wrap width for non-stretch column placement (see group.ts's childCrossWidthInColumn).
   *  Omitted = "wants the full width offered to it" (separator/page-break/table's own behavior).
   *  The generic `naturalWidth()` dispatcher below clamps the result to `availableWidth` itself, so
   *  implementations don't each need to repeat that `Math.min`. */
  naturalWidth?(node: T, availableWidth: number): number
  renderDom(rendered: R, x: number, y: number, ctx: DomRenderCtx): void
  drawPdf(rendered: R, x: number, y: number, ctx: PdfRenderCtx): void | Promise<void>
}

const registry = new Map<string, NodeTypeDefinition<any, any>>()

export function registerNode<K extends Node['type']>(
  type: K,
  def: NodeTypeDefinition<Extract<Node, { type: K }>, Extract<RenderedNode, { type: K }>>,
): void {
  registry.set(type, def as NodeTypeDefinition<any, any>)
}

function entryFor(type: string): NodeTypeDefinition<any, any> {
  const def = registry.get(type)
  if (def === undefined) {
    throw new Error(`[paginator] no node type registered for "${type}" — src/nodes/index.ts must be imported (e.g. via this package's own entry point) before pagination/rendering runs.`)
  }
  return def
}

export function measureNodeHeight(node: Node, width: number): number {
  return entryFor(node.type).measureHeight(node, width)
}

export function isSplittable(node: Node): boolean {
  return entryFor(node.type).isSplittable(node)
}

export function splitNode(node: Node, width: number, availableHeight: number): SplitOutcome<Node> {
  const def = entryFor(node.type)
  return def.split === undefined ? null : def.split(node, width, availableHeight)
}

export function layoutNodeFull(node: Node, width: number): RenderedNode {
  return entryFor(node.type).layout(node, width)
}

/** Shrink-to-fit width for cross/main-axis sizing in Group/Table layout. */
export function naturalWidth(node: Node, availableWidth: number): number {
  const def = entryFor(node.type)
  return def.naturalWidth === undefined ? availableWidth : Math.min(def.naturalWidth(node, availableWidth), availableWidth)
}

export function renderNodeDom(rendered: RenderedNode, originX: number, originY: number, ctx: { container: HTMLElement; unselectable: boolean }): void {
  const x = originX + rendered.box.x
  const y = originY + rendered.box.y
  // A node needs both interactive+draggable to actually be a drag source (see attach-interactions.ts),
  // so that's the same check that decides whether text here (or under here) should be unselectable.
  const isDraggable = rendered.node.interactive === true && rendered.node.draggable === true
  const unselectable = ctx.unselectable || isDraggable
  entryFor(rendered.type).renderDom(rendered, x, y, { container: ctx.container, originX, originY, unselectable })
}

export async function drawPdfNode(rendered: RenderedNode, originX: number, originY: number, pdf: PdfContext): Promise<void> {
  const x = originX + rendered.box.x
  const y = originY + rendered.box.y
  await entryFor(rendered.type).drawPdf(rendered, x, y, { pdf, originX, originY })
}
