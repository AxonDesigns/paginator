// PDF font resolution, shared by every node type that draws text (text/richText/chart) plus
// pdf-render.ts's own watermark drawing. Split out of pdf-render.ts so those node modules don't need
// to depend on the whole generatePdf() orchestrator just to resolve a font.
//
// The reason this exists at all: pretext decided every line break by measuring against whatever font
// FILE the browser's canvas resolved for a TextNode's `fontFamily` string (see measure-text.ts /
// font-registry.ts's header comment). For the PDF's embedded vector glyphs to reproduce identical
// line breaks, it must embed that literal file — see font-registry.ts. A family/weight/style that
// was never registered can only still be drawn if it's one of pdfkit's Standard-14 fonts (no file
// needed, see resolveStandardFontName()) — anything else means generatePdf() has no font file to
// embed at all, so it throws rather than silently substituting a different font's glyph widths.
import { lookupFont, normalizeFontWeight, resolveStandardFontName } from "./font-registry.js";
export function resolveFontOrThrow(ctx, family, weight, style) {
    const registered = lookupFont(ctx.fonts, family, weight, style);
    if (registered !== undefined)
        return ensureRegisteredFont(ctx, registered);
    const standard = resolveStandardFontName(family, weight, style);
    if (standard !== undefined)
        return standard;
    throw new Error(`[paginator] generatePdf(): no font registered for family "${family}", weight ${weight}, style "${style}", and it is not one of pdfkit's ` +
        `standard 14 fonts (Helvetica/Times/Courier/Symbol/ZapfDingbats). Call registerFont({ family: '${family}', weight: ${weight}, ` +
        `style: '${style}', url: '...' }) before generatePdf(), or use one of the standard font families.`);
}
// pdfkit's registerFont() just stores the (name -> src) mapping for lazy resolution on first .font(name)
// use, so this is synchronous and needs no cache of its own beyond "was this RegisteredFont already
// registered under a name" — registering the same name twice would be harmless but wasteful.
// RegisteredFont.bytes (a plain Uint8Array) is accepted by pdfkit's font loader directly — confirmed
// via source (PDFFontFactory.open branches on `src instanceof Uint8Array`), no Buffer wrapping needed.
export function ensureRegisteredFont(ctx, font) {
    const cached = ctx.registeredFontNames.get(font);
    if (cached !== undefined)
        return cached;
    const name = `${font.family}|${font.weight}|${font.style}`;
    ctx.doc.registerFont(name, font.bytes);
    ctx.registeredFontNames.set(font, name);
    return name;
}
export function resolveTextFont(ctx, node) {
    const weight = normalizeFontWeight(node.fontWeight);
    const style = node.fontStyle === 'italic' ? 'italic' : 'normal';
    return resolveFontOrThrow(ctx, node.fontFamily, weight, style);
}
// Same registry lookup as resolveTextFont, but resolved per-run: family/weight/style each fall back
// from the run to the node's own paragraph-level default.
export function resolveRunFont(ctx, run, node) {
    const weight = normalizeFontWeight(run.fontWeight ?? node.fontWeight);
    const style = (run.fontStyle ?? node.fontStyle) === 'italic' ? 'italic' : 'normal';
    const family = run.fontFamily ?? node.fontFamily;
    return resolveFontOrThrow(ctx, family, weight, style);
}
// Chart text (title/axis/legend) goes through the SAME font registry a TextNode does. Chart weight is
// binary (bold for the title/emphasis cases, regular otherwise), unlike a TextNode's arbitrary
// numeric weight, so this maps that straight to 700/400 rather than plumbing a numeric weight through
// every chart draw call.
export function resolveChartFontName(ctx, fontFamily, bold) {
    return resolveFontOrThrow(ctx, fontFamily, bold ? 700 : 400, 'normal');
}
export function textNodeFontString(node) {
    const style = node.fontStyle === 'italic' ? 'italic ' : '';
    const weight = node.fontWeight ?? 400;
    return `${style}${weight} ${node.fontSize}px ${node.fontFamily}`;
}
export function richTextNodeFontString(node) {
    const style = node.fontStyle === 'italic' ? 'italic ' : '';
    const weight = node.fontWeight ?? 400;
    return `${style}${weight} ${node.fontSize}px ${node.fontFamily}`;
}
const fontMetricsCache = new Map();
let metricsCanvasCtx = null;
export function getMetricsCanvasCtx() {
    if (metricsCanvasCtx === null) {
        const ctx2d = new OffscreenCanvas(1, 1).getContext('2d');
        if (ctx2d === null)
            throw new Error('[paginator] generatePdf(): could not acquire a 2D context for text measurement.');
        metricsCanvasCtx = ctx2d;
    }
    return metricsCanvasCtx;
}
// Measuring ascent/descent via the browser's own canvas (rather than trusting the embedded font
// object's own metrics) ties baseline positioning to the identical source of truth pretext itself
// already trusts for width, rather than a second, independently computed one. Cached per distinct
// font CSS string.
export function measureFontMetricsPx(fontCss) {
    const cached = fontMetricsCache.get(fontCss);
    if (cached !== undefined)
        return cached;
    const ctx2d = getMetricsCanvasCtx();
    ctx2d.font = fontCss;
    const metrics = ctx2d.measureText('Hg');
    const result = { ascentPx: metrics.fontBoundingBoxAscent, descentPx: metrics.fontBoundingBoxDescent };
    fontMetricsCache.set(fontCss, result);
    return result;
}
