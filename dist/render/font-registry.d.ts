export type FontStyle = 'normal' | 'italic';
export type RegisteredFont = {
    family: string;
    weight: number;
    style: FontStyle;
    bytes: Uint8Array;
    /** The name this font's FontFace was actually registered under in document.fonts — see this
     *  file's header comment. Never the literal `family` (that would defeat the whole point). */
    alias: string;
};
export type FontRegistry = Map<string, RegisteredFont>;
/** `700`/`'700'`/`'bold'`/`'normal'`/`'bolder'`/`'lighter'`/`undefined` -> a definite CSS numeric weight (default 400). */
export declare function normalizeFontWeight(weight: number | string | undefined): number;
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
export declare function registerFont(registry: FontRegistry, options: {
    family: string;
    url: string;
    weight?: number | string;
    style?: FontStyle;
}): Promise<void>;
/** Runs `fn` (synchronously) with `registry` as the "active" registry resolveActiveFontFamily() below
 *  consults — see that function and activeFontRegistry's own comment for why this is scoped to
 *  synchronous callers only. */
export declare function withActiveFontRegistry<T>(registry: FontRegistry, fn: () => T): T;
/**
 * Rewrites a CSS font-family stack (e.g. `"Inter, Arial, sans-serif"`) so any comma-separated name
 * registered on `registry` at this (weight, style) resolves to THAT registry's own file — prepending
 * its alias ahead of the literal name — rather than whichever file document.fonts happens to have most
 * recently loaded under the same bare name from a different Paginator instance (see this file's header
 * comment). Falls through to `fontFamily` completely unchanged for any name that was never registered
 * on `registry` at this exact (weight, style) — including `registry === null`, e.g. no Paginator
 * instance is involved at all.
 */
export declare function resolveFontFamilyForRendering(registry: FontRegistry | null, fontFamily: string, weight: number | string | undefined, style: FontStyle | undefined): string;
/** Ambient-registry convenience for the synchronous DOM/measurement call sites (text.ts, rich-text.ts,
 *  shadow-dom.ts's watermark painting) that can't take an explicit FontRegistry parameter without
 *  threading it through every NodeTypeDefinition signature — see withActiveFontRegistry(). Resolves to
 *  `fontFamily` unchanged outside of a withActiveFontRegistry() call (e.g. the free `paginate`/`mount`
 *  functions called directly, with no owning Paginator instance in the picture). */
export declare function resolveActiveFontFamily(fontFamily: string, weight: number | string | undefined, style: FontStyle | undefined): string;
/** Resolves a TextNode's `fontFamily` (a full CSS stack) + weight/style against `registry`, trying each family in order. */
export declare function lookupFont(registry: FontRegistry, fontFamily: string, weight: number | string | undefined, style: FontStyle | undefined): RegisteredFont | undefined;
export declare function listRegisteredFonts(registry: FontRegistry): RegisteredFont[];
export declare const DEFAULT_FONT_FAMILY = "Helvetica";
/**
 * Resolves a `fontFamily` CSS stack against pdfkit's 14 standard fonts (Helvetica/Times/Courier,
 * each with bold/italic/boldItalic variants, plus Symbol/ZapfDingbats with none) — trying each
 * comma-separated name in turn, same order `lookupFont()` uses. Returns the exact pdfkit font name
 * to pass to `doc.font()`, or `undefined` if nothing in the stack names a standard font.
 */
export declare function resolveStandardFontName(fontFamily: string, weight: number, style: FontStyle): string | undefined;
