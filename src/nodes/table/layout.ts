// Table layout: a fixed grid of TableColumn × TableRow, each cell holding arbitrary nested content.
// Rows are atomic (a row's content never splits mid-row) — and, when colSpan/rowSpan are in play, a
// rowSpan cluster of physical rows is atomic as a whole (see "Cell spans" in GUIDE.md). The table
// itself splits between rows/clusters, with `headerRows` leading rows repeating at the top of every
// continuation page.
//
// Column grouping (report-style row grouping + subtotals, see GUIDE.md) is desugared entirely at
// `table()` build time (nodes.ts) — by the time a TableNode reaches this file, `column.group` is
// already gone and any grouped rows are already synthesized `kind: 'header'` rows woven into a plain
// flat `rows` array. Cell spans are ALSO resolved entirely at `table()` build time
// (`resolveCellSpans()`), baking `__resolvedCol`/`__atomicWithNext` onto cells/rows — this file never
// re-derives implicit-flow column positions or span-cluster boundaries, it just reads them.
//
// Unlike the old table-layout.ts, cell content dispatches into the fully generic
// measureNodeHeight/layoutNodeFull dispatchers from behavior.ts — safe now that behavior.ts never
// imports concrete node modules, so there's no cycle left to avoid by hand-rolling a local copy.

import type { ContainerBorder, Node, TableCell, TableColumn, TableNode, TableRow } from '../../core/nodes.ts'
import type { Box, RenderedNode, RenderedTableCell, RenderedTableRow } from '../../core/geometry.ts'
import { translateRendered } from '../../core/geometry.ts'
import { layoutNodeFull, measureNodeHeight } from '../../core/behavior.ts'
import type { SplitOutcome } from '../../core/behavior.ts'
import { resolveFlexWidths } from '../../core/flex-widths.ts'
import type { RowChildSizing } from '../../core/flex-widths.ts'
import { childCrossWidthInColumn } from '../group.ts'

const EPSILON = 0.01

// px indented per nesting depth level, applied only to group header bars — data/totals rows stay
// aligned under their columns regardless of grouping depth (indenting them would misalign them
// from the column grid). Fixed, not configurable this pass — see GUIDE.md.
const GROUP_INDENT = 16

// `content` is optional on TableCell (unset for a grouped column's cell, which never reaches this
// file post-desugaring). table()'s own validation already guarantees it's present on every cell
// that DOES reach here — this makes a future desugaring bug fail loudly at one obvious spot
// instead of a confusing `undefined.type` crash deeper inside measureNodeHeight/layoutNodeFull.
function requireContent(cell: TableCell): Node {
  if (cell.content === undefined) {
    throw new Error('[paginator] table cell is missing "content" — this indicates a table() validation bug, not a normal runtime condition.')
  }
  return cell.content
}

// --- Column width resolution (same two-pass flex-grow model as row-child width division) ---

// A column's 'shrink' width (see FlexSize in nodes.ts) is the max natural/shrink-wrap width across
// every colSpan-1 cell in that column (own resolved padding included) — the same
// childCrossWidthInColumn() mechanism a column CHILD of a row/column group uses to hug its content,
// just maxed over every row's cell instead of a single subtree. A colSpan>1 cell doesn't contribute
// to any one column — there's no unambiguous way to attribute a spanning cell's width to one of the
// columns it spans (mirroring the simplification resolveCellSpans() already makes elsewhere for
// spans) — so a column whose only cells all span >1 column falls back to 0 (effectively invisible
// unless some other column's content forces the table wider). A `'header'` row's `.content` form
// (full-width group bar, not per-column) never contributes either; its `.cells` form does, same as
// an ordinary data row.
function columnNaturalWidth(column: TableColumn, columnIndex: number, rows: TableRow[], cellPadding: number, boundWidth: number): number {
  let max = 0
  for (const row of rows) {
    const cells = row.cells
    if (cells === undefined) continue
    cells.forEach((cell, i) => {
      const resolvedCol = cell.__resolvedCol ?? i
      if (resolvedCol !== columnIndex || (cell.colSpan ?? 1) !== 1) return
      const padding = cell.padding ?? column.padding ?? cellPadding
      const availableWidth = Math.max(0, boundWidth - 2 * padding)
      const natural = childCrossWidthInColumn(requireContent(cell), availableWidth)
      max = Math.max(max, natural + 2 * padding)
    })
  }
  return max
}

