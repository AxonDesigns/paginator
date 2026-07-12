// Registry mapping (family, weight, style) -> the literal font file bytes used for both on-screen
// rendering AND later PDF embedding. This identity is the whole point: pretext measures line breaks
// against whatever font the browser's canvas resolves for a TextNode's `fontFamily` string, and for
// generatePdf()'s embedded vector glyphs to reproduce identical line breaks, the PDF must embed the
// SAME font file that backed that measurement — not just a font that "looks like" the CSS family
// name. registerFont() fetches a font file once and serves both consumers from the one byte array.
//
// The registry itself is an explicit `FontRegistry` map owned by a `Paginator` instance (see
// paginator.ts), not module state — two Paginators registering different files under the same
// family/weight/style must not clobber each other's PDF output. PDF embedding reads bytes straight
// from the owning instance's own map, so that part was always correctly isolated. On-screen
// measurement/painting is trickier: `document.fonts` (the CSS Font Loading API's `FontFaceSet`) is
// one page-global set with no per-instance or per-shadow-root equivalent in the spec — a browser
// platform limitation, not something pretext or pdfkit impose (pdfkit never touches document.fonts at
// all; pretext just calls canvas.measureText() against whatever's currently loaded, same as any DOM
// text render). Left alone, two Paginator instances registering DIFFERENT files under the identical
// (family, weight, style) key would have on-screen rendering silently share whichever FontFace the
// browser's own resolution order picks, for every instance, regardless of which one actually
// registered it. registerFont() below closes that gap by registering each FontFace under a
// per-instance-unique ALIAS rather than the literal family name — see resolveFontFamilyForRendering()
// and withActiveFontRegistry() — so two instances' files can never collide in document.fonts by
// construction, each instance's own alias always resolves to its own file.
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
// Assigns each distinct FontRegistry (i.e. each Paginator instance) a stable id the first time it
// registers anything, purely so generated aliases below can never collide across instances — WeakMap
// keyed by the registry itself rather than stored ON it, since FontRegistry is a plain Map with no
// room of its own for bookkeeping fields.
const registryInstanceIds = new WeakMap();
let nextRegistryInstanceId = 0;
let nextAliasSequence = 0;
function nextAliasFor(registry) {
    let instanceId = registryInstanceIds.get(registry);
    if (instanceId === undefined) {
        instanceId = nextRegistryInstanceId++;
        registryInstanceIds.set(registry, instanceId);
    }
    // Deliberately a plain alphanumeric token (no spaces/punctuation) so it never needs CSS quoting
    // wherever it's interpolated into a font-family stack below.
    return `pgtrfont${instanceId}x${nextAliasSequence++}`;
}
function cssFamilyToken(name) {
    return /[\s,"']/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
}
/**
 * Fetches `url`, registers a FontFace under a per-instance-unique alias via document.fonts.add() +
 * .load() (so canvas measurement AND on-screen DOM rendering use this exact file — the same guarantee
 * ready() already documents for document.fonts.ready), and retains the raw bytes in `registry` for
 * generatePdf() to later embed identically. Must resolve before paginate() is called with text using
 * this family/weight/style. Idempotent by (family, weight, style) — calling again re-fetches, mints a
 * fresh alias, and replaces the entry.
 *
 * Registering under an alias rather than the literal `family` (see this file's header comment) means
 * on-screen resolution needs an extra step: resolveFontFamilyForRendering()/withActiveFontRegistry()
 * below rewrite a TextNode/RichTextNode/Watermark's literal fontFamily to this instance's own alias at
 * measurement/render time, transparently to the document author (who never sees or writes the alias).
 * PDF embedding is unaffected either way — it reads `bytes` straight from `registry`, never touching
 * document.fonts.
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
    const alias = nextAliasFor(registry);
    const fontFace = new FontFace(alias, buffer, { weight: String(weight), style });
    await fontFace.load();
    document.fonts.add(fontFace);
    registry.set(registryKey(options.family, weight, style), { family: options.family, weight, style, bytes, alias });
}
// activeFontRegistry is set/cleared by withActiveFontRegistry() around a single SYNCHRONOUS call —
// paginate()/mount()/renderPreview() never await internally, so there's no window for a second,
// concurrent call to observe or clobber this module-level variable mid-run. Deliberately NOT used by
// generatePdf() (which IS async, awaiting per-node draw calls) — that path already receives its own
// registry explicitly via PdfContext.fonts and calls resolveFontFamilyForRendering() directly instead,
// avoiding any risk of two concurrent generatePdf() calls (e.g. Promise.all across instances)
// interleaving through shared module state.
let activeFontRegistry = null;
/** Runs `fn` (synchronously) with `registry` as the "active" registry resolveActiveFontFamily() below
 *  consults — see that function and activeFontRegistry's own comment for why this is scoped to
 *  synchronous callers only. */
export function withActiveFontRegistry(registry, fn) {
    const previous = activeFontRegistry;
    activeFontRegistry = registry;
    try {
        return fn();
    }
    finally {
        activeFontRegistry = previous;
    }
}
/**
 * Rewrites a CSS font-family stack (e.g. `"Inter, Arial, sans-serif"`) so any comma-separated name
 * registered on `registry` at this (weight, style) resolves to THAT registry's own file — prepending
 * its alias ahead of the literal name — rather than whichever file document.fonts happens to have most
 * recently loaded under the same bare name from a different Paginator instance (see this file's header
 * comment). Falls through to `fontFamily` completely unchanged for any name that was never registered
 * on `registry` at this exact (weight, style) — including `registry === null`, e.g. no Paginator
 * instance is involved at all.
 */
export function resolveFontFamilyForRendering(registry, fontFamily, weight, style) {
    if (registry === null)
        return fontFamily;
    const normalizedWeight = normalizeFontWeight(weight);
    const normalizedStyle = style ?? 'normal';
    return parseFontFamilyStack(fontFamily)
        .map(name => {
        const found = registry.get(registryKey(name, normalizedWeight, normalizedStyle));
        return found === undefined ? cssFamilyToken(name) : `${cssFamilyToken(found.alias)}, ${cssFamilyToken(name)}`;
    })
        .join(', ');
}
/** Ambient-registry convenience for the synchronous DOM/measurement call sites (text.ts, rich-text.ts,
 *  shadow-dom.ts's watermark painting) that can't take an explicit FontRegistry parameter without
 *  threading it through every NodeTypeDefinition signature — see withActiveFontRegistry(). Resolves to
 *  `fontFamily` unchanged outside of a withActiveFontRegistry() call (e.g. the free `paginate`/`mount`
 *  functions called directly, with no owning Paginator instance in the picture). */
export function resolveActiveFontFamily(fontFamily, weight, style) {
    return resolveFontFamilyForRendering(activeFontRegistry, fontFamily, weight, style);
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
