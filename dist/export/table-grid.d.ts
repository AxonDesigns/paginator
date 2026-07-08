import type { TableBorderMode } from '../core/nodes.js';
export type BorderSides = {
    top: boolean;
    bottom: boolean;
    left: boolean;
    right: boolean;
};
/** `rowStart`/`rowEnd`/`colStart`/`colEnd` are 0-indexed physical grid positions (inclusive) — a
 *  plain cell has rowStart===rowEnd and colStart===colEnd; a colSpan/rowSpan cell's merged block
 *  spans more than one. */
export declare function borderSides(mode: TableBorderMode, rowStart: number, rowEnd: number, colStart: number, colEnd: number, totalRows: number, columnCount: number): BorderSides;
export declare function borderStyleForThickness<T extends string>(thickness: number, styles: {
    thin: T;
    medium: T;
    thick: T;
}): T;
