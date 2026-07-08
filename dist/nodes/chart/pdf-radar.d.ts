import type { RadarChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawRadarChart(ctx: PdfRenderCtx, node: RadarChartNode, plot: ChartBox, originX: number, originY: number): void;
