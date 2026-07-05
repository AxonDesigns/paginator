// PDF renderer entry point + generic plumbing every node type's `drawPdf` implementation needs
// (unit conversion, color resolution, image embedding) + the page-level watermark/background/border
// painting that isn't a Node at all so has nowhere else to live. Per-node-type drawing itself lives
// in src/nodes/*, dispatched generically through behavior.ts's drawPdfNode() — this file never
// switches on node.type.
//
// The one thing a node's `drawPdf` can't get "for free" from shared data is fonts: pretext decided
// every line break by measuring against whatever font FILE the browser's canvas resolved for a
// TextNode's `fontFamily` string (see measure-text.ts / font-registry.ts's header comment). For the
// PDF's embedded vector glyphs to reproduce identical line breaks, it must embed that literal file —
// see font-registry.ts / pdf-fonts.ts. When a family/weight/style was never registered, text nodes
// fall back to a Helvetica standard font (warn once, not throw) rather than blocking generation.
//
// Coordinate system: pdfkit's page space is ALREADY top-left origin, y-down (it applies a
// `1 0 0 -1 0 pageHeight` CTM flip once per page internally, confirmed by inspecting its output) —
// the same convention PaginatedResult's px values use. So the only conversion needed is the uniform
// PX_TO_PT unit scale (96dpi -> 72dpi), applied at the final leaf draw call only — no y-flip math
// anywhere in this file or in any node's drawPdf.
//
// Runs entirely client-side: pdfkit is Node-oriented (streams/Buffers) upstream, but its distributed
// `js/pdfkit.standalone.js` build is a self-contained Browserify bundle (AFM Standard-14 font metrics
// inlined as string literals, `fs`/`stream`/`zlib` all shimmed INSIDE the bundle) — no Node-polyfill
// bundler plugin needed for that import. The PDFDocument it constructs is a push-stream; rather than
// pull in `blob-stream` (pdfkit's usual browser companion) for the stream->bytes bridge, this collects
// 'data' events directly — `blob-stream` itself calls the bare Node builtins `stream`/`util` at its
// own module scope (not pre-bundled the way pdfkit.standalone.js is), which Vite can only externalize
// to an empty `{}` module, and `undefined.call(this)` inside blob-stream's constructor throws at
// runtime. Collecting chunks by hand avoids that dependency entirely.

import PDFDocument from 'pdfkit/js/pdfkit.standalone.js'
import type { PaginatedResult } from '../core/paginate.ts'
import type { ImageNode, ObjectFit, Watermark } from '../core/nodes.ts'
import { drawPdfNode } from '../core/behavior.ts'
import { resolveWatermarkInstances } from '../core/watermark-layout.ts'
import { measureTextWidthPx } from './text-measure.ts'
import { lookupFont, normalizeFontWeight } from './font-registry.ts'
import type { FontStyle, RegisteredFont } from './font-registry.ts'
import { ensureRegisteredFont, measureFontMetricsPx, pickFallbackFont, warnMissingFontOnce } from './pdf-fonts.ts'

export type PdfMetadata = { title?: string; author?: string; subject?: string; keywords?: string[] }

export const PX_TO_PT = 0.75 // 96dpi px -> 72dpi pt (96/72). A4 794x1123px * 0.75 = 595.5x842.25pt, matching the standard PDF A4 size.
export function pxToPt(n: number): number {
  return n * PX_TO_PT
}

export type PdfContext = {
  doc: PDFKit.PDFDocument
  registeredFontNames: Map<RegisteredFont, string>
  imageEmbedCache: Map<string, string>
  fallbackFonts: { regular: string; bold: string; italic: string; boldItalic: string }
  warnedMissingFonts: Set<string>
}

export function toPdfRect(xPx: number, yPx: number, wPx: number, hPx: number): { x: number; y: number; width: number; height: number } {
  return { x: pxToPt(xPx), y: pxToPt(yPx), width: pxToPt(wPx), height: pxToPt(hPx) }
}

