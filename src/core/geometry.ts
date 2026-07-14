// Resolved layout geometry — always page-content-box-relative by the time pagination finishes.

import type { BarcodeNode, ChartNode, ContainerBorder, ContainerNode, GroupNode, ImageNode, PageBreakNode, QrcodeNode, RichTextNode, SeparatorNode, SvgNode, TableNode, TextNode } from './nodes.ts'

export type Box = { x: number; y: number; width: number; height: number }

export type PositionedLine = { x: number; y: number; width: number; text: string }

/** One mixed-style fragment within a richText line — `runIndex` points back into RichTextNode.runs. */
export type PositionedRun = { x: number; width: number; text: string; runIndex: number }
export type PositionedRichLine = { y: number; width: number; runs: PositionedRun[] }

// `box` is the FULL cell extent (column width × row height) — NOT the content sub-box (that's
// `rendered.box`, inset within `box` by cellPadding/alignment). This is what makes background
// painting fully self-contained per cell at render time, with no external column-width/row-height
// lookup needed (see table-layout.ts and shadow-dom.ts).
export type RenderedTableCell = { box: Box; rendered: RenderedNode; background?: string; border?: ContainerBorder }

// `topBorder`/`bottomBorder` mirror TableRow's own fields (nodes.ts) — a full-width accent line
// overriding whatever the table-wide border.inner/headerSeparator would otherwise draw at that
// row's own top/bottom boundary. Carried on both variants since either can be a totals row
// (`'cells'`) or a group header bar (`'header'`).
export type RenderedTableRow =
  | { kind: 'cells'; box: Box; cells: RenderedTableCell[]; topBorder?: ContainerBorder; bottomBorder?: ContainerBorder }
  // Exactly one of `content`/`cells` is set, mirroring TableRow's header variant — `content` for a
  // single full-width Node, `cells` for colSpan-aware, column-grid-aligned cells (see nodes.ts).
  | { kind: 'header'; box: Box; background?: string; content?: RenderedNode; cells?: RenderedTableCell[]; topBorder?: ContainerBorder; bottomBorder?: ContainerBorder }

export type RenderedNode =
  | { type: 'text'; box: Box; node: TextNode; lines: PositionedLine[] }
  | { type: 'richText'; box: Box; node: RichTextNode; lines: PositionedRichLine[] }
  // `orientation` tells the renderer which axis holds `thickness + 2*margin` so it can inset the
  // painted line by `margin` on that axis alone — 'horizontal' for a column child (rule spans full
  // width, thickness+margin along height), 'vertical' for a row child (divider spans full height,
  // thickness+margin along width). See separator.ts's top-of-file comment for the two cases.
  | { type: 'separator'; box: Box; node: SeparatorNode; orientation: 'horizontal' | 'vertical' }
  | { type: 'group'; box: Box; node: GroupNode; children: RenderedNode[] }
  | { type: 'page-break'; box: Box; node: PageBreakNode }
  | { type: 'image'; box: Box; node: ImageNode }
  | { type: 'svg'; box: Box; node: SvgNode }
  | { type: 'qrcode'; box: Box; node: QrcodeNode }
  | { type: 'barcode'; box: Box; node: BarcodeNode }
  | { type: 'table'; box: Box; node: TableNode; rows: RenderedTableRow[] }
  | { type: 'chart'; box: Box; node: ChartNode }
  | { type: 'container'; box: Box; node: ContainerNode; child: RenderedNode }

export function translateRendered(r: RenderedNode, dx: number, dy: number): RenderedNode {
  const box: Box = { x: r.box.x + dx, y: r.box.y + dy, width: r.box.width, height: r.box.height }
  if (r.type === 'group') {
    return { ...r, box, children: r.children.map(c => translateRendered(c, dx, dy)) }
  }
  if (r.type === 'table') {
    return {
      ...r,
      box,
      rows: r.rows.map((row): RenderedTableRow => {
        const rowBox: Box = { x: row.box.x + dx, y: row.box.y + dy, width: row.box.width, height: row.box.height }
        const translateCells = (cells: RenderedTableCell[]): RenderedTableCell[] =>
          cells.map(cell => ({
            ...cell,
            box: { x: cell.box.x + dx, y: cell.box.y + dy, width: cell.box.width, height: cell.box.height },
            rendered: translateRendered(cell.rendered, dx, dy),
          }))
        if (row.kind === 'header') {
          return {
            ...row,
            box: rowBox,
            content: row.content === undefined ? undefined : translateRendered(row.content, dx, dy),
            cells: row.cells === undefined ? undefined : translateCells(row.cells),
          }
        }
        return { ...row, box: rowBox, cells: translateCells(row.cells) }
      }),
    }
  }
  if (r.type === 'container') {
    return { ...r, box, child: translateRendered(r.child, dx, dy) }
  }
  return { ...r, box }
}
