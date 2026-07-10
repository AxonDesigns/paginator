// Mini flexbox-like layout for Group nodes. Two direction-specific functions rather than one
// generic main/cross function: width is always definite (handed down from the parent) for both
// directions, but the perpendicular dimension is always intrinsic — for a column that's literally
// its main axis (sum of children heights); for a row it's the cross axis (max of children
// heights). Forcing both through one generic path would obscure that asymmetry.
//
// Unlike the old group-layout.ts, this module dispatches into arbitrary children via the fully
// generic measureNodeHeight/layoutNodeFull/isSplittable/splitNode/naturalWidth/renderNodeDom/
// drawPdfNode functions from behavior.ts — safe now that behavior.ts never imports concrete node
// modules (see its header comment), so there's no cycle left to avoid by hand-rolling a local copy
// of that dispatch the way this file used to.

import type { CrossAlign, FlexSize, GroupNode, Node } from '../core/nodes.ts'
import type { Box, RenderedNode } from '../core/geometry.ts'
import { translateRendered } from '../core/geometry.ts'
import {
  drawPdfNode,
  isSplittable,
  layoutNodeFull,
  measureNodeHeight,
  naturalWidth,
  registerNode,
  renderNodeDom,
  splitNode,
} from '../core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx, SplitOutcome } from '../core/behavior.ts'
import { resolveFlexWidths } from '../core/flex-widths.ts'
import type { RowChildSizing } from '../core/flex-widths.ts'
import { separatorMainSize } from './separator.ts'
import { styledDiv } from '../render/shadow-dom.ts'

const EPSILON = 0.01

type Rendered = Extract<RenderedNode, { type: 'group' }>
type LaidOutChild = { node: Node; box: Box }
type DirectionLayoutResult = { children: LaidOutChild[]; contentWidth: number; contentHeight: number }

// Separator children already carry their final, orientation-correct box (full cross length in one
// dimension, thickness+2*margin in the other) computed by layoutRow/layoutColumn's own alignment
// math — layoutNodeFull()/separator's own layout() only knows the column/horizontal-bar orientation,
// so calling it here for a ROW separator would silently discard the row's stretched height. Use
// the already-resolved box directly instead; there's no further "internal content" to compute for
// a separator the way there is for text lines or nested group children.
function layoutResolvedChild(node: Node, box: Box, parentDirection: 'row' | 'column'): RenderedNode {
  if (node.type === 'separator') return { type: 'separator', box, node, orientation: parentDirection === 'row' ? 'vertical' : 'horizontal' }
  return translateRendered(layoutNodeFull(node, box.width), box.x, box.y)
}

function layoutGroupNode(node: GroupNode, width: number): Rendered {
  const result = node.direction === 'row' ? layoutRow(node, width) : layoutColumn(node, width)
  const children = result.children.map(c => layoutResolvedChild(c.node, c.box, node.direction === 'row' ? 'row' : 'column'))
  return { type: 'group', box: { x: 0, y: 0, width, height: result.contentHeight }, node, children }
}

// --- Row main-axis sizing: fixed (px flex, 'shrink', or a leaf node's own shrink-by-default) vs
// flexible (numeric weight; a nested GROUP still defaults to weight 1) ---

function resolveRowChildSizing(node: Node, availableWidth: number): RowChildSizing {
  if (node.type === 'separator') return { kind: 'fixed', size: separatorMainSize(node) }
  if (node.type === 'page-break') return { kind: 'fixed', size: 0 }
  const flex = node.flex
  if (flex === 'shrink') return { kind: 'fixed', size: shrinkWrapWidth(node, availableWidth) }
  if (flex === undefined && 'width' in node && node.width !== undefined) return { kind: 'fixed', size: node.width }
  if (typeof flex === 'string') return { kind: 'fixed', size: Number.parseFloat(flex) }
  // Unset `flex`: a nested GROUP still defaults to flex-grow weight 1 — it's a layout container,
  // closer to a block-level flex box that fills its row unless told otherwise. A leaf content node
  // (text/image/etc.) defaults to 'shrink' instead, hugging its own natural width — matching CSS's
  // actual flex-item default (flex-grow: 0, content-sized) rather than an equal-share weight, which
  // can squeeze a child's content below what it needs and force it to wrap. See "Row flex sizing"
  // in GUIDE.md.
  if (flex === undefined && node.type !== 'group') return { kind: 'fixed', size: shrinkWrapWidth(node, availableWidth) }
  return { kind: 'flex', weight: flex ?? 1 }
}

