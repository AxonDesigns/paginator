import type { RenderedNode } from '../../core/geometry.js';
import type { PdfRenderCtx } from '../../core/behavior.js';
type Rendered = Extract<RenderedNode, {
    type: 'table';
}>;
export declare function drawTableNode(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): Promise<void>;
export {};
