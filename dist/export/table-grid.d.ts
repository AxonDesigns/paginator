import type { TableBorderLineMode } from '../core/nodes.js';
export type BorderSide = 'none' | 'inner' | 'outer';
export type BorderSides = {
    top: BorderSide;
    bottom: BorderSide;
    left: BorderSide;
    right: BorderSide;
};
/** `rowStart`/`rowEnd`/`colStart`/`colEnd` are 0-indexed physical grid positions (inclusive) — a
 *  plain cell has rowStart===rowEnd and colStart===colEnd; a colSpan/rowSpan cell's merged block
 *  spans more than one. `innerMode`/`outerMode` resolve independently (pass `'none'` for a mode
 *  whose surrounding config is entirely absent — see nodes.ts's `TableNode.border` doc comment). */
export declare function borderSides(innerMode: TableBorderLineMode, outerMode: TableBorderLineMode, rowStart: number, rowEnd: number, colStart: number, colEnd: number, totalRows: number, columnCount: number): BorderSides;
export declare function borderStyleForThickness<T extends string>(thickness: number, styles: {
    thin: T;
    medium: T;
    thick: T;
}): T;