function resolveColumnSizing(column: TableColumn, columnIndex: number, rows: TableRow[], cellPadding: number, boundWidth: number): RowChildSizing {
  const flex = column.width
  if (flex === 'shrink') return { kind: 'fixed', size: columnNaturalWidth(column, columnIndex, rows, cellPadding, boundWidth) }
  if (typeof flex === 'string') return { kind: 'fixed', size: Number.parseFloat(flex) }
  return { kind: 'flex', weight: flex ?? 1 }
}

// Exported for table/dom.ts's and table/pdf.ts's border-line positions, and for the xlsx exporter
// (which reuses this real implementation — unlike generateDocx()'s deliberately DOM/pretext-free
// reimplementation, resolveColumnWidthsPx() in docx-export.ts, which can't compute a 'shrink' width
// and falls back to an equal flex-grow weight instead, with a one-time console warning).
export function resolveColumnWidths(node: Pick<TableNode, 'columns' | 'rows' | 'cellPadding'>, width: number): number[] {
  const cellPadding = node.cellPadding ?? 0
  const sizing = node.columns.map((c, i) => resolveColumnSizing(c, i, node.rows, cellPadding, width))
  return resolveFlexWidths(sizing, width)
}

function sumRange(values: number[], start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) sum += values[i] ?? 0
  return sum
}

// --- Cell alignment resolution ---

type ResolvedCell = { contentBox: Box; rendered: RenderedNode; padding: number }

// colWidth is the cell's FULL effective width — already summed across colSpan by the caller, so
// this function itself needs no awareness of spans at all. `tablePadding` is the table-wide
// default (TableNode.cellPadding); resolution order for what actually applies to THIS cell is
// cell.padding ?? column.padding ?? tablePadding, mirroring how `background` already resolves
// (cell ?? row ?? column) in prepareRowCells below.
function layoutCell(cell: TableCell, column: TableColumn, colWidth: number, tablePadding: number): ResolvedCell {
  const padding = cell.padding ?? column.padding ?? tablePadding
  const availableWidth = Math.max(0, colWidth - 2 * padding)
  const hAlign = cell.align ?? column.align ?? 'stretch'
  const content = requireContent(cell)
  const contentWidth = hAlign === 'stretch' ? availableWidth : Math.min(childCrossWidthInColumn(content, availableWidth), availableWidth)
  const contentHeight = measureNodeHeight(content, contentWidth)
  const x = padding + (hAlign === 'center' ? (availableWidth - contentWidth) / 2 : hAlign === 'end' ? availableWidth - contentWidth : 0)
  const rendered = translateRendered(layoutNodeFull(content, contentWidth), x, padding)
  return { contentBox: { x, y: padding, width: contentWidth, height: contentHeight }, rendered, padding }
}

type CellsRow = Extract<TableRow, { kind?: 'cells' }>
type HeaderRow = Extract<TableRow, { kind: 'header' }>

// A cell resolved to its grid position/size, with content already horizontally aligned + laid out
// (the `rendered`/`contentBox` from layoutCell), but NOT yet vertically positioned — that depends
// on the FINAL row height (or, for a rowSpan cell, the combined height of every row it spans),
// which isn't known until resolveRowHeights() has considered the whole table (or at least the
// rows in this cell's span) — see resolveRowHeights() below.
type PreparedCell = {
  resolvedCol: number
  colSpan: number
  rowSpan: number
  width: number // combined width across colSpan
  naturalHeight: number // this cell's own natural content height at `width`
  hAlignedRendered: RenderedNode // horizontally positioned + padding-y baked in; vertical align offset added later
  background?: string
  border?: ContainerBorder
  verticalAlign: 'start' | 'center' | 'end'
  padding: number // resolved cell.padding ?? column.padding ?? table cellPadding
}