// Every color in this codebase's node types is a plain CSS `string` with no enforced format.
// pdfkit's own color normalizer only understands 3/6-digit hex (no alpha channel) — so this
// validates/normalizes to a plain `#rrggbb` string and hands it to pdfkit as-is, rather than
// building a separate color-object type the way pdf-lib's rgb() required. Anything past hex
// (rgb()/rgba()/hsl()/hsla()/named colors/etc.) is resolved via `normalizeCssColor` below, dropping
// any alpha channel same as an 8-digit hex already does — pdf-lib's rgb() dropped alpha too, so
// this isn't a new limitation for anything that previously worked.
export function resolvePdfColor(css: string): string {
  const trimmed = css.trim()
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(trimmed)
  if (hexMatch !== null) {
    let hex = hexMatch[1]!
    if (hex.length === 3) hex = [...hex].map(c => c + c).join('')
    return `#${hex.slice(0, 6)}`
  }

  const normalized = normalizeCssColor(trimmed)
  if (normalized !== null) return normalized

  console.warn(`[paginator] generatePdf(): color "${css}" is not a recognized CSS color — falling back to black.`)
  return '#000000'
}

// Resolves anything CSS accepts as a color (rgb()/rgba()/hsl()/hsla()/named keywords/etc.) to a
// plain `#rrggbb` string by delegating to the browser's own CSS color parser — via canvas 2D's
// `fillStyle` setter/getter, which silently ignores an unparseable value (leaving the property at
// its previous value) and otherwise normalizes to `#rrggbb` (opaque) or `rgba(r, g, b, a)` (has
// alpha). This is the same "trust the browser's own engine instead of hand-rolling one" approach
// measureFontMetricsPx already uses for font metrics — complete and spec-correct for free, rather
// than maintaining a hand-written named-color table or an hsl->rgb converter. `null` = `css` didn't
// parse as any valid CSS color at all.
let colorCanvasCtx: OffscreenCanvasRenderingContext2D | null = null
const COLOR_PARSE_SENTINEL = '#123456'

function normalizeCssColor(css: string): string | null {
  if (colorCanvasCtx === null) {
    const ctx2d = new OffscreenCanvas(1, 1).getContext('2d')
    if (ctx2d === null) return null
    colorCanvasCtx = ctx2d
  }
  colorCanvasCtx.fillStyle = COLOR_PARSE_SENTINEL
  colorCanvasCtx.fillStyle = css
  const result = colorCanvasCtx.fillStyle
  if (result === COLOR_PARSE_SENTINEL && css.toLowerCase() !== COLOR_PARSE_SENTINEL) return null
  if (result.startsWith('#')) return result
  const rgbaMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(result)
  if (rgbaMatch === null) return null // unreachable in practice — fillStyle only ever normalizes to #rrggbb or rgba(...)
  const toHex = (n: string): string => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
  return `#${toHex(rgbaMatch[1]!)}${toHex(rgbaMatch[2]!)}${toHex(rgbaMatch[3]!)}`
}

// ---- Image embedding — shared by ImageNode's drawPdf (src/nodes/image.ts) AND an image watermark
// below, since both need "rasterize an arbitrary source + objectFit crop into a box-sized PNG". ----

// Mirrors CSS object-fit's crop/letterbox math exactly (fill/none/contain/cover/scale-down), computed
// once here since pdfkit has no native equivalent (its `fit`/`cover` options size the whole image, but
// neither clips overflow nor supports a source-rect crop) — the canvas rasterization step below bakes
// the result in so the actual PDF draw call is always a trivial "place this box-sized PNG in this box".
export function resolveObjectFitRects(
  mode: ObjectFit,
  iw: number,
  ih: number,
  bw: number,
  bh: number,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (mode === 'fill') return { sx: 0, sy: 0, sw: iw, sh: ih, dx: 0, dy: 0, dw: bw, dh: bh }
  if (mode === 'none') return { sx: 0, sy: 0, sw: iw, sh: ih, dx: (bw - iw) / 2, dy: (bh - ih) / 2, dw: iw, dh: ih }
  if (mode === 'cover') {
    const scale = Math.max(bw / iw, bh / ih)
    const sw = bw / scale
    const sh = bh / scale
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: 0, dy: 0, dw: bw, dh: bh }
  }
  // 'contain' | 'scale-down'
  const scale = mode === 'scale-down' ? Math.min(1, bw / iw, bh / ih) : Math.min(bw / iw, bh / ih)
  const dw = iw * scale
  const dh = ih * scale
  return { sx: 0, sy: 0, sw: iw, sh: ih, dx: (bw - dw) / 2, dy: (bh - dh) / 2, dw, dh }
}

