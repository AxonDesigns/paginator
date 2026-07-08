// Shared px unit conversions for the docx/xlsx exporters. Deliberately NOT imported from
// pdf-render.ts (which pulls in pdfkit's browser-standalone bundle at module scope) — these are
// pure arithmetic with no such dependency, so they're duplicated here rather than dragging pdfkit
// into the docx/xlsx bundle.
export const PX_TO_PT = 0.75 // 96dpi px -> 72dpi pt, same convention pdf-render.ts uses.
export function pxToPt(n: number): number {
  return n * PX_TO_PT
}

const TWIPS_PER_PT = 20 // OOXML twip = 1/20 pt.
export function pxToTwip(n: number): number {
  return Math.round(pxToPt(n) * TWIPS_PER_PT)
}

/** Excel's column-width unit is roughly "characters of the default font" — ~7px per unit at 96dpi
 *  Calibri 11. An approximation, not pixel-exact (documented xlsx-export limitation). */
export function pxToExcelWidth(n: number): number {
  return Math.max(4, n / 7)
}

const EMU_PER_PX = 9525 // 914400 EMU/inch / 96px/inch — DrawingML floating-image offsets are in EMU.
export function pxToEmu(n: number): number {
  return Math.round(n * EMU_PER_PX)
}
