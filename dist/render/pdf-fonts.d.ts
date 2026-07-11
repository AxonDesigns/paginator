import type { PdfContext } from './pdf-render.js';
import type { RichTextNode, RichTextRun, TextNode } from '../core/nodes.js';
import type { FontStyle, RegisteredFont } from './font-registry.js';
export declare function resolveFontOrThrow(ctx: PdfContext, family: string, weight: number, style: FontStyle): string;
export declare function ensureRegisteredFont(ctx: PdfContext, font: RegisteredFont): string;
export declare function resolveTextFont(ctx: PdfContext, node: TextNode): string;
export declare function resolveRunFont(ctx: PdfContext, run: RichTextRun, node: RichTextNode): string;
export declare function resolveChartFontName(ctx: PdfContext, fontFamily: string, bold: boolean): string;
export declare function textNodeFontString(node: TextNode): string;
export declare function richTextNodeFontString(node: RichTextNode): string;
export declare function getMetricsCanvasCtx(): OffscreenCanvasRenderingContext2D;
export declare function measureFontMetricsPx(fontCss: string): {
    ascentPx: number;
    descentPx: number;
};
