export type BarPattern = {
    runs: number[];
    totalModules: number;
    text: string;
};
export type BarcodeCheckDigitMode = 'auto' | 'validate' | 'omit';
export declare function encodeCode128(value: string): BarPattern;
export declare function encodeEan13(value: string, checkDigitMode?: BarcodeCheckDigitMode): BarPattern;
export declare function encodeCode39(value: string, checkDigitMode?: BarcodeCheckDigitMode): BarPattern;
export type BarcodeSymbology = 'code128' | 'ean13' | 'code39';
export declare function encodeBarcodeValue(symbology: BarcodeSymbology, value: string, checkDigitMode?: BarcodeCheckDigitMode): BarPattern;