// Loaded via a plain <img> element (same as shadow-dom.ts's renderImageNode) rather than
// fetch()+createImageBitmap() — createImageBitmap() has proven unreliable decoding SVG sources in
// practice (InvalidStateError even for a well-formed, self-contained SVG with explicit width/height),
// while an <img> element goes through the browser's ordinary image pipeline, the same one every
// on-screen <img src=...> in this library already relies on.
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error(`[paginator] generatePdf(): failed to load image "${src}".`))
    el.src = src
  })
}

// Rasterizing at exactly the display box's own px size (96dpi) looks fine on screen but is visibly
// soft once the PDF is zoomed in or printed — a PDF viewer/printer has no "extra" pixels to show
// beyond what was captured. RASTER_SCALE renders into a canvas this many times larger than the box,
// then places the result at the box's ORIGINAL (unscaled) point size — the viewer/printer downsamples
// the extra pixels, which is what makes this sharp rather than just bigger. 2x ≈ 192dpi effective
// resolution — noticeably sharper than screen (96dpi) and still clean at typical zoom, short of
// dedicated print quality (300dpi) but a deliberate tradeoff: each embedded image is losslessly
// PNG-encoded, so pixel count drives PDF file size and PDF-viewer scroll/zoom performance directly.
// 3x (288dpi, near print quality) made large photos noticeably heavy — 2x quarters the pixel count
// against that baseline for a meaningfully lighter, more responsive PDF, at the cost of print-grade
// sharpness.
const RASTER_SCALE = 1

// One code path handles every source format pdfkit itself can't natively decode (WebP/GIF/SVG — only
// PNG/JPEG are native, same limitation pdf-lib had) AND every objectFit value (pdfkit's `fit`/`cover`
// options size but don't crop): decode via the browser's own image pipeline, draw into an offscreen
// canvas sized to the resolved box (scaled up by RASTER_SCALE for print/zoom sharpness) with the
// objectFit math already applied, re-export as PNG. Runs at PDF-generation time via a detached canvas,
// not inside paginate(), so it doesn't touch the sync/no-DOM-during-layout invariant.
async function rasterizeImageToPng(node: Pick<ImageNode, 'src' | 'objectFit'>, boxWidthPx: number, boxHeightPx: number): Promise<Uint8Array> {
  const img = await loadImageElement(node.src)
  const canvasWidth = Math.max(1, Math.round(boxWidthPx * RASTER_SCALE))
  const canvasHeight = Math.max(1, Math.round(boxHeightPx * RASTER_SCALE))
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight)
  const ctx2d = canvas.getContext('2d')
  if (ctx2d === null) throw new Error('[paginator] generatePdf(): could not acquire a 2D context for image rasterization.')
  const { sx, sy, sw, sh, dx, dy, dw, dh } = resolveObjectFitRects(node.objectFit ?? 'fill', img.naturalWidth, img.naturalHeight, canvasWidth, canvasHeight)
  ctx2d.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  const pngBlob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await pngBlob.arrayBuffer())
}

// pdfkit's PDFImage.open() only recognizes a real Node Buffer (via a `_isBuffer` duck-type check) or a
// `data:...;base64,...` string for non-path input — a plain Uint8Array falls through both branches and
// hits a dead `fs.readFileSync` call. Base64-encoding into a data URI uses pdfkit's own already-bundled
// Buffer.from(base64String, 'base64') internally, so no separate Buffer polyfill dependency is needed
// here. Chunked to avoid call-stack overflow from spreading a large image into String.fromCharCode.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// Caches the data URI itself, not a pdfkit image handle — pdfkit's own .image() already dedupes by
// exact string key via its internal _imageRegistry (so passing the same data URI twice costs nothing
// extra there), but rasterizeImageToPng()'s canvas decode/draw/encode is the actually expensive step
// this cache exists to avoid repeating (e.g. the same logo in every page header).
export async function embedImage(ctx: PdfContext, node: Pick<ImageNode, 'src' | 'objectFit'>, boxWidthPx: number, boxHeightPx: number): Promise<string> {
  const key = `${node.src}|${node.objectFit ?? 'fill'}|${Math.round(boxWidthPx)}|${Math.round(boxHeightPx)}`
  const cached = ctx.imageEmbedCache.get(key)
  if (cached !== undefined) return cached
  const pngBytes = await rasterizeImageToPng(node, boxWidthPx, boxHeightPx)
  const dataUri = `data:image/png;base64,${bytesToBase64(pngBytes)}`
  ctx.imageEmbedCache.set(key, dataUri)
  return dataUri
}

