// Shared table-border grid math for the docx/xlsx exporters — both walk a TableNode's ALREADY
// GRID-ALIGNED rows/cells (no pixel geometry involved, unlike pdf-render.ts's interval-straddle
// approach), so "does this cell's edge get a line" reduces to a simple row/col-index adjacency
// check against the table's border mode.
import type { TableBorderMode } from '../core/nodes.ts'

export type BorderSides = { top: boolean; bottom: boolean; left: boolean; right: boolean }

/** `rowStart`/`rowEnd`/`colStart`/`colEnd` are 0-indexed physical grid positions (inclusive) — a
 *  plain cell has rowStart===rowEnd and colStart===colEnd; a colSpan/rowSpan cell's merged block
 *  spans more than one. */
export function borderSides(mode: TableBorderMode, rowStart: number, rowEnd: number, colStart: number, colEnd: number, totalRows: number, columnCount: number): BorderSides {
  const outerH = mode === 'all' || mode === 'outer' || mode === 'horizontal'
  const innerH = mode === 'all' || mode === 'horizontal'
  const outerV = mode === 'all' || mode === 'outer' || mode === 'vertical'
  const innerV = mode === 'all' || mode === 'vertical'
  return {
    top: rowStart === 0 ? outerH : innerH,
    bottom: rowEnd === totalRows - 1 ? outerH : innerH,
    left: colStart === 0 ? outerV : innerV,
    right: colEnd === columnCount - 1 ? outerV : innerV,
  }
}

export function borderStyleForThickness<T extends string>(thickness: number, styles: { thin: T; medium: T; thick: T }): T {
  if (thickness >= 3) return styles.thick
  if (thickness >= 2) return styles.medium
  return styles.thin
}
