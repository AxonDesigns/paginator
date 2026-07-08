import type { ChartNode } from '../core/nodes.js';
import type { ChartText } from '../core/nodes.js';
export declare function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K];
export declare function svgText(content: ChartText, x: number, y: number, attrs: Record<string, string | number> & {
    fontSize?: number;
    fontFamily?: string;
    fill?: string;
}): SVGTextElement;
export declare function appendAreaFillGradient(svg: SVGSVGElement, axis: 'x' | 'y', from: number, to: number, color: string, opacity: number): string;
export declare function renderChartSvg(node: ChartNode, width: number, height: number): SVGSVGElement;
