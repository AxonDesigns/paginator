export type FontStyle = 'normal' | 'italic';
export type RegisteredFont = {
    family: string;
    weight: number;
    style: FontStyle;
    bytes: Uint8Array;
};
export type FontRegistry = Map<string, RegisteredFont>;
/** `700`/`'700'`/`'bold'`/`'normal'`/`'bolder'`/`'lighter'`/`undefined` -> a definite CSS numeric weight (default 400). */
export declare function normalizeFontWeight(weight: number | string | undefined): number;
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
export declare function registerFont(registry: FontRegistry, options: {
    family: string;
    url: string;
    weight?: number | string;
    style?: FontStyle;
}): Promise<void>;
/** Resolves a TextNode's `fontFamily` (a full CSS stack) + weight/style against `registry`, trying each family in order. */
export declare function lookupFont(registry: FontRegistry, fontFamily: string, weight: number | string | undefined, style: FontStyle | undefined): RegisteredFont | undefined;
export declare function listRegisteredFonts(registry: FontRegistry): RegisteredFont[];
