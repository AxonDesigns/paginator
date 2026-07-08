import type { RenderedNode } from '../../core/geometry.js';
import type { ChartNode } from '../../core/nodes.js';
type Rendered = Extract<RenderedNode, {
    type: 'chart';
}>;
export declare function chartNaturalWidth(node: ChartNode, availableWidth: number): number;
export declare function measureChartHeight(node: ChartNode, width: number): number;
export declare function layoutChart(node: ChartNode, width: number): Rendered;
export {};