// ---- Watermark: a page-absolute decorative overlay, not a Node — resolved once per page by
// paginate() and painted directly here. Drawn LAST, after header/body/footer (see the per-page loop
// in generatePdf() below) so it sits on top of everything — an opaque table stripe, container
// background, or chart's white surface elsewhere on the page can otherwise fully hide a watermark
// drawn underneath it. No line-wrapping/pagination involved: a single measured line (text) or
// explicit box (image), repeated per resolveWatermarkInstances() when tiled. ----

function watermarkFontCss(watermark: Extract<Watermark, { kind: 'text' }>): string {
  const style = watermark.fontStyle === 'italic' ? 'italic ' : ''
  const weight = watermark.fontWeight ?? 700
  return `${style}${weight} ${watermark.fontSize ?? 72}px ${watermark.fontFamily ?? 'Helvetica'}`
}

// Falls back straight to a Helvetica standard font with no warning when `fontFamily` is omitted —
// unlike resolveTextFont()/resolveChartFontName(), there was never a registered family this omission
// could be missing relative to, so warnMissingFontOnce() would be pure noise here.
function resolveWatermarkFontName(ctx: PdfContext, watermark: Extract<Watermark, { kind: 'text' }>): string {
  const weight = normalizeFontWeight(watermark.fontWeight ?? 700)
  const style: FontStyle = watermark.fontStyle === 'italic' ? 'italic' : 'normal'
  if (watermark.fontFamily === undefined) return pickFallbackFont(ctx, weight, style)
  const registered = lookupFont(watermark.fontFamily, weight, style)
  if (registered !== undefined) return ensureRegisteredFont(ctx, registered)
  warnMissingFontOnce(ctx, watermark.fontFamily, weight, style)
  return pickFallbackFont(ctx, weight, style)
}

// Rasterizes watermark text to a transparent PNG (same RASTER_SCALE/canvas approach as
// rasterizeImageToPng above) so it embeds as an ordinary image rather than real pdfkit glyphs —
// the default (TextWatermark.selectable !== true) path, since a watermark stamped over real body
// text almost never wants to be selectable/copyable out of the PDF. Cached by (text, font, color):
// the same watermark config is drawn once per page and again per tile instance, so this avoids
// re-rendering identical pixels for every repeat.
const watermarkTextRasterCache = new Map<string, string>()

async function rasterizeWatermarkText(text: string, fontCss: string, color: string, widthPx: number, ascentPx: number, descentPx: number): Promise<string> {
  const key = `${text}|${fontCss}|${color}`
  const cached = watermarkTextRasterCache.get(key)
  if (cached !== undefined) return cached

  const heightPx = ascentPx + descentPx
  const canvasWidth = Math.max(1, Math.round(widthPx * RASTER_SCALE))
  const canvasHeight = Math.max(1, Math.round(heightPx * RASTER_SCALE))
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight)
  const ctx2d = canvas.getContext('2d')
  if (ctx2d === null) throw new Error('[paginator] generatePdf(): could not acquire a 2D context for watermark text rasterization.')
  ctx2d.scale(RASTER_SCALE, RASTER_SCALE)
  ctx2d.font = fontCss
  ctx2d.fillStyle = color
  ctx2d.textBaseline = 'alphabetic'
  ctx2d.fillText(text, 0, ascentPx)
  const pngBlob = await canvas.convertToBlob({ type: 'image/png' })
  const dataUri = `data:image/png;base64,${bytesToBase64(new Uint8Array(await pngBlob.arrayBuffer()))}`
  watermarkTextRasterCache.set(key, dataUri)
  return dataUri
}

