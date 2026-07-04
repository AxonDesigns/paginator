// Mini flexbox-like layout for Group nodes. Two direction-specific functions rather than one
// generic main/cross function: width is always definite (handed down from the parent) for both
// directions, but the perpendicular dimension is always intrinsic — for a column that's literally
// its main axis (sum of children heights); for a row it's the cross axis (max of children
// heights). Forcing both through one generic path would obscure that asymmetry.
//
// This module intentionally does NOT import behavior.ts's `registry`/`isSplittable` at runtime
// (only their *types*, which TypeScript erases) — behavior.ts imports `groupMeasurer` from here,
// so a runtime import in the other direction would create an actual ESM circular dependency.
// Instead, child dispatch for the MVP node types is handled locally.
//
// table-layout.ts imports `groupMeasurer`/`childCrossWidthInColumn` from this file (to lay out a
// group nested inside a table cell), and this file imports `tableMeasurer` from table-layout.ts
// (to lay out a table nested inside a row/column) — a two-file cycle, unlike the one avoided
// above. It's safe ONLY because both sides reference the other exclusively inside function bodies
// (never at module top-level to eagerly build an object, the way behavior.ts's `registry` would).
// Do not hoist either reference out of a function body, or this reintroduces a TDZ crash.

import type { FlexSize, GroupNode, Node } from './nodes.ts'
import type { Box, RenderedNode } from './geometry.ts'
import { translateRendered } from './geometry.ts'
import type { NodeMeasurer, SplitOutcome } from './behavior.ts'
import { measureTextNaturalWidth, textMeasurer } from './measure-text.ts'
import { separatorMainSize, separatorMeasurer } from './separator-layout.ts'
import { imageMeasurer, imageNaturalWidth } from './image-layout.ts'
import { tableMeasurer } from './table-layout.ts'
import { chartMeasurer, chartNaturalWidth } from './chart-layout.ts'

const EPSILON = 0.01

type LaidOutChild = { node: Node; box: Box }
type DirectionLayoutResult = { children: LaidOutChild[]; contentWidth: number; contentHeight: number }

// --- Local node dispatch (duplicated, not imported from behavior.ts — see header comment) ---

function measureNodeHeight(node: Node, width: number): number {
  if (node.type === 'text') return textMeasurer.measureHeight(node, width)
  if (node.type === 'separator') return separatorMainSize(node)
  if (node.type === 'page-break') return 0
  if (node.type === 'image') return imageMeasurer.measureHeight(node, width)
  if (node.type === 'table') return tableMeasurer.measureHeight(node, width)
  if (node.type === 'chart') return chartMeasurer.measureHeight(node, width)
  return node.direction === 'row' ? layoutRow(node, width).contentHeight : layoutColumn(node, width).contentHeight
}

function layoutNode(node: Node, width: number): RenderedNode {
  if (node.type === 'text') return textMeasurer.layout(node, width)
  if (node.type === 'separator') return separatorMeasurer.layout(node, width)
  if (node.type === 'page-break') return { type: 'page-break', box: { x: 0, y: 0, width, height: 0 }, node }
  if (node.type === 'image') return imageMeasurer.layout(node, width)
  if (node.type === 'table') return tableMeasurer.layout(node, width)
  if (node.type === 'chart') return chartMeasurer.layout(node, width)
  return layoutGroupNode(node, width)
}

// Separator children already carry their final, orientation-correct box (full cross length in one
// dimension, thickness+2*margin in the other) computed by layoutRow/layoutColumn's own alignment
// math — layoutNode()/separatorMeasurer.layout() only knows the column/horizontal-bar orientation,
// so calling it here for a ROW separator would silently discard the row's stretched height. Use
// the already-resolved box directly instead; there's no further "internal content" to compute for
// a separator the way there is for text lines or nested group children.
function layoutResolvedChild(node: Node, box: Box): RenderedNode {
  if (node.type === 'separator') return { type: 'separator', box, node }
  return translateRendered(layoutNode(node, box.width), box.x, box.y)
}

function layoutGroupNode(node: GroupNode, width: number): RenderedNode {
  const result = node.direction === 'row' ? layoutRow(node, width) : layoutColumn(node, width)
  const children = result.children.map(c => layoutResolvedChild(c.node, c.box))
  return { type: 'group', box: { x: 0, y: 0, width, height: result.contentHeight }, node, children }
}