// Reads the per-child `alignSelf` override (see SelfAlignable in nodes.ts) — Node is a discriminated
// union, so `'alignSelf' in node` both narrows and covers the types that don't carry the field
// (Separator/PageBreak/Table) without a type error.
function childAlignSelf(node: Node): CrossAlign | undefined {
  return 'alignSelf' in node ? node.alignSelf : undefined
}

// A column that finished on an earlier page but whose row siblings still have content left needs
// a zero-height placeholder in its slot on the continuation row — otherwise the still-going
// columns would redistribute to fill the gap and the column grid would drift out of alignment
// with the same row's rendering on the previous page. Reproducing the ORIGINAL sizing (fixed px,
// or the same flex weight) rather than defaulting to flex: 1 is what keeps the width identical.
function emptyContinuationFor(node: Node, width: number): GroupNode {
  const sizing = resolveRowChildSizing(node, width)
  const flex: FlexSize = sizing.kind === 'fixed' ? `${sizing.size}px` : sizing.weight
  return { type: 'group', direction: 'column', flex, children: [] }
}

// A row's own natural/shrink-wrap width — used when this row is nested inside a shrink-wrapping
// ancestor (a `flex: 'shrink'` row child, or a column child whose cross width hugs its content)
// rather than being handed a definite box by layoutRow()'s own fixed-then-flex distribution. Sums
// each child's own natural contribution: fixed children (px/'shrink'/separator/bare `width`) via
// resolveRowChildSizing()'s existing 'fixed' resolution, and flex children (default weight, or an
// explicit numeric weight) via THEIR OWN shrink-wrap width — a flex child still has real content
// with a real natural size; it's only layoutRow()'s two-pass distribution that treats it specially,
// not its intrinsic size when nothing is actually flex-distributing space into it.
function sumNaturalRowWidth(node: GroupNode, width: number): number {
  const gap = node.gap ?? 0
  const sum = node.children.reduce((acc, c) => {
    const sizing = resolveRowChildSizing(c, width)
    return acc + (sizing.kind === 'fixed' ? sizing.size : shrinkWrapWidth(c, width))
  }, 0)
  return Math.min(sum + gap * Math.max(0, node.children.length - 1), width)
}

// --- Cross/main width contribution helpers (shrink-wrap sizing for NESTED subtrees only — the
// direct children of an actual row's own layout are sized by the flex algorithm in layoutRow) ---

// The actual shrink-wrap computation, shared by childCrossWidthInColumn() (a column's cross-axis
// width for a nested child) and resolveRowChildSizing()'s 'shrink' case (a row's main-axis width for
// a child opting out of flex-grow) — both questions reduce to "how wide does this subtree want to be,
// unconstrained by a stretching ancestor?".
function shrinkWrapWidth(node: Node, width: number): number {
  if (node.type === 'group') {
    if (node.direction === 'row') {
      return sumNaturalRowWidth(node, width)
    }
    // A nested column that itself stretches its own children also wants the full width offered to
    // it — otherwise its `crossAlign: 'stretch'` would be silently inert whenever a shrink-wrapping
    // ancestor hands it a content-sized box in the first place, the column counterpart to a nested
    // row's flex children each contributing their own natural width above.
    if (node.crossAlign === 'stretch') return width
    const max = node.children.reduce((acc, c) => Math.max(acc, childCrossWidthInColumn(c, width)), 0)
    return Math.min(max, width)
  }
  // Every other type's shrink-wrap width (or "wants the full width", the default when a type
  // registers no `naturalWidth`) — see behavior.ts's naturalWidth() dispatcher.
  return naturalWidth(node, width)
}

// Exported because table/layout.ts also needs it, for shrink-wrap cell content width when a cell's
// horizontal alignment isn't 'stretch'.
export function childCrossWidthInColumn(node: Node, width: number): number {
  // An explicit per-child override (see SelfAlignable in nodes.ts) always wins over every type's own
  // shrink-wrap logic below — the same short-circuit an ancestor's `crossAlign: 'stretch'` already
  // gets one level up, just scoped to this one child instead of every sibling.
  if (childAlignSelf(node) === 'stretch') return width
  return shrinkWrapWidth(node, width)
}