async function drawWatermark(ctx: PdfContext, watermark: Watermark, pageWidthPx: number, pageHeightPx: number): Promise<void> {
  const opacity = watermark.opacity ?? 0.15
  const rotation = watermark.rotation ?? -45

  if (watermark.kind === 'image') {
    const dataUri = await embedImage(ctx, { src: watermark.src, objectFit: undefined }, watermark.width, watermark.height)
    const rect = toPdfRect(0, 0, watermark.width, watermark.height)
    const instances = resolveWatermarkInstances(watermark, pageWidthPx, pageHeightPx, watermark.width, watermark.height)
    for (const { x, y } of instances) {
      const centerXPt = pxToPt(x)
      const centerYPt = pxToPt(y)
      ctx.doc.save()
      ctx.doc.rotate(rotation, { origin: [centerXPt, centerYPt] })
      ctx.doc.opacity(opacity)
      ctx.doc.image(dataUri, centerXPt - rect.width / 2, centerYPt - rect.height / 2, { width: rect.width, height: rect.height })
      ctx.doc.restore()
    }
    return
  }

  const fontCss = watermarkFontCss(watermark)
  const widthPx = measureTextWidthPx(watermark.text, fontCss)
  const color = resolvePdfColor(watermark.color ?? '#000000')
  const { ascentPx, descentPx } = measureFontMetricsPx(fontCss)
  const heightPx = ascentPx + descentPx

  if (watermark.selectable === true) {
    const fontName = resolveWatermarkFontName(ctx, watermark)
    const fontSizePt = pxToPt(watermark.fontSize ?? 72)
    const halfGlyphHeightPt = pxToPt(ascentPx - descentPx) / 2
    const instances = resolveWatermarkInstances(watermark, pageWidthPx, pageHeightPx, widthPx, heightPx)
    ctx.doc.font(fontName).fontSize(fontSizePt).fillColor(color)
    for (const { x, y } of instances) {
      const centerXPt = pxToPt(x)
      const centerYPt = pxToPt(y)
      const widthPt = pxToPt(widthPx)
      ctx.doc.save()
      ctx.doc.rotate(rotation, { origin: [centerXPt, centerYPt] })
      ctx.doc.opacity(opacity)
      // No `width`/`align` here: pdfkit's `.text()` runs its LineWrapper whenever `options.width` is
      // truthy REGARDLESS of `lineBreak: false` (see `_text()` in pdfkit's source — `lineBreak` only
      // skips the auto-width default, never bypasses the wrapper once a width is explicitly given).
      // Centering by hand via the x-coordinate (as done here) needs neither `width` nor `align`, and
      // sidesteps the wrapper entirely.
      ctx.doc.text(watermark.text, centerXPt - widthPt / 2, centerYPt + halfGlyphHeightPt, { lineBreak: false, baseline: 0 })
      ctx.doc.restore()
    }
    return
  }

  // Default: rasterized image, not live text — see TextWatermark.selectable's own doc comment.
  const dataUri = await rasterizeWatermarkText(watermark.text, fontCss, color, widthPx, ascentPx, descentPx)
  const rect = toPdfRect(0, 0, widthPx, heightPx)
  const instances = resolveWatermarkInstances(watermark, pageWidthPx, pageHeightPx, widthPx, heightPx)
  for (const { x, y } of instances) {
    const centerXPt = pxToPt(x)
    const centerYPt = pxToPt(y)
    ctx.doc.save()
    ctx.doc.rotate(rotation, { origin: [centerXPt, centerYPt] })
    ctx.doc.opacity(opacity)
    ctx.doc.image(dataUri, centerXPt - rect.width / 2, centerYPt - rect.height / 2, { width: rect.width, height: rect.height })
    ctx.doc.restore()
  }
}

// pdfkit's PDFDocument is a push-stream (Readable); collecting 'data' events and concatenating on
// 'end' avoids adding `blob-stream` as a dependency purely for the browser-side stream->bytes bridge
// — see this file's header comment for why blob-stream itself can't run unmodified under Vite.
function collectPdfBytes(doc: PDFKit.PDFDocument): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    doc.on('end', () => {
      const total = chunks.reduce((sum, c) => sum + c.length, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
      }
      resolve(out)
    })
    doc.on('error', reject)
  })
}