function isSplittableNode(node: Node): boolean {
  if (node.type === 'text') return true
  if (node.type === 'table') return true
  if (node.type !== 'group') return false
  return node.direction === 'column' || node.splitColumns === true
}

type AnySplitOutcome = { rendered: RenderedNode; consumedHeight: number; rest: Node | null } | null

function splitNode(node: Node, width: number, availableHeight: number): AnySplitOutcome {
  if (node.type === 'text') return textMeasurer.split!(node, width, availableHeight)
  if (node.type === 'table') return tableMeasurer.split!(node, width, availableHeight)
  if (node.type === 'group' && node.direction === 'column') return columnGroupSplit(node, width, availableHeight)
  if (node.type === 'group' && node.direction === 'row' && node.splitColumns === true) return rowGroupSplit(node, width, availableHeight)
  return null
}

// --- Row main-axis sizing: fixed (px flex) vs flexible (numeric weight, default 1) ---

export type RowChildSizing = { kind: 'fixed'; size: number } | { kind: 'flex'; weight: number }

// Two-pass flex-grow-style width resolution, shared between row-child width division (layoutRow,
// below) and table-column width division (table-layout.ts) — same math, different callers. Plain
// arithmetic with no Node-type dispatch, so sharing it carries none of the circular-import risk
// documented in this file's header comment. `availableWidth` should already have any gap total
// subtracted by the caller.
export function resolveFlexWidths(sizing: RowChildSizing[], availableWidth: number): number[] {
  const totalFixed = sizing.reduce((acc, s) => acc + (s.kind === 'fixed' ? s.size : 0), 0)
  const totalFlexWeight = sizing.reduce((acc, s) => acc + (s.kind === 'flex' ? s.weight : 0), 0)
  const remainingForFlex = Math.max(0, availableWidth - totalFixed)
  return sizing.map(s => (s.kind === 'fixed' ? s.size : totalFlexWeight > 0 ? (s.weight / totalFlexWeight) * remainingForFlex : 0))
}

function resolveRowChildSizing(node: Node): RowChildSizing {
  if (node.type === 'separator') return { kind: 'fixed', size: separatorMainSize(node) }
  if (node.type === 'page-break') return { kind: 'fixed', size: 0 } // inert as a row column — see nodes.ts
  const flex = node.flex
  if (typeof flex === 'string') return { kind: 'fixed', size: Number.parseFloat(flex) }
  return { kind: 'flex', weight: flex ?? 1 }
}

// A column that finished on an earlier page but whose row siblings still have content left needs
// a zero-height placeholder in its slot on the continuation row — otherwise the still-going
// columns would redistribute to fill the gap and the column grid would drift out of alignment
// with the same row's rendering on the previous page. Reproducing the ORIGINAL sizing (fixed px,
// or the same flex weight) rather than defaulting to flex: 1 is what keeps the width identical.
function emptyContinuationFor(node: Node): GroupNode {
  const sizing = resolveRowChildSizing(node)
  const flex: FlexSize = sizing.kind === 'fixed' ? `${sizing.size}px` : sizing.weight
  return { type: 'group', direction: 'column', flex, children: [] }
}

// Whether a row, considered as a shrink-wrap subtree (nested inside a column/row that isn't
// stretching it), has a well-defined natural width at all. A row with any flexible (non-fixed)
// child has no natural size of its own — flexible children always expand to fill whatever width
// they're offered — so such a row "wants" the full width offered to it, not a content-derived sum.
function rowHasFlexChild(node: GroupNode): boolean {
  return node.children.some(c => resolveRowChildSizing(c).kind === 'flex')
}

function sumFixedRowWidth(node: GroupNode, width: number): number {
  const gap = node.gap ?? 0
  const sum = node.children.reduce((acc, c) => {
    const sizing = resolveRowChildSizing(c)
    return acc + (sizing.kind === 'fixed' ? sizing.size : 0)
  }, 0)
  return Math.min(sum + gap * Math.max(0, node.children.length - 1), width)
}

// --- Cross/main width contribution helpers (shrink-wrap sizing for NESTED subtrees only — the
// direct children of an actual row's own layout are sized by the flex algorithm in layoutRow) ---

