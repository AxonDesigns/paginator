// PDF drawing for TableNode — port of the old pdf-render.ts's drawTableNode/drawTableBorders, using
// the same straddle/interval reasoning table/dom.ts's DOM version does; only the final draw call
// differs (pdfkit rect/fill/stroke instead of styled divs).

import type { RenderedNode, RenderedTableCell, RenderedTableRow } from '../../core/geometry.ts'
import { drawPdfNode } from '../../core/behavior.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import type { LineStyle, TableNode } from '../../core/nodes.ts'
import { applyLineStyle, pxToPt, resetLineStyle, resolvePdfColor, toPdfRect } from '../../render/pdf-render.ts'
import { BORDER_EPSILON, subtractIntervals } from '../../render/interval-utils.ts'
import { resolveColumnWidths } from './layout.ts'
import { createHorizontalLineStyler, resolveBorderLine, resolveOuterBorderRadius } from './border-resolve.ts'
import type { LineStyleResolved } from './border-resolve.ts'

type Rendered = Extract<RenderedNode, { type: 'table' }>

// 'solid' fills a rect directly (exact geometry, matches every segment's own straddle-avoided
// extent flush). 'dashed'/'dotted' can't be filled — no gaps — so they stroke the segment's
// centerline instead, same technique as separator.ts's own drawPdf.
function drawGridSegment(
  doc: PDFKit.PDFDocument,
  orientation: 'horizontal' | 'vertical',
  lineCoord: number,
  segStart: number,
  segEnd: number,
  thickness: number,
  color: string,
  style: LineStyle,
): void {
  if (style === 'solid') {
    const rect = orientation === 'horizontal' ? toPdfRect(segStart, lineCoord, segEnd - segStart, thickness) : toPdfRect(lineCoord, segStart, thickness, segEnd - segStart)
    doc.rect(rect.x, rect.y, rect.width, rect.height).fill(color)
    return
  }
  const thicknessPt = pxToPt(thickness)
  const mid = lineCoord + thickness / 2
  const start = orientation === 'horizontal' ? { x: pxToPt(segStart), y: pxToPt(mid) } : { x: pxToPt(mid), y: pxToPt(segStart) }
  const end = orientation === 'horizontal' ? { x: pxToPt(segEnd), y: pxToPt(mid) } : { x: pxToPt(mid), y: pxToPt(segEnd) }
  doc.lineWidth(thicknessPt)
  applyLineStyle(doc, style, thicknessPt)
  doc.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke(color)
  resetLineStyle(doc)
}

function drawTableBorders(
  ctx: PdfRenderCtx,
  node: TableNode,
  rendered: Rendered,
  colWidths: number[],
  colX: number[],
  originX: number,
  originY: number,
  x: number,
  y: number,
  roundOuter: boolean,
): void {
  const hasRowOverrides = rendered.rows.some(r => r.topBorder !== undefined || r.bottomBorder !== undefined)
  if (node.border === undefined && !hasRowOverrides) return
  const doc = ctx.pdf.doc

  // `inner`/`outer` resolve fully independently — see border-resolve.ts. A row's own
  // `topBorder`/`bottomBorder` draws independently of `node.border` entirely, same as
  // `TableCell.border` already does.
  const inner = resolveBorderLine(node.border, 'inner')
  const outer = resolveBorderLine(node.border, 'outer')

  const innerV = inner.mode === 'all' || inner.mode === 'vertical'
  const outerV = outer.mode === 'all' || outer.mode === 'vertical'

  const tableTop = y
  const tableBottom = y + rendered.box.height
  const tableLeft = x
  const tableRight = x + rendered.box.width

  const cellBox = (cell: RenderedTableCell) => ({
    left: originX + cell.box.x,
    top: originY + cell.box.y,
    right: originX + cell.box.x + cell.box.width,
    bottom: originY + cell.box.y + cell.box.height,
  })

  // A colSpan-aware 'header' row (`row.cells` set, see nodes.ts) behaves exactly like an ordinary
  // row for border purposes — its cells only straddle the lines their own colSpan actually crosses.
  const cellBoxes = rendered.rows.flatMap(row => (row.kind === 'header' ? (row.cells ?? []).map(cellBox) : row.cells.map(cellBox)))

  // Only a `content`-shaped 'header' row (no per-column cells) needs the "straddles every inner
  // vertical line" treatment — a `cells`-shaped header is already fully covered by `cellBoxes` above.
  const headerRowVRanges: [number, number][] = rendered.rows
    .filter((row): row is Extract<RenderedTableRow, { kind: 'header' }> => row.kind === 'header' && row.cells === undefined)
    .map(row => [originY + row.box.y, originY + row.box.y + row.box.height])

  // Horizontal lines: style resolution (row override > headerSeparator > outer-position > inner)
  // is centralized in border-resolve.ts so this file and dom.ts can't drift on the precedence rule.
  const { styler, candidateYs } = createHorizontalLineStyler({
    rows: rendered.rows,
    originY,
    tableTop,
    tableBottom,
    headerRows: node.headerRows ?? 0,
    headerSeparatorConfig: node.border?.headerSeparator,
    inner,
    outer,
    roundOuter,
  })
  for (const lineY of candidateYs) {
    const resolved = styler(lineY)
    if (resolved === null) continue
    const straddling = cellBoxes.filter(b => b.top < lineY - BORDER_EPSILON && lineY + BORDER_EPSILON < b.bottom)
    const segments = subtractIntervals([tableLeft, tableRight], straddling.map(b => [b.left, b.right] as const))
    for (const [segStart, segEnd] of segments) drawGridSegment(doc, 'horizontal', lineY, segStart, segEnd, resolved.thickness, resolvePdfColor(resolved.color), resolved.style)
  }

  const vLines: { x: number; line: LineStyleResolved }[] = []
  if (outerV && !roundOuter) vLines.push({ x: tableLeft, line: outer }, { x: tableRight, line: outer })
  if (innerV) {
    for (let i = 0; i < colWidths.length - 1; i++) vLines.push({ x: originX + colX[i]! + colWidths[i]!, line: inner })
  }
  for (const { x: lineX, line } of vLines) {
    const straddling = cellBoxes.filter(b => b.left < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < b.right)
    const headerHoles = tableLeft < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < tableRight ? headerRowVRanges : []
    const segments = subtractIntervals([tableTop, tableBottom], [...straddling.map(b => [b.top, b.bottom] as const), ...headerHoles])
    for (const [segStart, segEnd] of segments) drawGridSegment(doc, 'vertical', lineX, segStart, segEnd, line.thickness, resolvePdfColor(line.color), line.style)
  }
}

