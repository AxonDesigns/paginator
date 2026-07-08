import type { GanttChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawGanttChart(ctx: PdfRenderCtx, node: GanttChartNode, plot: ChartBox, originX: number, originY: number): void;