function prepareRowCells(row: CellsRow, columns: TableColumn[], colWidths: number[], cellPadding: number): PreparedCell[] {
  return row.cells.map((cell, i) => {
    const resolvedCol = cell.__resolvedCol ?? i
    const colSpan = cell.colSpan ?? 1
    const rowSpan = cell.rowSpan ?? 1
    const width = sumRange(colWidths, resolvedCol, resolvedCol + colSpan)
    const column = columns[resolvedCol]!
    const laid = layoutCell(cell, column, width, cellPadding)
    return {
      resolvedCol,
      colSpan,
      rowSpan,
      width,
      naturalHeight: laid.contentBox.height,
      hAlignedRendered: laid.rendered,
      background: cell.background ?? row.background ?? column.background,
      border: cell.border,
      verticalAlign: cell.verticalAlign ?? row.verticalAlign ?? column.verticalAlign ?? 'start',
      padding: laid.padding,
    }
  })
}

// Computes every physical row's FINAL height (one entry per row in `rows`, header rows included),
// accounting for rowSpan cells whose combined content needs more height than the rows they span
// naturally provide. Two passes:
// 1. Intrinsic: each row's height from only the cells that START there — a cell with rowSpan > 1 is
//    EXCLUDED from its own starting row's intrinsic contribution (handled entirely by pass 2
//    instead, against the full span, to avoid double-counting).
// 2. Span-deficit: for every rowSpan > 1 cell, compare its own natural height against the sum of
//    its spanned rows' intrinsic heights (from pass 1); if taller, the ENTIRE deficit is added to
//    the LAST row in the span — not distributed proportionally. Deliberately simple over full
//    CSS-table-style proportional redistribution; see GUIDE.md's Known Limitations for the visual
//    trade-off this creates (extra space lands entirely in whatever ordinary cells share that last
//    row, not spread evenly across the whole span).
export function resolveRowHeights(rows: TableRow[], columns: TableColumn[], colWidths: number[], cellPadding: number): number[] {
  const fullWidth = colWidths.reduce((a, b) => a + b, 0)
  const preparedPerRow: (PreparedCell[] | null)[] = []
  const heights: number[] = []

  for (const row of rows) {
    if (row.kind === 'header') {
      if (row.cells !== undefined) {
        // Column-grid-aligned cells header, measured exactly like an ordinary row's intrinsic pass
        // (no GROUP_INDENT/depth-based width reduction — these cells align with the real column
        // grid, same as a totals() row, so indenting them would misalign against data rows below).
        // rowSpan is guaranteed 1 here (resolveCellSpans() at build time already rejects >1), so
        // there's nothing for a second/deficit pass to do — never pushed into preparedPerRow since
        // the deficit pass below explicitly skips every header row regardless.
        const prepared = prepareRowCells({ cells: row.cells, background: row.background }, columns, colWidths, cellPadding)
        preparedPerRow.push(null)
        heights.push(prepared.reduce((acc, c) => Math.max(acc, c.naturalHeight + 2 * c.padding), 0))
        continue
      }
      const availableWidth = Math.max(0, fullWidth - 2 * cellPadding - row.depth * GROUP_INDENT)
      heights.push(measureNodeHeight(row.content!, availableWidth) + 2 * cellPadding)
      preparedPerRow.push(null)
      continue
    }
    const prepared = prepareRowCells(row, columns, colWidths, cellPadding)
    preparedPerRow.push(prepared)
    const intrinsic = prepared.reduce((acc, c) => (c.rowSpan > 1 ? acc : Math.max(acc, c.naturalHeight + 2 * c.padding)), 0)
    heights.push(intrinsic)
  }

  rows.forEach((row, r) => {
    if (row.kind === 'header') return
    for (const cell of preparedPerRow[r]!) {
      if (cell.rowSpan <= 1) continue
      const spanEnd = r + cell.rowSpan // guaranteed <= rows.length by resolveCellSpans() at build time
      const combinedNatural = cell.naturalHeight + 2 * cell.padding
      const currentSum = sumRange(heights, r, spanEnd)
      if (combinedNatural > currentSum) {
        heights[spanEnd - 1] = heights[spanEnd - 1]! + (combinedNatural - currentSum)
      }
    }
  })

  return heights
}

