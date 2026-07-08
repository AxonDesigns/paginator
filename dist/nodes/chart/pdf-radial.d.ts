import type { RadialChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawRadialChart(ctx: PdfRenderCtx, node: RadialChartNode, plot: ChartBox, originX: number, originY: number): void;