// --- Main-axis free-space distribution (shared shape between row and column) ---

function distributeFreeSpace(
  freeSpace: number,
  gap: number,
  n: number,
  mainAlign: NonNullable<GroupNode['mainAlign']>,
): { leading: number; between: number } {
  let leading = 0
  let between = gap
  if (freeSpace <= 0 || n === 0) return { leading, between }

  if (n > 1) {
    if (mainAlign === 'center') leading = freeSpace / 2
    else if (mainAlign === 'end') leading = freeSpace
    else if (mainAlign === 'space-between') between = gap + freeSpace / (n - 1)
    else if (mainAlign === 'space-around') {
      const slice = freeSpace / n
      leading = slice / 2
      between = gap + slice
    }
  } else {
    if (mainAlign === 'center') leading = freeSpace / 2
    else if (mainAlign === 'end') leading = freeSpace
    // space-between/space-around with a single child fall back to 'start' (standard flexbox rule)
  }
  return { leading, between }
}

// --- layoutColumn: main axis vertical, cross axis horizontal (definite width) ---

export function layoutColumn(node: GroupNode, width: number, targetHeight?: number): DirectionLayoutResult {
  const gap = node.gap ?? 0
  const mainAlign = node.mainAlign ?? 'start'
  const n = node.children.length

  const resolved = node.children.map(child => {
    // A child's own `alignSelf` (see SelfAlignable in nodes.ts) always wins; otherwise this
    // column's own explicit `crossAlign` applies uniformly to every child. Only when NEITHER is
    // set does the default depend on the child's own type: a nested GROUP defaults to 'stretch' —
    // it's a layout container, closer to a block-level flex box that fills the width it's given —
    // while a leaf content node (text/image/etc.) defaults to 'start', hugging its own natural
    // width the way inline/replaced content does. See "Row flex sizing" in GUIDE.md for the
    // parallel default on the main axis.
    const effectiveCrossAlign = childAlignSelf(child) ?? node.crossAlign ?? (child.type === 'group' ? 'stretch' : 'start')
    const resolvedWidth = effectiveCrossAlign === 'stretch' || child.type === 'separator' ? width : childCrossWidthInColumn(child, width)
    const height = measureNodeHeight(child, resolvedWidth)
    return { node: child, width: resolvedWidth, height, crossAlign: effectiveCrossAlign }
  })

  const naturalMainSize = resolved.reduce((acc, r) => acc + r.height, 0) + gap * Math.max(0, n - 1)
  const mainSize = targetHeight !== undefined ? Math.max(targetHeight, naturalMainSize) : naturalMainSize
  const freeSpace = Math.max(0, mainSize - naturalMainSize)
  const { leading, between } = distributeFreeSpace(freeSpace, gap, n, mainAlign)

  let y = leading
  const children: LaidOutChild[] = []
  for (const r of resolved) {
    const x = r.crossAlign === 'stretch' ? 0 : r.crossAlign === 'center' ? (width - r.width) / 2 : r.crossAlign === 'end' ? width - r.width : 0
    children.push({ node: r.node, box: { x, y, width: r.width, height: r.height } })
    y += r.height + between
  }

  return { children, contentWidth: width, contentHeight: mainSize }
}

// --- layoutRow: main axis horizontal (definite width), cross axis vertical (intrinsic) ---

