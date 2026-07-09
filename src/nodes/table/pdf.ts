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
): void {
  if (node.border === undefined || node.border.mode === 'none') return
  const mode = node.border.mode ?? 'all'
  const thickness = node.border.thickness ?? 1
  const color = resolvePdfColor(node.border.color ?? '#000000')
  const style = node.border.style ?? 'solid'
  const doc = ctx.pdf.doc

  const outerH = mode === 'all' || mode === 'outer' || mode === 'horizontal'
  const innerH = mode === 'all' || mode === 'horizontal'
  const outerV = mode === 'all' || mode === 'outer' || mode === 'vertical'
  const innerV = mode === 'all' || mode === 'vertical'

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

  const hYs: number[] = []
  if (outerH) hYs.push(tableTop, tableBottom)
  if (innerH) {
    for (let i = 0; i < rendered.rows.length - 1; i++) hYs.push(originY + rendered.rows[i]!.box.y + rendered.rows[i]!.box.height)
  }
  for (const lineY of hYs) {
    const straddling = cellBoxes.filter(b => b.top < lineY - BORDER_EPSILON && lineY + BORDER_EPSILON < b.bottom)
    const segments = subtractIntervals([tableLeft, tableRight], straddling.map(b => [b.left, b.right] as const))
    for (const [segStart, segEnd] of segments) drawGridSegment(doc, 'horizontal', lineY, segStart, segEnd, thickness, color, style)
  }

  const vXs: number[] = []
  if (outerV) vXs.push(tableLeft, tableRight)
  if (innerV) {
    for (let i = 0; i < colWidths.length - 1; i++) vXs.push(originX + colX[i]! + colWidths[i]!)
  }
  for (const lineX of vXs) {
    const straddling = cellBoxes.filter(b => b.left < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < b.right)
    const headerHoles = tableLeft < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < tableRight ? headerRowVRanges : []
    const segments = subtractIntervals([tableTop, tableBottom], [...straddling.map(b => [b.top, b.bottom] as const), ...headerHoles])
    for (const [segStart, segEnd] of segments) drawGridSegment(doc, 'vertical', lineX, segStart, segEnd, thickness, color, style)
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

  drawTableBorders(ctx, node, rendered, colWidths, colX, originX, originY, x, y)
}
