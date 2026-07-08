import type { RenderedNode } from '../../core/geometry.js';
import type { DomRenderCtx } from '../../core/behavior.js';
type Rendered = Extract<RenderedNode, {
    type: 'chart';
}>;
export declare function renderChartNode(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void;
export {};
