// Resolved layout geometry — always page-content-box-relative by the time pagination finishes.

import type { ChartNode, GroupNode, ImageNode, PageBreakNode, SeparatorNode, TableNode, TextNode } from './nodes.ts'

export type Box = { x: number; y: number; width: number; height: number }

export type PositionedLine = { x: number; y: number; width: number; text: string }

// `box` is the FULL cell extent (column width × row height) — NOT the content sub-box (that's
// `rendered.box`, inset within `box` by cellPadding/alignment). This is what makes background
// painting fully self-contained per cell at render time, with no external column-width/row-height
// lookup needed (see table-layout.ts and shadow-dom.ts).
export type RenderedTableCell = { box: Box; rendered: RenderedNode; background?: string }

export type RenderedTableRow =
  | { kind: 'cells'; box: Box; cells: RenderedTableCell[] }
  // Exactly one of `content`/`cells` is set, mirroring TableRow's header variant — `content` for a
  // single full-width Node, `cells` for colSpan-aware, column-grid-aligned cells (see nodes.ts).
  | { kind: 'header'; box: Box; background?: string; content?: RenderedNode; cells?: RenderedTableCell[] }

export type RenderedNode =
  | { type: 'text'; box: Box; node: TextNode; lines: PositionedLine[] }
  | { type: 'separator'; box: Box; node: SeparatorNode }
  | { type: 'group'; box: Box; node: GroupNode; children: RenderedNode[] }
  | { type: 'page-break'; box: Box; node: PageBreakNode }
  | { type: 'image'; box: Box; node: ImageNode }
  | { type: 'table'; box: Box; node: TableNode; rows: RenderedTableRow[] }
  | { type: 'chart'; box: Box; node: ChartNode }

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
  return { ...r, box }
}
