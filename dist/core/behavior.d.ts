import type { Node } from './nodes.js';
import type { RenderedNode } from './geometry.js';
import type { PdfContext } from '../render/pdf-render.js';
export type SplitOutcome<T extends Node> = {
    /** The portion that fit this page, box-local (x=0, y=0). */
    rendered: RenderedNode;
    consumedHeight: number;
    /** null when the node finished exactly on this page. */
    rest: T | null;
} | null;
export type DomRenderCtx = {
    container: HTMLElement;
    originX: number;
    originY: number;
    unselectable: boolean;
};
export type PdfRenderCtx = {
    pdf: PdfContext;
    originX: number;
    originY: number;
};
export interface NodeTypeDefinition<T extends Node = Node, R extends RenderedNode = RenderedNode> {
    /** Full natural height this node occupies at `width`, ignoring page boundaries entirely. */
    measureHeight(node: T, width: number): number;
    /** Whether this node can be split across a page boundary. A function, not a static bool — group
     *  and container's splittability depends on runtime fields (direction/splitColumns/child), not
     *  just type. */
    isSplittable(node: T): boolean;
    /** Only ever called when `isSplittable(node)` is true. */
    split?(node: T, width: number, availableHeight: number): SplitOutcome<T>;
    /** Full, unpaginated layout, box-local (x=0, y=0). */
    layout(node: T, width: number): R;
    /** Shrink-wrap width for non-stretch column placement (see group.ts's childCrossWidthInColumn).
     *  Omitted = "wants the full width offered to it" (separator/page-break/table's own behavior).
     *  The generic `naturalWidth()` dispatcher below clamps the result to `availableWidth` itself, so
     *  implementations don't each need to repeat that `Math.min`. */
    naturalWidth?(node: T, availableWidth: number): number;
    renderDom(rendered: R, x: number, y: number, ctx: DomRenderCtx): void;
    drawPdf(rendered: R, x: number, y: number, ctx: PdfRenderCtx): void | Promise<void>;
}
export declare function registerNode<K extends Node['type']>(type: K, def: NodeTypeDefinition<Extract<Node, {
    type: K;
}>, Extract<RenderedNode, {
    type: K;
}>>): void;
export declare function measureNodeHeight(node: Node, width: number): number;
export declare function isSplittable(node: Node): boolean;
export declare function splitNode(node: Node, width: number, availableHeight: number): SplitOutcome<Node>;
export declare function layoutNodeFull(node: Node, width: number): RenderedNode;
/** Shrink-to-fit width for cross/main-axis sizing in Group/Table layout. */
export declare function naturalWidth(node: Node, availableWidth: number): number;
export declare function renderNodeDom(rendered: RenderedNode, originX: number, originY: number, ctx: {
    container: HTMLElement;
    unselectable: boolean;
}): void;
export declare function drawPdfNode(rendered: RenderedNode, originX: number, originY: number, pdf: PdfContext): Promise<void>;