export function layoutRow(node: GroupNode, width: number): DirectionLayoutResult {
  const gap = node.gap ?? 0
  const crossAlign = node.crossAlign ?? 'start'
  const mainAlign = node.mainAlign ?? 'start'
  const n = node.children.length
  const totalGap = gap * Math.max(0, n - 1)

  // Two-pass sizing: fixed-size children (separators, and any px `flex`) claim their exact size
  // first; whatever width remains is divided among flexible children (default flex: 1, i.e. equal
  // columns) proportional to their weight — the same two-pass model CSS flex-grow uses.
  const sizing = node.children.map(c => resolveRowChildSizing(c, width - totalGap))
  const totalFlexWeight = sizing.reduce((acc, s) => acc + (s.kind === 'flex' ? s.weight : 0), 0)
  const widths = resolveFlexWidths(sizing, width - totalGap)

  const resolved = node.children.map((child, i) => {
    const mainWidth = widths[i]!
    const height = child.type === 'separator' ? 0 : measureNodeHeight(child, mainWidth)
    return { node: child, width: mainWidth, height }
  })

  // mainAlign only has an effect when nobody is flexible (flexible children already consume all
  // remaining space by construction, exactly like CSS: flex-grow eats free space before
  // justify-content ever sees any) — e.g. a row of purely fixed/px-sized children that don't fill
  // the row can still be spread with `space-between`.
  const consumedMainSize = resolved.reduce((acc, r) => acc + r.width, 0) + totalGap
  const freeSpace = totalFlexWeight > 0 ? 0 : Math.max(0, width - consumedMainSize)
  const { leading, between } = distributeFreeSpace(freeSpace, gap, n, mainAlign)

  const rowHeight = resolved.reduce((acc, r) => {
    const floor = r.node.type === 'separator' ? separatorMainSize(r.node) : r.height
    return Math.max(acc, floor)
  }, 0)

  let x = leading
  const children: LaidOutChild[] = []
  for (const r of resolved) {
    if (r.node.type === 'separator') {
      children.push({ node: r.node, box: { x, y: 0, width: r.width, height: rowHeight } })
    } else {
      // A child's own `alignSelf` overrides this row's `crossAlign` for its vertical position alone.
      // 'stretch' has no vertical-stretch effect here (row-child height is always intrinsic — see
      // SelfAlignable in nodes.ts) and falls back to 'start' (y = 0), same as the default.
      const effectiveCrossAlign = childAlignSelf(r.node) ?? crossAlign
      const y = effectiveCrossAlign === 'center' ? (rowHeight - r.height) / 2 : effectiveCrossAlign === 'end' ? rowHeight - r.height : 0
      children.push({ node: r.node, box: { x, y, width: r.width, height: r.height } })
    }
    x += r.width + between
  }

  return { children, contentWidth: width, contentHeight: rowHeight }
}

// A page-break anywhere inside a COLUMN-direction subtree must force paginateNode/columnGroupSplit
// off their "fits fully, skip the per-child walk" fast path — otherwise a break nested inside
// content that happens to fit within the remaining page would never be discovered/honored. Doesn't
// recurse into rows: page-break has no effect as a row's column (see nodes.ts), so a break nested
// inside a row's own column contents is intentionally invisible to this check too.
export function subtreeHasPageBreak(node: Node): boolean {
  if (node.type === 'page-break') return true
  if (node.type !== 'group' || node.direction !== 'column') return false
  return node.children.some(subtreeHasPageBreak)
}

// --- Column-group splitting across a page boundary ---

function columnGroupSplit(node: GroupNode, width: number, availableHeight: number): SplitOutcome<GroupNode> {
  const { children: laidOut } = layoutColumn(node, width)

  const fitted: RenderedNode[] = []
  let consumedHeight = 0
  const restChildren: Node[] = []
  let cutMade = false

  for (const child of laidOut) {
    const childTop = child.box.y
    const childBottom = child.box.y + child.box.height

    // An explicit page break forces a cut here, UNLESS nothing has been placed on the current
    // page yet (from this same walk) — in which case it's a redundant/leading break and is
    // silently dropped rather than producing a blank page.
    if (!cutMade && child.node.type === 'page-break') {
      if (fitted.length > 0) cutMade = true
      continue
    }

    if (!cutMade && childBottom <= availableHeight + EPSILON && !subtreeHasPageBreak(child.node)) {
      fitted.push(layoutResolvedChild(child.node, child.box, 'column'))
      consumedHeight = childBottom
      continue
    }

    if (!cutMade) {
      const localAvailable = availableHeight - childTop
      if (localAvailable > 0 && isSplittable(child.node)) {
        const childSplit = splitNode(child.node, child.box.width, localAvailable)
        if (childSplit !== null) {
          fitted.push(translateRendered(childSplit.rendered, child.box.x, childTop))
          consumedHeight = childTop + childSplit.consumedHeight
          if (childSplit.rest !== null) restChildren.push(childSplit.rest)
          cutMade = true
          continue
        }
      }
      restChildren.push(child.node)
      cutMade = true
      continue
    }

    restChildren.push(child.node)
  }

  if (fitted.length === 0) return null

  const rest: GroupNode | null = restChildren.length === 0 ? null : { ...node, children: restChildren }
  return {
    rendered: { type: 'group', box: { x: 0, y: 0, width, height: consumedHeight }, node, children: fitted },
    consumedHeight,
    rest,
  }
}

