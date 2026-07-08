import type { RenderedNode } from '../../core/geometry.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox, LegendEntry } from '../../render/chart-geometry.js';
import type { ChartText } from '../../core/nodes.js';
type Rendered = Extract<RenderedNode, {
    type: 'chart';
}>;
export declare function drawChartLine(ctx: PdfRenderCtx, x1: number, y1: number, x2: number, y2: number, color: string, thickness: number, originX: number, originY: number): void;
export declare function drawChartPathStroke(ctx: PdfRenderCtx, d: string, color: string, thickness: number, originX: number, originY: number): void;
export declare function drawChartAreaFill(ctx: PdfRenderCtx, d: string, gx1: number, gy1: number, gx2: number, gy2: number, color: string, opacity: number, originX: number, originY: number): void;
export declare function drawChartCircle(ctx: PdfRenderCtx, cx: number, cy: number, r: number, color: string, originX: number, originY: number): void;
export declare function drawChartPath(ctx: PdfRenderCtx, d: string, color: string, originX: number, originY: number, opacity?: number): void;
export declare function drawChartText(ctx: PdfRenderCtx, text: ChartText, localX: number, localY: number, opts: {
    fontSize: number;
    color: string;
    anchor: 'start' | 'middle' | 'end';
    bold: boolean;
    fontFamily: string;
}, originX: number, originY: number): void;
export declare function drawChartLegend(ctx: PdfRenderCtx, entries: LegendEntry[], box: ChartBox, orientation: 'vertical' | 'horizontal', fontSize: number, fontFamily: string, color: string, originX: number, originY: number): void;
export declare function drawChartNode(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): void;
export {};
