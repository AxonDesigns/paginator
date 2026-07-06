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

export type FontStyle = 'normal' | 'italic'

export type RegisteredFont = {
  family: string
  weight: number
  style: FontStyle
  bytes: Uint8Array
}

export type FontRegistry = Map<string, RegisteredFont>

function registryKey(family: string, weight: number, style: FontStyle): string {
  return `${family.trim().toLowerCase()}|${weight}|${style}`
}

const NAMED_WEIGHTS: Record<string, number> = { normal: 400, bold: 700, bolder: 700, lighter: 300 }

/** `700`/`'700'`/`'bold'`/`'normal'`/`'bolder'`/`'lighter'`/`undefined` -> a definite CSS numeric weight (default 400). */
export function normalizeFontWeight(weight: number | string | undefined): number {
  if (weight === undefined) return 400
  if (typeof weight === 'number') return weight
  const named = NAMED_WEIGHTS[weight.trim().toLowerCase()]
  if (named !== undefined) return named
  const parsed = Number(weight)
  return Number.isFinite(parsed) ? parsed : 400
}

// TextNode.fontFamily is a full CSS font stack (e.g. 'Inter, Arial, sans-serif'), same as the
// browser's own font matching — so a lookup must try each comma-separated name in order, not just
// the raw string.
function parseFontFamilyStack(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map(name => name.trim().replace(/^["']|["']$/g, ''))
    .filter(name => name.length > 0)
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
export async function registerFont(
  registry: FontRegistry,
  options: { family: string; url: string; weight?: number | string; style?: FontStyle },
): Promise<void> {
  const weight = normalizeFontWeight(options.weight)
  const style: FontStyle = options.style ?? 'normal'

  const response = await fetch(options.url)
  if (!response.ok) {
    throw new Error(`[paginator] registerFont(): failed to fetch "${options.url}" (${response.status} ${response.statusText}).`)
  }
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  const fontFace = new FontFace(options.family, buffer, { weight: String(weight), style })
  await fontFace.load()
  document.fonts.add(fontFace)

  registry.set(registryKey(options.family, weight, style), { family: options.family, weight, style, bytes })
}

/** Resolves a TextNode's `fontFamily` (a full CSS stack) + weight/style against `registry`, trying each family in order. */
export function lookupFont(
  registry: FontRegistry,
  fontFamily: string,
  weight: number | string | undefined,
  style: FontStyle | undefined,
): RegisteredFont | undefined {
  const normalizedWeight = normalizeFontWeight(weight)
  const normalizedStyle: FontStyle = style ?? 'normal'
  for (const family of parseFontFamilyStack(fontFamily)) {
    const found = registry.get(registryKey(family, normalizedWeight, normalizedStyle))
    if (found !== undefined) return found
  }
  return undefined
}

export function listRegisteredFonts(registry: FontRegistry): RegisteredFont[] {
  return [...registry.values()]
}