// Exported (unlike the other local dispatch helpers above) because table-layout.ts also needs it,
// for shrink-wrap cell content width when a cell's horizontal alignment isn't 'stretch' — this is
// the one direction of the group-layout.ts/table-layout.ts cycle documented in the header comment.
export function childCrossWidthInColumn(node: Node, width: number): number {
  if (node.type === 'text') return Math.min(measureTextNaturalWidth(node), width)
  if (node.type === 'separator') return width
  if (node.type === 'page-break') return width
  if (node.type === 'image') return Math.min(imageNaturalWidth(node, width), width)
  if (node.type === 'chart') return Math.min(chartNaturalWidth(node, width), width)
  // A table shrink-wrapped as a whole (not per-cell alignment, a separate concern handled entirely
  // within table-layout.ts) always wants the full width offered to it, same as separator/page-break.
  if (node.type === 'table') return width
  if (node.direction === 'row') {
    return rowHasFlexChild(node) ? width : sumFixedRowWidth(node, width)
  }
  // A nested column that itself stretches its own children also wants the full width offered to
  // it — otherwise its `crossAlign: 'stretch'` would be silently inert whenever a shrink-wrapping
  // ancestor hands it a content-sized box in the first place, mirroring the rowHasFlexChild check
  // above for nested rows.
  if (node.crossAlign === 'stretch') return width
  const max = node.children.reduce((acc, c) => Math.max(acc, childCrossWidthInColumn(c, width)), 0)
  return Math.min(max, width)
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
  const crossAlign = node.crossAlign ?? 'start'
  const mainAlign = node.mainAlign ?? 'start'
  const n = node.children.length

  const resolved = node.children.map(child => {
    const resolvedWidth = crossAlign === 'stretch' || child.type === 'separator' ? width : childCrossWidthInColumn(child, width)
    const height = measureNodeHeight(child, resolvedWidth)
    return { node: child, width: resolvedWidth, height }
  })

  const naturalMainSize = resolved.reduce((acc, r) => acc + r.height, 0) + gap * Math.max(0, n - 1)
  const mainSize = targetHeight !== undefined ? Math.max(targetHeight, naturalMainSize) : naturalMainSize
  const freeSpace = Math.max(0, mainSize - naturalMainSize)
  const { leading, between } = distributeFreeSpace(freeSpace, gap, n, mainAlign)

  let y = leading
  const children: LaidOutChild[] = []
  for (const r of resolved) {
    const x = crossAlign === 'stretch' ? 0 : crossAlign === 'center' ? (width - r.width) / 2 : crossAlign === 'end' ? width - r.width : 0
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
  const sizing = node.children.map(resolveRowChildSizing)
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
      const y = crossAlign === 'center' ? (rowHeight - r.height) / 2 : crossAlign === 'end' ? rowHeight - r.height : 0
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
      fitted.push(layoutResolvedChild(child.node, child.box))
      consumedHeight = childBottom
      continue
    }

    if (!cutMade) {
      const localAvailable = availableHeight - childTop
      if (localAvailable > 0 && isSplittableNode(child.node)) {
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
      fitted.push(layoutResolvedChild(child.node, box))
      rowConsumedHeight = Math.max(rowConsumedHeight, box.height)
      restChildren.push(emptyContinuationFor(child.node))
      continue
    }

    if (isSplittableNode(child.node)) {
      const childSplit = splitNode(child.node, box.width, availableHeight)
      if (childSplit !== null) {
        fitted.push(translateRendered(childSplit.rendered, box.x, 0))
        rowConsumedHeight = Math.max(rowConsumedHeight, childSplit.consumedHeight)
        if (childSplit.rest !== null) {
          restChildren.push(childSplit.rest)
          anyoneContinues = true
        } else {
          restChildren.push(emptyContinuationFor(child.node))
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

export const groupMeasurer: NodeMeasurer<GroupNode> = {
  // Static per-registry-entry field; the real, direction/splitColumns-aware check is behavior.ts's
  // isSplittable(node), which is what paginate.ts actually calls before invoking split().
  splittable: false,

  measureHeight(node, width) {
    return node.direction === 'row' ? layoutRow(node, width).contentHeight : layoutColumn(node, width).contentHeight
  },

  layout(node, width) {
    return layoutGroupNode(node, width)
  },

  split(node, width, availableHeight) {
    if (node.direction === 'column') return columnGroupSplit(node, width, availableHeight)
    if (node.direction === 'row' && node.splitColumns === true) return rowGroupSplit(node, width, availableHeight)
    return null
  },
}
