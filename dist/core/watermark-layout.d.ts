import type { Watermark } from './nodes.js';
export type WatermarkInstance = {
    x: number;
    y: number;
};
export declare function resolveWatermarkInstances(watermark: Watermark, pageWidth: number, pageHeight: number, footprintWidth: number, footprintHeight: number): WatermarkInstance[];
