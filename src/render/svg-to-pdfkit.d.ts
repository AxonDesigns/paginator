// @types/svg-to-pdfkit types its default export via `export = SVGtoPDF` (a CJS-style
// `import ... = require(...)` pattern), which fights this project's `verbatimModuleSyntax` +
// `module: esnext` config — the exact same friction pdfkit-standalone.d.ts documents for `pdfkit`
// itself. Rather than pull in `@types/svg-to-pdfkit` as a devDependency just to re-shim it, this
// declares the module directly with only the options this project actually passes.
// `PDFKit` is already an ambient global namespace via pdfkit-standalone.d.ts's own
// `/// <reference types="pdfkit" />`.

declare module 'svg-to-pdfkit' {
  function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: {
      width?: number
      height?: number
      preserveAspectRatio?: string
      warningCallback?: (warning: string) => void
    },
  ): void
  export default SVGtoPDF
}