export function layoutRows(rows: TableRow[], columns: TableColumn[], colWidths: number[], cellPadding: number): RenderedTableRow[] {
  const fullWidth = colWidths.reduce((a, b) => a + b, 0)
  const heights = resolveRowHeights(rows, columns, colWidths, cellPadding)

  const colX: number[] = []
  {
    let acc = 0
    for (const w of colWidths) {
      colX.push(acc)
      acc += w
    }
  }
  const rowY: number[] = []
  {
    let acc = 0
    for (const h of heights) {
      rowY.push(acc)
      acc += h
    }
  }

  const renderCells = (prepared: PreparedCell[], r: number): RenderedTableCell[] =>
    prepared.map(cell => {
      const boxHeight = cell.rowSpan > 1 ? sumRange(heights, r, r + cell.rowSpan) : heights[r]!
      const availableHeight = Math.max(0, boxHeight - 2 * cell.padding)
      const dy =
        cell.verticalAlign === 'center' ? (availableHeight - cell.naturalHeight) / 2 : cell.verticalAlign === 'end' ? availableHeight - cell.naturalHeight : 0
      const rendered = translateRendered(cell.hAlignedRendered, colX[cell.resolvedCol]!, rowY[r]! + dy)
      return { box: { x: colX[cell.resolvedCol]!, y: rowY[r]!, width: cell.width, height: boxHeight }, rendered, background: cell.background, border: cell.border }
    })

  return rows.map((row, r) => {
    if (row.kind === 'header') {
      if (row.cells !== undefined) {
        const prepared = prepareRowCells({ cells: row.cells, background: row.background }, columns, colWidths, cellPadding)
        return { kind: 'header', box: { x: 0, y: rowY[r]!, width: fullWidth, height: heights[r]! }, cells: renderCells(prepared, r) }
      }
      const availableWidth = Math.max(0, fullWidth - 2 * cellPadding - row.depth * GROUP_INDENT)
      const content = translateRendered(layoutNodeFull(row.content!, availableWidth), cellPadding + row.depth * GROUP_INDENT, rowY[r]! + cellPadding)
      return { kind: 'header', box: { x: 0, y: rowY[r]!, width: fullWidth, height: heights[r]! }, background: row.background, content }
    }

    const prepared = prepareRowCells(row, columns, colWidths, cellPadding)
    return { kind: 'cells', box: { x: 0, y: rowY[r]!, width: fullWidth, height: heights[r]! }, cells: renderCells(prepared, r) }
  })
}

// Whether a depth-`depth` group still has any of its own rows left in `rows` (which starts right
// after the page cut) — false if the group already finished exactly at the cut (e.g. its own
// `totals` row was the very last thing that fit): scanning hits a header at `depth` or shallower
// (a sibling-or-ancestor group starting/ending) before any actual content, meaning nothing here
// belongs to this header anymore. A deeper header (still nested inside) doesn't count as ending it.
function hasRemainingContentAtDepth(rows: TableRow[], depth: number): boolean {
  for (const row of rows) {
    if (row.kind === 'header') {
      if (row.depth <= depth) return false
      continue
    }
    return true
  }
  return false
}

// A row can't be separated from the NEXT row by a page cut if it's a 'cells' row with
// `__atomicWithNext` set (baked in by table()'s resolveCellSpans() whenever a rowSpan cell starting
// at or before this row still has rows left to cover after it). Always false for a 'header' row and
// for an ordinary (non-spanning) table, where every row is its own single-row cluster, exactly like
// before this feature existed.
function isAtomicWithNext(row: TableRow): boolean {
  return row.kind !== 'header' && (row.__atomicWithNext ?? false)
}

