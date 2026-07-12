// Raw TrueType files in public/fonts/ — see public/fonts/README.md for provenance/license.
// registerFont() also accepts .woff/.woff2 directly; these are .ttf simply because that's how they
// were originally sourced/converted for this demo.
export const INTER_REGULAR_URL = '/fonts/inter-latin-400-normal.ttf'
export const INTER_BOLD_URL = '/fonts/inter-latin-700-normal.ttf'
export const SOURCE_SERIF_REGULAR_URL = '/fonts/source-serif-4-latin-400-normal.ttf'
export const SOURCE_SERIF_BOLD_URL = '/fonts/source-serif-4-latin-700-normal.ttf'

// Registered via registerFont() in main.ts's main(), before paginate() — the same font FILE then
// backs both on-screen canvas measurement/rendering and generatePdf()'s embedded PDF glyphs, which
// is what makes the two outputs' text layout identical (see font-registry.ts's header comment). The
// fallback stacks after each registered family are pre-load paint safety only; registerFont() always
// resolves before paginate() runs, so the registered font is what's actually measured.
export const BODY_FONT = '"Source Serif 4", Georgia, "Iowan Old Style", serif'
export const UI_FONT = 'Inter, Arial, Helvetica, sans-serif'
