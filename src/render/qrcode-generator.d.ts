// `qrcode-generator`'s own bundled `dist/qrcode.d.ts` types its default export via
// `export = qrcode` (a CJS-style `import ... = require(...)` pattern), which fights this
// project's `verbatimModuleSyntax` config — the same friction `svg-to-pdfkit.d.ts` documents.
// Its real ESM build (`dist/qrcode.mjs`, resolved via the package's `exports.import` condition)
// uses a genuine `export default qrcode`, so this re-declares the module directly instead of
// pulling in the mismatched bundled types.
//
// Deliberately typed to ONLY the raw module-matrix API this project ever calls
// (`addData`/`make`/`getModuleCount`/`isDark`) — the library's own `createSvgTag`/`createImgTag`/
// `createDataURL`/`renderTo2dContext`/etc. render helpers are intentionally omitted so calling
// them is a compile error: this codebase only ever wants the raw QR data, never the library's own
// rendering (see qrcode-encode.ts).
declare module 'qrcode-generator' {
  type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

  interface QRCode {
    addData(data: string): void
    make(): void
    getModuleCount(): number
    isDark(row: number, col: number): boolean
  }

  export default function qrcode(typeNumber: number, errorCorrectionLevel: QrErrorCorrectionLevel): QRCode
}