export async function drawTableNode(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): Promise<void> {
  const node = rendered.node
  const { originX, originY } = ctx
  const doc = ctx.pdf.doc
  const colWidths = resolveColumnWidths(node, rendered.box.width)
  const colX: number[] = []
  let acc = 0
  for (const w of colWidths) {
    colX.push(acc)
    acc += w
  }

  const outer = resolveBorderLine(node.border, 'outer')
  const radius = resolveOuterBorderRadius(node.border)
  const roundOuter = outer.mode === 'all' && radius > 0

  // pdfkit clip regions are pure graphics-state (`save`/`clip`/`restore`), unaffected by coordinate
  // math — unlike the DOM renderer, no origin rebasing is needed here. Clips just the cell
  // backgrounds/content/per-cell borders drawn below; the outer border stroke itself is drawn by
  // drawTableBorders() AFTER restore() (see its own roundOuter branch and the call site below), so
  // the stroke centered on the clip boundary isn't half-clipped by its own clip path.
  if (roundOuter) {
    const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
    const r = pxToPt(Math.max(0, Math.min(radius, rendered.box.width / 2, rendered.box.height / 2)))
    doc.save()
    doc.roundedRect(rect.x, rect.y, rect.width, rect.height, r).clip()
  }

  // Shared by an ordinary 'cells' row AND a colSpan-aware 'header' row (see nodes.ts) — same
  // per-cell background-then-content drawing either way.
  const drawCellsRow = async (cells: RenderedTableCell[]): Promise<void> => {
    for (const cell of cells) {
      if (cell.background === undefined) continue
      const rect = toPdfRect(originX + cell.box.x, originY + cell.box.y, cell.box.width, cell.box.height)
      doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(cell.background))
    }
    for (const cell of cells) await drawPdfNode(cell.rendered, originX, originY, ctx.pdf)
    // Per-cell border, drawn last (on top of background/content) — a plain stroked rect on the
    // cell's own full box, independent of the table-wide border modes (see TableCell.border's doc
    // comment in nodes.ts: two adjacent bordered cells double up, by design).
    for (const cell of cells) {
      if (cell.border === undefined) continue
      const rect = toPdfRect(originX + cell.box.x, originY + cell.box.y, cell.box.width, cell.box.height)
      const thicknessPt = pxToPt(cell.border.thickness ?? 1)
      applyLineStyle(doc, cell.border.style, thicknessPt)
      doc.rect(rect.x, rect.y, rect.width, rect.height).lineWidth(thicknessPt).stroke(resolvePdfColor(cell.border.color ?? '#000000'))
      resetLineStyle(doc)
    }
  }

  for (const row of rendered.rows) {
    if (row.kind === 'header') {
      if (row.cells !== undefined) {
        await drawCellsRow(row.cells)
        continue
      }
      if (row.background !== undefined) {
        const rect = toPdfRect(originX + row.box.x, originY + row.box.y, row.box.width, row.box.height)
        doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(row.background))
      }
      await drawPdfNode(row.content!, originX, originY, ctx.pdf)
      continue
    }
    await drawCellsRow(row.cells)
  }

  if (roundOuter) {
    const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
    const r = pxToPt(Math.max(0, Math.min(radius, rendered.box.width / 2, rendered.box.height / 2)))
    doc.restore()
    const thicknessPt = pxToPt(outer.thickness)
    applyLineStyle(doc, outer.style, thicknessPt)
    doc.roundedRect(rect.x, rect.y, rect.width, rect.height, r).lineWidth(thicknessPt).stroke(resolvePdfColor(outer.color))
    resetLineStyle(doc)
  }

  drawTableBorders(ctx, node, rendered, colWidths, colX, originX, originY, x, y, roundOuter)
}