// --- Row-group splitting across a page boundary (only when `splitColumns: true`) ---
//
// Unlike a column group, a row's children aren't a single top-to-bottom sequence to cut at one
// point — each column is measured and split independently against the SAME `availableHeight`,
// newspaper-style: a short column finishes while a tall neighbor keeps flowing onto the next
// page. crossAlign is intentionally not honored here (every column top-aligns at y=0 each page):
// "center"/"end" cross-alignment has no well-defined meaning once columns consume different
// amounts of vertical space per page.
function rowGroupSplit(node: GroupNode, width: number, availableHeight: number): SplitOutcome<GroupNode> {
  const { children: laidOut } = layoutRow(node, width) // full, unpaginated per-column boxes (x, width) + full natural height

  const fitted: RenderedNode[] = []
  const restChildren: Node[] = []
  let anyoneContinues = false
  let rowConsumedHeight = 0

  for (const child of laidOut) {
    const box = { ...child.box, y: 0 }

    if (box.height <= availableHeight + EPSILON) {
      // Whole column fits — finished. Still record a same-width placeholder in restChildren (used
      // only if some OTHER column keeps the row alive) so this slot doesn't collapse and let
      // siblings redistribute into its space on the continuation page.
      fitted.push(layoutResolvedChild(child.node, box, 'row'))
      rowConsumedHeight = Math.max(rowConsumedHeight, box.height)
      restChildren.push(emptyContinuationFor(child.node, width))
      continue
    }

    if (isSplittable(child.node)) {
      const childSplit = splitNode(child.node, box.width, availableHeight)
      if (childSplit !== null) {
        fitted.push(translateRendered(childSplit.rendered, box.x, 0))
        rowConsumedHeight = Math.max(rowConsumedHeight, childSplit.consumedHeight)
        if (childSplit.rest !== null) {
          restChildren.push(childSplit.rest)
          anyoneContinues = true
        } else {
          restChildren.push(emptyContinuationFor(child.node, width))
        }
        continue
      }
    }

    // Doesn't fit at all and can't be partially split (atomic column, or zero content fit) —
    // this column contributes nothing on this page; the whole node is deferred, unchanged.
    restChildren.push(child.node)
    anyoneContinues = true
  }

  if (rowConsumedHeight <= 0) return null // row-level orphan: not even one column produced anything

  const rest: GroupNode | null = anyoneContinues ? { ...node, children: restChildren } : null
  return {
    rendered: { type: 'group', box: { x: 0, y: 0, width, height: rowConsumedHeight }, node, children: fitted },
    consumedHeight: rowConsumedHeight,
    rest,
  }
}

// Group: inert positioned box purely for devtools/debugging parity with the authored tree. Children
// boxes are already resolved relative to this SAME (originX, originY), not to the group's own box,
// so recursion reuses the unchanged origin — see geometry.ts's translateRendered invariant.
function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const groupEl = styledDiv({ left: `${x}px`, top: `${y}px`, width: `${rendered.box.width}px`, height: `${rendered.box.height}px` })
  ctx.container.appendChild(groupEl)
  for (const child of rendered.children) renderNodeDom(child, ctx.originX, ctx.originY, ctx)
}

// No PDF equivalent beyond recursing — a group's wrapper box is DOM-devtools-only paint, nothing to
// draw in the PDF.
async function drawPdf(rendered: Rendered, _x: number, _y: number, ctx: PdfRenderCtx): Promise<void> {
  for (const child of rendered.children) await drawPdfNode(child, ctx.originX, ctx.originY, ctx.pdf)
}

registerNode('group', {
  measureHeight: (node, width) => (node.direction === 'row' ? layoutRow(node, width).contentHeight : layoutColumn(node, width).contentHeight),
  // The real, direction/splitColumns-aware check — this is what behavior.ts's generic isSplittable()
  // dispatches to for a group node.
  isSplittable: node => node.direction === 'column' || node.splitColumns === true,
  split: (node, width, availableHeight) => {
    if (node.direction === 'column') return columnGroupSplit(node, width, availableHeight)
    if (node.direction === 'row' && node.splitColumns === true) return rowGroupSplit(node, width, availableHeight)
    return null
  },
  layout: layoutGroupNode,
  renderDom,
  drawPdf,
})
