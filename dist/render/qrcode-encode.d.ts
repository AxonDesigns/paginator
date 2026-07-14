import type { QrErrorCorrectionLevel } from '../core/nodes.js';
export type QrMatrix = {
    moduleCount: number;
    isDark: (row: number, col: number) => boolean;
};
export declare function buildQrMatrix(value: string, errorCorrectionLevel: QrErrorCorrectionLevel): QrMatrix;
export declare function qrcodeRunsForRow(matrix: QrMatrix, row: number): {
    startCol: number;
    length: number;
}[];
