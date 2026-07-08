export declare const PX_TO_PT = 0.75;
export declare function pxToPt(n: number): number;
export declare function pxToTwip(n: number): number;
/** Excel's column-width unit is roughly "characters of the default font" — ~7px per unit at 96dpi
 *  Calibri 11. An approximation, not pixel-exact (documented xlsx-export limitation). */
export declare function pxToExcelWidth(n: number): number;
export declare function pxToEmu(n: number): number;