/**
 * Generates a real, vector PDF from a PaginatedResult — the same data mount() renders to a shadow
 * DOM. Fonts referenced by a TextNode must be registered via registerFont() beforehand for the PDF's
 * line breaks/widths to be guaranteed identical to the on-screen preview; an unregistered font/weight/
 * style falls back to a Helvetica standard font with a one-time console.warn naming the gap, rather
 * than throwing — generation always succeeds. `metadata` is optional document-info pass-through.
 */
export async function generatePdf(result: PaginatedResult, metadata?: PdfMetadata): Promise<Uint8Array> {
  const { pageSize } = result
  // Built conditionally rather than `{ Title: metadata?.title, ... }` — pdfkit copies every OWN key
  // of `options.info` into its internal info dict via `for...in`, undefined value or not, so an
  // always-present key with an undefined value would still overwrite pdfkit's own default and end up
  // serialized into the PDF's trailer.
  const info: Record<string, string> = {}
  if (metadata?.title !== undefined) info.Title = metadata.title
  if (metadata?.author !== undefined) info.Author = metadata.author
  if (metadata?.subject !== undefined) info.Subject = metadata.subject
  if (metadata?.keywords !== undefined) info.Keywords = metadata.keywords.join(', ')

  const doc = new PDFDocument({
    size: [pxToPt(pageSize.width), pxToPt(pageSize.height)],
    autoFirstPage: false,
    margin: 0,
    info,
  })
  const bytesPromise = collectPdfBytes(doc)

  const ctx: PdfContext = {
    doc,
    registeredFontNames: new Map(),
    imageEmbedCache: new Map(),
    fallbackFonts: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
    warnedMissingFonts: new Set(),
  }

  const { margins, headerHeight, headerGap, footerHeight } = result
  const headerOriginX = margins.left
  const headerOriginY = margins.top
  const bodyOriginX = margins.left
  const bodyOriginY = margins.top + headerHeight + headerGap
  const footerOriginX = margins.left
  const footerOriginY = pageSize.height - margins.bottom - footerHeight

  const pageWidthPt = pxToPt(pageSize.width)
  const pageHeightPt = pxToPt(pageSize.height)

  for (const pdfPage of result.pages) {
    // No args: addPage() reuses the doc-level `options` (size + margin) passed to the PDFDocument
    // constructor above as its default for every new page.
    doc.addPage()
    if (pdfPage.background !== null) {
      doc.rect(0, 0, pageWidthPt, pageHeightPt).fill(resolvePdfColor(pdfPage.background))
    }
    if (pdfPage.header !== null) await drawPdfNode(pdfPage.header, headerOriginX, headerOriginY, ctx)
    for (const node of pdfPage.body) await drawPdfNode(node, bodyOriginX, bodyOriginY, ctx)
    if (pdfPage.footer !== null) await drawPdfNode(pdfPage.footer, footerOriginX, footerOriginY, ctx)
    // Drawn last (before only the page border) — on top of everything, so an opaque table/container/
    // chart background elsewhere on the page can never hide it. See drawWatermark's own comment.
    if (pdfPage.watermark !== null) await drawWatermark(ctx, pdfPage.watermark, pageSize.width, pageSize.height)
    if (pdfPage.border !== null) {
      // pdfkit centers a stroke on its path, so a rect drawn flush with the page edges (0,0,w,h)
      // would have HALF its line width fall outside the page's own MediaBox — there's no bleed area
      // a PDF page can render into, so that outer half is simply clipped away, leaving only a
      // half-thickness border visible (matches the reported "PDF border is too small" bug). Insetting
      // the rect by half the stroke width on every side keeps the whole stroke within the page,
      // matching CSS's border-box model (mount()'s border sits fully inside the page element).
      const thicknessPt = pxToPt(pdfPage.border.thickness ?? 1)
      const halfThicknessPt = thicknessPt / 2
      doc
        .rect(halfThicknessPt, halfThicknessPt, pageWidthPt - thicknessPt, pageHeightPt - thicknessPt)
        .lineWidth(thicknessPt)
        .stroke(resolvePdfColor(pdfPage.border.color ?? '#000000'))
    }
  }

  doc.end()
  return bytesPromise
}
