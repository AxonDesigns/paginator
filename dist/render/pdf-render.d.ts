import type { PaginatedResult } from '../core/paginate.js';
import type { ImageNode, ObjectFit } from '../core/nodes.js';
import type { FontRegistry, RegisteredFont } from './font-registry.js';
export type PdfMetadata = {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
};
export declare const PX_TO_PT = 0.75;
export declare function pxToPt(n: number): number;
export type PdfContext = {
    doc: PDFKit.PDFDocument;
    fonts: FontRegistry;
    registeredFontNames: Map<RegisteredFont, string>;
    imageEmbedCache: Map<string, string>;
    fallbackFonts: {
        regular: string;
        bold: string;
        italic: string;
        boldItalic: string;
    };
    warnedMissingFonts: Set<string>;
};
export declare function toPdfRect(xPx: number, yPx: number, wPx: number, hPx: number): {
    x: number;
    y: number;
    width: number;
    height: number;
};
export declare function resolvePdfColor(css: string): string;
export declare function resolveObjectFitRects(mode: ObjectFit, iw: number, ih: number, bw: number, bh: number): {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
};
export declare function embedImage(ctx: PdfContext, node: Pick<ImageNode, 'src' | 'objectFit'>, boxWidthPx: number, boxHeightPx: number): Promise<string>;
/**
 * Generates a real, vector PDF from a PaginatedResult — the same data mount() renders to a shadow
 * DOM. Fonts referenced by a TextNode must be registered via registerFont() beforehand for the PDF's
 * line breaks/widths to be guaranteed identical to the on-screen preview; an unregistered font/weight/
 * style falls back to a Helvetica standard font with a one-time console.warn naming the gap, rather
 * than throwing — generation always succeeds. `metadata` is optional document-info pass-through.
 * `fonts` is the calling Paginator's own font registry (see paginator.ts) — kept separate per
 * instance so two Paginators registering different files under the same family/weight/style never
 * clobber each other's PDF output.
 */
export declare function generatePdf(result: PaginatedResult, fonts: FontRegistry, metadata?: PdfMetadata): Promise<Uint8Array>;
