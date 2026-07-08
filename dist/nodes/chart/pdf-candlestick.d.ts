import type { CandlestickChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawCandlestickChart(ctx: PdfRenderCtx, node: CandlestickChartNode, plot: ChartBox, originX: number, originY: number): void;
