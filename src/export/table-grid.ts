// Shared table-border grid math for the docx/xlsx exporters — both walk a TableNode's ALREADY
// GRID-ALIGNED rows/cells (no pixel geometry involved, unlike pdf-render.ts's interval-straddle
// approach), so "does this cell's edge get a line, and which style (inner vs outer)" reduces to a
// simple row/col-index adjacency check against the table's independent inner/outer border modes.
import type { TableBorderLineMode } from '../core/nodes.ts'

export type BorderSide = 'none' | 'inner' | 'outer'
export type BorderSides = { top: BorderSide; bottom: BorderSide; left: BorderSide; right: BorderSide }

/** `rowStart`/`rowEnd`/`colStart`/`colEnd` are 0-indexed physical grid positions (inclusive) — a
 *  plain cell has rowStart===rowEnd and colStart===colEnd; a colSpan/rowSpan cell's merged block
 *  spans more than one. `innerMode`/`outerMode` resolve independently (pass `'none'` for a mode
 *  whose surrounding config is entirely absent — see nodes.ts's `TableNode.border` doc comment). */
export function borderSides(
  innerMode: TableBorderLineMode,
  outerMode: TableBorderLineMode,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  totalRows: number,
  columnCount: number,
): BorderSides {
  const outerH = outerMode === 'all' || outerMode === 'horizontal'
  const innerH = innerMode === 'all' || innerMode === 'horizontal'
  const outerV = outerMode === 'all' || outerMode === 'vertical'
  const innerV = innerMode === 'all' || innerMode === 'vertical'
  const sideFor = (isOuterEdge: boolean, outerFlag: boolean, innerFlag: boolean): BorderSide => (isOuterEdge ? (outerFlag ? 'outer' : 'none') : innerFlag ? 'inner' : 'none')
  return {
    top: sideFor(rowStart === 0, outerH, innerH),
    bottom: sideFor(rowEnd === totalRows - 1, outerH, innerH),
    left: sideFor(colStart === 0, outerV, innerV),
    right: sideFor(colEnd === columnCount - 1, outerV, innerV),
  }
}

export function borderStyleForThickness<T extends string>(thickness: number, styles: { thin: T; medium: T; thick: T }): T {
  if (thickness >= 3) return styles.thick
  if (thickness >= 2) return styles.medium
  return styles.thin
}
