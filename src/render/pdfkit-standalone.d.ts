// @types/pdfkit types the 'pdfkit' (Node) and 'pdfkit/js/pdfkit.standalone' (no .js) specifiers via
// `export =`, which fights this project's `verbatimModuleSyntax` + no-esModuleInterop config. We
// import the actual browser bundle file, 'pdfkit/js/pdfkit.standalone.js', so this re-declares that
// exact specifier with a plain `export default` against the already-typed global PDFKit namespace
// (see @types/pdfkit's declare namespace PDFKit, referenced below since this project's tsconfig
// "types" array excludes @types/pdfkit from automatic inclusion).
/// <reference types="pdfkit" />

declare module 'pdfkit/js/pdfkit.standalone.js' {
  const PDFDocument: { new (options?: PDFKit.PDFDocumentOptions): PDFKit.PDFDocument }
  export default PDFDocument
}
