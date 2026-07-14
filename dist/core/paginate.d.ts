import type { ContainerBorder, Margins, PageDef, Watermark } from './nodes.js';
import type { RenderedNode } from './geometry.js';
export type PaginatedMarginNote = {
    rendered: RenderedNode;
    x: number;
    y: number;
};
export type PaginatedPage = {
    pageNumber: number;
    header: RenderedNode | null;
    body: RenderedNode[];
    footer: RenderedNode | null;
    marginNotes: PaginatedMarginNote[];
    watermark: Watermark | null;
    background: string | null;
    border: ContainerBorder | null;
};
export type PaginatedResult = {
    pageSize: {
        width: number;
        height: number;
    };
    margins: Margins;
    headerHeight: number;
    footerHeight: number;
    headerGap: number;
    footerGap: number;
    pages: PaginatedPage[];
};
export declare function paginate(doc: PageDef): PaginatedResult;
