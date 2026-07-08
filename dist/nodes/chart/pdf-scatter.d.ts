import type { ScatterChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawScatterChart(ctx: PdfRenderCtx, node: ScatterChartNode, plot: ChartBox, originX: number, originY: number): void;
