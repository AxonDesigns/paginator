import type { CategoricalChartNode } from '../../core/nodes.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
import type { ChartBox } from '../../render/chart-geometry.js';
export declare function drawCategoricalChart(ctx: PdfRenderCtx, node: CategoricalChartNode, plot: ChartBox, originX: number, originY: number): void;
