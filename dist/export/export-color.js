// A standalone, DOM-free CSS color resolver for the docx/xlsx exporters — deliberately NOT a reuse
// of pdf-render.ts's resolvePdfColor, which depends on OffscreenCanvas (browser-only) to resolve
// arbitrary CSS colors (named colors, hsl(), etc). Reusing it would make the xlsx exporter
// untestable under `bun test`. This handles the two forms every node type in this codebase actually
// authors colors with in practice (#hex and rgb()/rgba()) and falls back to black + a warning for
// anything else (named colors, hsl()/hsla()) — a narrower, documented limitation vs. the PDF
// exporter, acceptable since export output is already a lower-fidelity, semantic recreation.
//
// Returns a bare 6-digit hex string with NO leading "#" (e.g. "1a2b3c") — both `docx` (color/shading
// props) and ExcelJS (Font.color.argb, after prepending an "FF" alpha prefix) want hex without "#".
export function resolveExportColor(css) {
    const trimmed = css.trim();
    const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(trimmed);
    if (hexMatch !== null) {
        let hex = hexMatch[1];
        if (hex.length === 3)
            hex = [...hex].map(c => c + c).join('');
        return hex.slice(0, 6).toUpperCase();
    }
    const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(trimmed);
    if (rgbMatch !== null) {
        const toHex = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
        return `${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase();
    }
    console.warn(`[paginator] export: color "${css}" is not a #hex/rgb()/rgba() value — falling back to black (named CSS colors and hsl()/hsla() aren't supported by docx/xlsx export).`);
    return '000000';
}
/** ExcelJS wants an 8-digit ARGB hex (alpha first) with no "#" for Font.color/Fill colors. */
export function toArgb(css) {
    return `FF${resolveExportColor(css)}`;
}
