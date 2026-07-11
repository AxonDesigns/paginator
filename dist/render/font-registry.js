// Registry mapping (family, weight, style) -> the literal font file bytes used for both on-screen
// rendering AND later PDF embedding. This identity is the whole point: pretext measures line breaks
// against whatever font the browser's canvas resolves for a TextNode's `fontFamily` string, and for
// generatePdf()'s embedded vector glyphs to reproduce identical line breaks, the PDF must embed the
// SAME font file that backed that measurement — not just a font that "looks like" the CSS family
// name. registerFont() fetches a font file once and serves both consumers from the one byte array.
//
// The registry itself is an explicit `FontRegistry` map owned by a `Paginator` instance (see
// paginator.ts), not module state — two Paginators registering different files under the same
// family/weight/style must not clobber each other's PDF output. `document.fonts.add()` below is the
// one part of this that stays unavoidably page-global (no per-instance equivalent exists in the
// FontFace API): on-screen measurement/painting still shares whichever file the browser last
// resolved for a given family/weight/style across every instance, but PDF embedding reads bytes
// straight from the owning instance's own map, so that part is correctly isolated.
function registryKey(family, weight, style) {
    return `${family.trim().toLowerCase()}|${weight}|${style}`;
}
const NAMED_WEIGHTS = { normal: 400, bold: 700, bolder: 700, lighter: 300 };
/** `700`/`'700'`/`'bold'`/`'normal'`/`'bolder'`/`'lighter'`/`undefined` -> a definite CSS numeric weight (default 400). */
export function normalizeFontWeight(weight) {
    if (weight === undefined)
        return 400;
    if (typeof weight === 'number')
        return weight;
    const named = NAMED_WEIGHTS[weight.trim().toLowerCase()];
    if (named !== undefined)
        return named;
    const parsed = Number(weight);
    return Number.isFinite(parsed) ? parsed : 400;
}
// TextNode.fontFamily is a full CSS font stack (e.g. 'Inter, Arial, sans-serif'), same as the
// browser's own font matching — so a lookup must try each comma-separated name in order, not just
// the raw string.
function parseFontFamilyStack(fontFamily) {
    return fontFamily
        .split(',')
        .map(name => name.trim().replace(/^["']|["']$/g, ''))
        .filter(name => name.length > 0);
}
/**
 * Fetches `url`, registers a FontFace via document.fonts.add() + .load() (so canvas measurement AND
 * on-screen DOM rendering use this exact file — the same guarantee ready() already documents for
 * document.fonts.ready), and retains the raw bytes in `registry` for generatePdf() to later embed
 * identically. Must resolve before paginate() is called with text using this family/weight/style.
 * Idempotent by (family, weight, style) — calling again re-fetches and replaces the entry.
 *
 * Accepts .ttf/.otf/.woff/.woff2 — pdfkit's bundled fontkit decodes all four to real sfnt glyph data
 * before embedding (unlike the previous pdf-lib backend, which wrote registerFont()'s bytes verbatim
 * into the PDF and so could only accept raw, uncompressed sfnt containers).
 */
export async function registerFont(registry, options) {
    const weight = normalizeFontWeight(options.weight);
    const style = options.style ?? 'normal';
    const response = await fetch(options.url);
    if (!response.ok) {
        throw new Error(`[paginator] registerFont(): failed to fetch "${options.url}" (${response.status} ${response.statusText}).`);
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const fontFace = new FontFace(options.family, buffer, { weight: String(weight), style });
    await fontFace.load();
    document.fonts.add(fontFace);
    registry.set(registryKey(options.family, weight, style), { family: options.family, weight, style, bytes });
}
/** Resolves a TextNode's `fontFamily` (a full CSS stack) + weight/style against `registry`, trying each family in order. */
export function lookupFont(registry, fontFamily, weight, style) {
    const normalizedWeight = normalizeFontWeight(weight);
    const normalizedStyle = style ?? 'normal';
    for (const family of parseFontFamilyStack(fontFamily)) {
        const found = registry.get(registryKey(family, normalizedWeight, normalizedStyle));
        if (found !== undefined)
            return found;
    }
    return undefined;
}
export function listRegisteredFonts(registry) {
    return [...registry.values()];
}
// The library's own fallback/default fontFamily wherever a caller doesn't specify one — a pdfkit
// Standard-14 name (see below), so it's always drawable with zero embedding regardless of what the
// caller does or doesn't registerFont().
export const DEFAULT_FONT_FAMILY = 'Helvetica';
// pdfkit bundles these 14 fonts' AFM metrics directly (no font FILE involved), so they need no
// registerFont() call and can never fail to embed — every PDF viewer already has them installed.
// Base names below are matched case-insensitively against each entry of the caller's fontFamily
// stack; only Helvetica/Times/Courier have weight/style variants, Symbol/ZapfDingbats do not.
const STANDARD_FONT_FAMILIES = {
    helvetica: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
    times: { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
    'times-roman': { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
    courier: { regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique' },
};
const STANDARD_FONT_NAMES_NO_VARIANTS = {
    symbol: 'Symbol',
    zapfdingbats: 'ZapfDingbats',
};
/**
 * Resolves a `fontFamily` CSS stack against pdfkit's 14 standard fonts (Helvetica/Times/Courier,
 * each with bold/italic/boldItalic variants, plus Symbol/ZapfDingbats with none) — trying each
 * comma-separated name in turn, same order `lookupFont()` uses. Returns the exact pdfkit font name
 * to pass to `doc.font()`, or `undefined` if nothing in the stack names a standard font.
 */
export function resolveStandardFontName(fontFamily, weight, style) {
    const bold = weight >= 600;
    const italic = style === 'italic';
    for (const name of parseFontFamilyStack(fontFamily)) {
        const key = name.toLowerCase();
        const noVariant = STANDARD_FONT_NAMES_NO_VARIANTS[key];
        if (noVariant !== undefined)
            return noVariant;
        const variants = STANDARD_FONT_FAMILIES[key];
        if (variants === undefined)
            continue;
        if (bold && italic)
            return variants.boldItalic;
        if (bold)
            return variants.bold;
        if (italic)
            return variants.italic;
        return variants.regular;
    }
    return undefined;
}
