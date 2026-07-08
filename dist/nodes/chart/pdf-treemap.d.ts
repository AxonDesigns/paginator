import type { TreemapChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawTreemapChart(ctx: PdfRenderCtx, node: TreemapChartNode, plot: ChartBox, originX: number, originY: number): void;
