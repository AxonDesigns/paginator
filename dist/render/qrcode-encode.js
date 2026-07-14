// Thin wrapper around `qrcode-generator`'s raw module-matrix API — the only file in this codebase
// that imports that package. Only `addData`/`make`/`getModuleCount`/`isDark` are ever called (see
// qrcode-generator.d.ts's header comment); the library's own SVG/canvas/image rendering helpers
// are never used — every renderer (DOM/PDF/DOCX) draws the matrix itself from `isDark`.
import qrcode from 'qrcode-generator';
export function buildQrMatrix(value, errorCorrectionLevel) {
    const qr = qrcode(0, errorCorrectionLevel); // typeNumber 0 = auto-select the smallest version that fits
    qr.addData(value);
    qr.make();
    const moduleCount = qr.getModuleCount();
    return { moduleCount, isDark: (row, col) => qr.isDark(row, col) };
}
// Run-length-merges each row's dark modules left-to-right — shared by DOM/PDF/DOCX so a QR code
// with large finder-pattern squares draws as a handful of wide rects per row instead of one rect
// per individual module.
export function qrcodeRunsForRow(matrix, row) {
    const runs = [];
    let openRun = null;
    for (let col = 0; col < matrix.moduleCount; col++) {
        if (matrix.isDark(row, col)) {
            if (openRun === null) {
                openRun = { startCol: col, length: 1 };
            }
            else {
                openRun.length++;
            }
        }
        else if (openRun !== null) {
            runs.push(openRun);
            openRun = null;
        }
    }
    if (openRun !== null)
        runs.push(openRun);
    return runs;
}