export function measureTableHeight(node: TableNode, width: number): number {
  const colWidths = resolveColumnWidths(node, width)
  const cellPadding = node.cellPadding ?? 0
  return resolveRowHeights(node.rows, node.columns, colWidths, cellPadding).reduce((a, b) => a + b, 0)
}

export function layoutTable(node: TableNode, width: number): Extract<RenderedNode, { type: 'table' }> {
  const colWidths = resolveColumnWidths(node, width)
  const cellPadding = node.cellPadding ?? 0
  const rows = layoutRows(node.rows, node.columns, colWidths, cellPadding)
  const height = rows.reduce((acc, r) => acc + r.box.height, 0)
  return { type: 'table', box: { x: 0, y: 0, width, height }, node, rows }
}

export function splitTable(node: TableNode, width: number, availableHeight: number): SplitOutcome<TableNode> {
  const colWidths = resolveColumnWidths(node, width)
  const cellPadding = node.cellPadding ?? 0
  const headerRows = node.headerRows ?? 0
  const headerBlock = node.rows.slice(0, headerRows)
  const dataRows = node.rows.slice(headerRows)

  const allHeights = resolveRowHeights(node.rows, node.columns, colWidths, cellPadding)
  const headerBlockHeight = sumRange(allHeights, 0, headerRows)
  const dataHeights = allHeights.slice(headerRows)
  const remainderForData = availableHeight - headerBlockHeight

  // Tracks which group header(s) are "in scope" as we walk — index d holds the most recently
  // placed depth-d header still open (not yet closed by a shallower-or-equal header). Rebuilt
  // fresh on every split() call by walking `dataRows` from its own start.
  const activeHeaders: HeaderRow[] = []
  const fittedData: TableRow[] = []
  let dataHeight = 0
  let i = 0
  while (i < dataRows.length) {
    // Extend the cluster past `i` while each row so far is atomically bound to the next one —
    // for an ordinary (non-spanning) table this loop never advances, so every cluster is exactly
    // one row, byte-for-byte the pre-spans behavior.
    let clusterEnd = i
    while (clusterEnd + 1 < dataRows.length && isAtomicWithNext(dataRows[clusterEnd]!)) clusterEnd++

    const clusterHeight = sumRange(dataHeights, i, clusterEnd + 1)
    if (dataHeight + clusterHeight > remainderForData + EPSILON) break

    for (let j = i; j <= clusterEnd; j++) {
      const row = dataRows[j]!
      fittedData.push(row)
      if (row.kind === 'header') {
        activeHeaders.length = row.depth
        activeHeaders.push(row)
      }
    }
    dataHeight += clusterHeight
    i = clusterEnd + 1
  }

  if (fittedData.length === 0) return null // orphan: not even one cluster fit (header rows alone don't count as progress)

  const consumedHeight = headerBlockHeight + dataHeight
  const restDataRows = dataRows.slice(fittedData.length)
  const renderedRows = layoutRows([...headerBlock, ...fittedData], node.columns, colWidths, cellPadding)

  // `node` here is the FULL original node (unsliced) — background/border resolution happens at
  // layout time above rather than by re-indexing node.rows/node.columns positionally against
  // rendered.rows at render time (which column grouping's synthesized rows would break).
  const rendered: RenderedNode = {
    type: 'table',
    box: { x: 0, y: 0, width, height: consumedHeight },
    node,
    rows: renderedRows,
  }

  let rest: TableNode | null = null
  if (restDataRows.length > 0) {
    // Independent of each other: `repeatHeaderRow` governs the table's own literal caption
    // prefix; each active group header's own (already-resolved) `.repeat` governs itself.
    const repeatHeaderRow = node.repeatHeaderRow ?? true
    const repeatedGroupHeaders = activeHeaders.filter(h => h.repeat !== false && hasRemainingContentAtDepth(restDataRows, h.depth))
    rest = {
      ...node,
      rows: [...(repeatHeaderRow ? headerBlock : []), ...repeatedGroupHeaders, ...restDataRows],
      headerRows: repeatHeaderRow ? headerRows : 0,
    }
  }

  return { rendered, consumedHeight, rest }
}
