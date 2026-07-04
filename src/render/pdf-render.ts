// PDF renderer. A second, independent paint step over the exact same PaginatedResult/RenderedNode
// data mount() (shadow-dom.ts) already consumes — same relationship renderPreview() already has to
// mount() (data first, DOM is just one possible consumer). Produces a real vector PDF via pdfkit:
// selectable/searchable text, not a screenshot.
//
// The one thing this file cannot get "for free" from shared data is fonts: pretext decided every
// line break by measuring against whatever font FILE the browser's canvas resolved for a TextNode's
// `fontFamily` string (see measure-text.ts / font-registry.ts's header comment). For the PDF's
// embedded vector glyphs to reproduce identical line breaks, it must embed that literal file — see
// font-registry.ts. When a family/weight/style was never registered, this file falls back to a
// Helvetica standard font (warn once, not throw — see generatePdf()'s header comment) rather than
// blocking generation; the fallback's glyph widths differ from what was actually measured, so its
// line/box positions (already fixed by pagination) can visually mismatch the registered-font case
// slightly — a known, documented tradeoff, not a bug.
//
// Coordinate system: pdfkit's page space is ALREADY top-left origin, y-down (it applies a
// `1 0 0 -1 0 pageHeight` CTM flip once per page internally, confirmed by inspecting its output) —
// the same convention PaginatedResult's px values use. So the only conversion needed is the uniform
// PX_TO_PT unit scale (96dpi -> 72dpi), applied at the final leaf draw call only (toPdfRect /
// chartToPagePoint) — no y-flip math anywhere in this file. Traversal itself accumulates origins in
// px exactly like shadow-dom.ts's renderNode(), so this file's recursive shape is a straight port of
// that one, swapping `container.appendChild(styledDiv(...))` for pdfkit draw calls.
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
import type { RenderedNode, RenderedTableCell, RenderedTableRow } from '../core/geometry.ts'
import type { CategoricalChartNode, ChartSeries, ImageNode, ObjectFit, RadialChartNode, SeparatorNode, TableNode, TextNode } from '../core/nodes.ts'
import { resolveColumnWidths } from '../core/table-layout.ts'
import { BORDER_EPSILON, subtractIntervals } from './interval-utils.ts'
import { lookupFont, normalizeFontWeight } from './font-registry.ts'
import type { FontStyle, RegisteredFont } from './font-registry.ts'
import {
  AXIS_COLOR,
  BAR_MAX_THICKNESS,
  GRIDLINE_COLOR,
  INK_MUTED,
  INK_SECONDARY,
  LINE_STROKE_WIDTH,
  MARKER_RADIUS,
  MARKER_RING_RADIUS,
  MARK_SURFACE_GAP,
  SURFACE_COLOR,
  areaFillGradientVector,
  areaPath,
  barPath,
  donutSlicePath,
  estimateTextWidth,
  legendEntriesFor,
  linePath,
  niceTickValues,
  pieSlicePath,
  resolveChartDomain,
  resolveColor,
  resolveLineFill,
  resolveShowLegend,
  resolveTitle,
  stackedBarSegments,
  stackedSegmentPixelRange,
  textBaselineOffset,
  truncateToWidth,
} from './chart-render.ts'
import type { ChartBox, LegendEntry } from './chart-render.ts'

export type PdfMetadata = { title?: string; author?: string; subject?: string; keywords?: string[] }

const PX_TO_PT = 0.75 // 96dpi px -> 72dpi pt (96/72). A4 794x1123px * 0.75 = 595.5x842.25pt, matching the standard PDF A4 size.
function pxToPt(n: number): number {
  return n * PX_TO_PT
}

type PdfContext = {
  doc: PDFKit.PDFDocument
  registeredFontNames: Map<RegisteredFont, string>
  imageEmbedCache: Map<string, string>
  fallbackFonts: { regular: string; bold: string; italic: string; boldItalic: string }
  warnedMissingFonts: Set<string>
}

function toPdfRect(xPx: number, yPx: number, wPx: number, hPx: number): { x: number; y: number; width: number; height: number } {
  return { x: pxToPt(xPx), y: pxToPt(yPx), width: pxToPt(wPx), height: pxToPt(hPx) }
}

// Every color in this codebase's node types is a plain CSS `string` with no enforced format; every
// actual usage (including the whole main.ts demo) is hex. Documented v1 scope limit — falls back to
// black + a warning for anything else, same tier as chart-render.ts's own approximations. pdfkit's own
// color normalizer only understands 3/6-digit hex (no alpha channel), same as what this codebase's
// colors have ever actually carried through to the PDF (pdf-lib's rgb() dropped any 8-digit alpha
// byte too) — so this validates/normalizes to a plain `#rrggbb` string and hands it to pdfkit as-is,
// rather than building a separate color-object type the way pdf-lib's rgb() required.
function resolvePdfColor(css: string): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(css.trim())
  if (match === null) {
    console.warn(`[paginator] generatePdf(): color "${css}" is not a recognized hex color — falling back to black.`)
    return '#000000'
  }
  let hex = match[1]!
  if (hex.length === 3) hex = [...hex].map(c => c + c).join('')
  return `#${hex.slice(0, 6)}`
}

function warnMissingFontOnce(ctx: PdfContext, family: string, weight: number, style: FontStyle): void {
  const key = `${family}|${weight}|${style}`
  if (ctx.warnedMissingFonts.has(key)) return
  ctx.warnedMissingFonts.add(key)
  console.warn(
    `[paginator] generatePdf(): no font registered for family "${family}", weight ${weight}, style "${style}" — falling back to a Helvetica ` +
      `standard font. Text layout was measured against this font on screen; the substitute's glyph widths differ, so the PDF's fit/alignment for ` +
      `this text may not exactly match the preview. Call registerFont({ family: '${family}', weight: ${weight}, style: '${style}', url: '...' }) ` +
      `before generatePdf() to embed the identical font.`,
  )
}

// pdfkit's registerFont() just stores the (name -> src) mapping for lazy resolution on first .font(name)
// use, so this is synchronous and needs no cache of its own beyond "was this RegisteredFont already
// registered under a name" — registering the same name twice would be harmless but wasteful.
// RegisteredFont.bytes (a plain Uint8Array) is accepted by pdfkit's font loader directly — confirmed
// via source (PDFFontFactory.open branches on `src instanceof Uint8Array`), no Buffer wrapping needed.
function ensureRegisteredFont(ctx: PdfContext, font: RegisteredFont): string {
  const cached = ctx.registeredFontNames.get(font)
  if (cached !== undefined) return cached
  const name = `${font.family}|${font.weight}|${font.style}`
  ctx.doc.registerFont(name, font.bytes as unknown as Buffer)
  ctx.registeredFontNames.set(font, name)
  return name
}

function pickFallbackFont(ctx: PdfContext, weight: number, style: FontStyle): string {
  const bold = weight >= 600
  const italic = style === 'italic'
  if (bold && italic) return ctx.fallbackFonts.boldItalic
  if (bold) return ctx.fallbackFonts.bold
  if (italic) return ctx.fallbackFonts.italic
  return ctx.fallbackFonts.regular
}

function resolveTextFont(ctx: PdfContext, node: TextNode): string {
  const weight = normalizeFontWeight(node.fontWeight)
  const style: FontStyle = node.fontStyle === 'italic' ? 'italic' : 'normal'
  const registered = lookupFont(node.fontFamily, weight, style)
  if (registered !== undefined) return ensureRegisteredFont(ctx, registered)
  warnMissingFontOnce(ctx, node.fontFamily, weight, style)
  return pickFallbackFont(ctx, weight, style)
}

function textNodeFontString(node: TextNode): string {
  const style = node.fontStyle === 'italic' ? 'italic ' : ''
  const weight = node.fontWeight ?? 400
  return `${style}${weight} ${node.fontSize}px ${node.fontFamily}`
}

const fontMetricsCache = new Map<string, { ascentPx: number; descentPx: number }>()
let metricsCanvasCtx: OffscreenCanvasRenderingContext2D | null = null

// Measuring ascent/descent via the browser's own canvas (rather than trusting the embedded font
// object's own metrics) ties baseline positioning to the identical source of truth pretext itself
// already trusts for width, rather than a second, independently computed one. Cached per distinct
// font CSS string.
function measureFontMetricsPx(fontCss: string): { ascentPx: number; descentPx: number } {
  const cached = fontMetricsCache.get(fontCss)
  if (cached !== undefined) return cached
  if (metricsCanvasCtx === null) {
    const ctx2d = new OffscreenCanvas(1, 1).getContext('2d')
    if (ctx2d === null) throw new Error('[paginator] generatePdf(): could not acquire a 2D context for font metrics.')
    metricsCanvasCtx = ctx2d
  }
  metricsCanvasCtx.font = fontCss
  const metrics = metricsCanvasCtx.measureText('Hg')
  const result = { ascentPx: metrics.fontBoundingBoxAscent, descentPx: metrics.fontBoundingBoxDescent }
  fontMetricsCache.set(fontCss, result)
  return result
}

// pretext's `line.y = i * lineHeight` (positionLines(), measure-text.ts) is the TOP of each line's
// box, not a baseline, so the actual PDF baseline is derived from the resolved font's own ascent/
// descent — approximating the CSS half-leading algorithm the browser uses when laying a line box out
// around a font's own metrics: (lineHeight - (ascent+descent)) split evenly above/below the glyphs.
// Best-effort, not a formal guarantee (browsers and canvas's own metrics can disagree by a fraction of
// a pixel) — same tier as chart-render.ts's estimateTextWidth approximation.
//
// `baseline: 0` is load-bearing: pdfkit's .text() defaults to treating its `y` argument as the TOP of
// the text box (offsetting down by the font's own ascender internally) to match typical word-processor
// usage — passing `baseline: 0` (pdfkit's "alphabetic" baseline, zero offset) makes `y` mean the exact
// baseline instead, matching this function's own from-scratch baseline math (and pdf-lib's original
// drawText() convention). `lineBreak: false` is equally load-bearing: without it, pdfkit defaults
// `options.width` to the remaining page width and re-wraps the string through its own line-breaking
// engine, silently discarding pretext's already-computed line breaks.
function drawTextNode(ctx: PdfContext, rendered: Extract<RenderedNode, { type: 'text' }>, x: number, y: number, fontName: string): void {
  const node = rendered.node
  const fontSizePt = pxToPt(node.fontSize)
  const { ascentPx, descentPx } = measureFontMetricsPx(textNodeFontString(node))
  const lineHeightPt = pxToPt(node.lineHeight)
  const ascentPt = pxToPt(ascentPx)
  const fullHeightPt = pxToPt(ascentPx + descentPx)
  const halfLeadingPt = (lineHeightPt - fullHeightPt) / 2
  const baselineFromTopPt = halfLeadingPt + ascentPt
  const color = resolvePdfColor(node.color ?? '#000000')
  const characterSpacing = node.letterSpacing !== undefined ? pxToPt(node.letterSpacing) : 0

  ctx.doc.font(fontName).fontSize(fontSizePt).fillColor(color)
  for (const line of rendered.lines) {
    const lineTopPt = pxToPt(y + line.y)
    const baselinePt = lineTopPt + baselineFromTopPt
    const startXPt = pxToPt(x + line.x)
    ctx.doc.text(line.text, startXPt, baselinePt, { lineBreak: false, baseline: 0, characterSpacing })
  }
}

function drawSeparatorNode(ctx: PdfContext, rendered: Extract<RenderedNode, { type: 'separator' }>, x: number, y: number): void {
  const node: SeparatorNode = rendered.node
  const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
  ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(node.color ?? '#000000'))
}

// Mirrors CSS object-fit's crop/letterbox math exactly (fill/none/contain/cover/scale-down), computed
// once here since pdfkit has no native equivalent (its `fit`/`cover` options size the whole image, but
// neither clips overflow nor supports a source-rect crop) — the canvas rasterization step below bakes
// the result in so the actual PDF draw call is always a trivial "place this box-sized PNG in this box".
function resolveObjectFitRects(
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
// then places the result at the box's ORIGINAL (unscaled) point size (see embedImage/drawImageNode) —
// the viewer/printer downsamples the extra pixels, which is what makes this sharp rather than just
// bigger. 2x ≈ 192dpi effective resolution — noticeably sharper than screen (96dpi) and still clean at
// typical zoom, short of dedicated print quality (300dpi) but a deliberate tradeoff: each embedded
// image is losslessly PNG-encoded (see embedImage's header comment), so pixel count drives PDF file
// size and PDF-viewer scroll/zoom performance directly. 3x (288dpi, near print quality) made large
// photos noticeably heavy — 2x quarters the pixel count against that baseline for a meaningfully
// lighter, more responsive PDF, at the cost of print-grade sharpness.
const RASTER_SCALE = 1

// One code path handles every source format pdfkit itself can't natively decode (WebP/GIF/SVG — only
// PNG/JPEG are native, same limitation pdf-lib had) AND every objectFit value (pdfkit's `fit`/`cover`
// options size but don't crop): decode via the browser's own image pipeline, draw into an offscreen
// canvas sized to the resolved box (scaled up by RASTER_SCALE for print/zoom sharpness) with the
// objectFit math already applied, re-export as PNG. Runs at PDF-generation time via a detached canvas,
// not inside paginate(), so it doesn't touch the sync/no-DOM-during-layout invariant.
async function rasterizeImageToPng(node: ImageNode, boxWidthPx: number, boxHeightPx: number): Promise<Uint8Array> {
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
// here (consistent with this file's header: avoid extra polyfill packages beyond pdfkit's own bundle).
// Chunked to avoid call-stack overflow from spreading a large image into String.fromCharCode.
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
async function embedImage(ctx: PdfContext, node: ImageNode, boxWidthPx: number, boxHeightPx: number): Promise<string> {
  const key = `${node.src}|${node.objectFit ?? 'fill'}|${Math.round(boxWidthPx)}|${Math.round(boxHeightPx)}`
  const cached = ctx.imageEmbedCache.get(key)
  if (cached !== undefined) return cached
  const pngBytes = await rasterizeImageToPng(node, boxWidthPx, boxHeightPx)
  const dataUri = `data:image/png;base64,${bytesToBase64(pngBytes)}`
  ctx.imageEmbedCache.set(key, dataUri)
  return dataUri
}

async function drawImageNode(ctx: PdfContext, rendered: Extract<RenderedNode, { type: 'image' }>, x: number, y: number): Promise<void> {
  const dataUri = await embedImage(ctx, rendered.node, rendered.box.width, rendered.box.height)
  const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
  ctx.doc.image(dataUri, rect.x, rect.y, { width: rect.width, height: rect.height })
}

// ---- Table (port of shadow-dom.ts's renderTableNode/renderTableBorders — see that file's comments
// for the straddle/interval reasoning this mirrors verbatim, only the final draw call differs) ----

function drawTableBorders(
  ctx: PdfContext,
  node: TableNode,
  rendered: Extract<RenderedNode, { type: 'table' }>,
  colWidths: number[],
  colX: number[],
  originX: number,
  originY: number,
  x: number,
  y: number,
): void {
  if (node.border === undefined || node.border.mode === 'none') return
  const mode = node.border.mode ?? 'all'
  const thickness = node.border.thickness ?? 1
  const color = resolvePdfColor(node.border.color ?? '#000000')

  const outerH = mode === 'all' || mode === 'outer' || mode === 'horizontal'
  const innerH = mode === 'all' || mode === 'horizontal'
  const outerV = mode === 'all' || mode === 'outer' || mode === 'vertical'
  const innerV = mode === 'all' || mode === 'vertical'

  const tableTop = y
  const tableBottom = y + rendered.box.height
  const tableLeft = x
  const tableRight = x + rendered.box.width

  const cellBox = (cell: RenderedTableCell) => ({
    left: originX + cell.box.x,
    top: originY + cell.box.y,
    right: originX + cell.box.x + cell.box.width,
    bottom: originY + cell.box.y + cell.box.height,
  })

  // A colSpan-aware 'header' row (`row.cells` set, see nodes.ts) behaves exactly like an ordinary
  // row for border purposes — its cells only straddle the lines their own colSpan actually crosses.
  const cellBoxes = rendered.rows.flatMap(row => (row.kind === 'header' ? (row.cells ?? []).map(cellBox) : row.cells.map(cellBox)))

  // Only a `content`-shaped 'header' row (no per-column cells) needs the "straddles every inner
  // vertical line" treatment — a `cells`-shaped header is already fully covered by `cellBoxes` above.
  const headerRowVRanges: [number, number][] = rendered.rows
    .filter((row): row is Extract<RenderedTableRow, { kind: 'header' }> => row.kind === 'header' && row.cells === undefined)
    .map(row => [originY + row.box.y, originY + row.box.y + row.box.height])

  const hYs: number[] = []
  if (outerH) hYs.push(tableTop, tableBottom)
  if (innerH) {
    for (let i = 0; i < rendered.rows.length - 1; i++) hYs.push(originY + rendered.rows[i]!.box.y + rendered.rows[i]!.box.height)
  }
  for (const lineY of hYs) {
    const straddling = cellBoxes.filter(b => b.top < lineY - BORDER_EPSILON && lineY + BORDER_EPSILON < b.bottom)
    const segments = subtractIntervals([tableLeft, tableRight], straddling.map(b => [b.left, b.right] as const))
    for (const [segStart, segEnd] of segments) {
      const rect = toPdfRect(segStart, lineY, segEnd - segStart, thickness)
      ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(color)
    }
  }

  const vXs: number[] = []
  if (outerV) vXs.push(tableLeft, tableRight)
  if (innerV) {
    for (let i = 0; i < colWidths.length - 1; i++) vXs.push(originX + colX[i]! + colWidths[i]!)
  }
  for (const lineX of vXs) {
    const straddling = cellBoxes.filter(b => b.left < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < b.right)
    const headerHoles = tableLeft < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < tableRight ? headerRowVRanges : []
    const segments = subtractIntervals([tableTop, tableBottom], [...straddling.map(b => [b.top, b.bottom] as const), ...headerHoles])
    for (const [segStart, segEnd] of segments) {
      const rect = toPdfRect(lineX, segStart, thickness, segEnd - segStart)
      ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(color)
    }
  }
}

async function drawTableNode(ctx: PdfContext, rendered: Extract<RenderedNode, { type: 'table' }>, originX: number, originY: number): Promise<void> {
  const node = rendered.node
  const x = originX + rendered.box.x
  const y = originY + rendered.box.y
  const colWidths = resolveColumnWidths(node.columns, rendered.box.width)
  const colX: number[] = []
  let acc = 0
  for (const w of colWidths) {
    colX.push(acc)
    acc += w
  }

  // Shared by an ordinary 'cells' row AND a colSpan-aware 'header' row (see nodes.ts) — same
  // per-cell background-then-content drawing either way.
  const drawCellsRow = async (cells: RenderedTableCell[]): Promise<void> => {
    for (const cell of cells) {
      if (cell.background === undefined) continue
      const rect = toPdfRect(originX + cell.box.x, originY + cell.box.y, cell.box.width, cell.box.height)
      ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(cell.background))
    }
    for (const cell of cells) await drawNode(ctx, cell.rendered, originX, originY)
  }

  for (const row of rendered.rows) {
    if (row.kind === 'header') {
      if (row.cells !== undefined) {
        await drawCellsRow(row.cells)
        continue
      }
      if (row.background !== undefined) {
        const rect = toPdfRect(originX + row.box.x, originY + row.box.y, row.box.width, row.box.height)
        ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(row.background))
      }
      await drawNode(ctx, row.content!, originX, originY)
      continue
    }
    await drawCellsRow(row.cells)
  }

  drawTableBorders(ctx, node, rendered, colWidths, colX, originX, originY, x, y)
}

// ---- Chart (port of chart-render.ts — reuses its pure geometry/color/text-estimate helpers
// unchanged, only the final SVG-element-append calls become pdfkit draw calls. Chart text
// deliberately never goes through the font registry: chart-render.ts already documents using a fixed
// heuristic text-width estimate rather than real measurement, so it never claimed font-exact fidelity
// to the document's own registered fonts — using the two shared Helvetica fallback names here is free) ----

function chartToPagePoint(originX: number, originY: number, localX: number, localY: number): { x: number; y: number } {
  return { x: pxToPt(originX + localX), y: pxToPt(originY + localY) }
}

function drawChartLine(ctx: PdfContext, x1: number, y1: number, x2: number, y2: number, color: string, thickness: number, originX: number, originY: number): void {
  const start = chartToPagePoint(originX, originY, x1, y1)
  const end = chartToPagePoint(originX, originY, x2, y2)
  ctx.doc.moveTo(start.x, start.y).lineTo(end.x, end.y).lineWidth(pxToPt(thickness)).stroke(color)
}

// Strokes a chart-local SVG path string (as produced by chart-render.ts's linePath()) as ONE
// continuous stroke — same translate/scale content-matrix trick as drawChartPath below, so
// `thickness` is passed in raw local px (the ctx.scale(PX_TO_PT) already converts it), not pre-
// converted via pxToPt the way drawChartLine's per-segment moveTo/lineTo calls need. Round join/cap
// match chart-render.ts's SVG <path> stroke-linejoin/stroke-linecap so a curved multi-segment line
// doesn't grow visible miter spikes at points where the tangent changes direction.
function drawChartPathStroke(ctx: PdfContext, d: string, color: string, thickness: number, originX: number, originY: number): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  ctx.doc.save()
  ctx.doc.translate(origin.x, origin.y)
  ctx.doc.scale(PX_TO_PT)
  ctx.doc.path(d)
  ctx.doc.lineWidth(thickness).lineJoin('round').lineCap('round')
  ctx.doc.stroke(color)
  ctx.doc.restore()
}

// Fills a chart-local SVG path string with a linear gradient — opaque `color`/`opacity` at
// (gx1,gy1), fading to fully transparent at (gx2,gy2). Coordinates are in the SAME local chart-px
// space as `d` (see areaFillGradientVector()'s header comment): pdfkit's gradient reads the CTM at
// the moment `.fill(gradient)` runs (confirmed in its PDFGradient.apply()), so defining it inside
// this save/translate/scale block — exactly like drawChartPath's solid fill — makes it pick up the
// same origin-translate + px->pt scale as the path itself, with no separate unit conversion needed.
function drawChartAreaFill(ctx: PdfContext, d: string, gx1: number, gy1: number, gx2: number, gy2: number, color: string, opacity: number, originX: number, originY: number): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  ctx.doc.save()
  ctx.doc.translate(origin.x, origin.y)
  ctx.doc.scale(PX_TO_PT)
  ctx.doc.path(d)
  const gradient = ctx.doc.linearGradient(gx1, gy1, gx2, gy2)
  gradient.stop(0, color, opacity)
  gradient.stop(1, color, 0)
  ctx.doc.fill(gradient)
  ctx.doc.restore()
}

function drawChartCircle(ctx: PdfContext, cx: number, cy: number, r: number, color: string, originX: number, originY: number): void {
  const center = chartToPagePoint(originX, originY, cx, cy)
  ctx.doc.circle(center.x, center.y, pxToPt(r)).fill(color)
}

// chart-render.ts's path builders (barPath/pieSlicePath/donutSlicePath) emit raw-px SVG path strings
// anchored at the chart's own local (0,0) — pdfkit's .path() takes an SVG path string literally in
// its CURRENT coordinate space with no coordinate reinterpretation of its own (confirmed empirically:
// a path string drawn immediately after pdfkit's one-time page-level y-flip lands exactly where its
// literal top-left/y-down coordinates say it should, unlike pdf-lib's drawSvgPath() which flips the
// path's SVG-vs-PDF y-axis internally). So the origin translate (already in pt) and the px->pt unit
// scale are pushed as content-matrix transforms around the path — save()/translate()/scale()/restore()
// — rather than rewriting the numbers inside the `d` string by hand, which would be one misplaced
// digit away from corrupting an arc command's 0/1 flag fields.
function drawChartPath(ctx: PdfContext, d: string, color: string, originX: number, originY: number): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  ctx.doc.save()
  ctx.doc.translate(origin.x, origin.y)
  ctx.doc.scale(PX_TO_PT)
  ctx.doc.path(d)
  ctx.doc.fill(color)
  ctx.doc.restore()
}

// Chart <text> elements' x/y (per chart-render.ts's svgText()) are already the SVG baseline position
// directly — unlike PositionedLine.y (top of line box), so `baseline: 0` (see drawTextNode's comment)
// is exactly right here too, with no half-leading/ascent math needed; only the text-anchor emulation
// pdfkit's text() lacks natively (start/middle/end, via measuring width and shifting x — same
// manual-alignment approach positionLines() already uses for body text).
function drawChartText(
  ctx: PdfContext,
  text: string,
  localX: number,
  localY: number,
  opts: { fontSize: number; color: string; anchor: 'start' | 'middle' | 'end'; bold: boolean },
  originX: number,
  originY: number,
): void {
  const fontName = opts.bold ? ctx.fallbackFonts.bold : ctx.fallbackFonts.regular
  const fontSizePt = pxToPt(opts.fontSize)
  ctx.doc.font(fontName).fontSize(fontSizePt)
  const widthPt = ctx.doc.widthOfString(text)
  const dx = opts.anchor === 'middle' ? -widthPt / 2 : opts.anchor === 'end' ? -widthPt : 0
  const { x, y } = chartToPagePoint(originX, originY, localX, localY)
  ctx.doc.fillColor(opts.color).text(text, x + dx, y, { lineBreak: false, baseline: 0 })
}

function drawChartLegend(
  ctx: PdfContext,
  entries: LegendEntry[],
  box: ChartBox,
  orientation: 'vertical' | 'horizontal',
  fontSize: number,
  originX: number,
  originY: number,
): void {
  const swatch = 10
  const baselineOffset = textBaselineOffset(fontSize)

  if (orientation === 'vertical') {
    const rowHeight = Math.max(swatch + 4, fontSize + 9)
    const maxRows = Math.max(0, Math.floor(box.height / rowHeight))
    entries.slice(0, maxRows).forEach((entry, i) => {
      const rowCenterY = box.y + i * rowHeight + rowHeight / 2
      const rect = toPdfRect(originX + box.x, originY + rowCenterY - swatch / 2, swatch, swatch)
      ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(entry.color))
      const label = truncateToWidth(entry.label, box.width - swatch - 6, fontSize)
      drawChartText(ctx, label, box.x + swatch + 6, rowCenterY + baselineOffset, { fontSize, color: resolvePdfColor(INK_SECONDARY), anchor: 'start', bold: false }, originX, originY)
    })
    return
  }

  let x = box.x
  const centerY = box.y + box.height / 2
  for (const entry of entries) {
    const labelMaxWidth = 90
    const label = truncateToWidth(entry.label, labelMaxWidth, fontSize)
    const labelWidth = Math.min(labelMaxWidth, estimateTextWidth(label, fontSize))
    const entryWidth = swatch + 6 + labelWidth
    if (x + entryWidth > box.x + box.width) break
    const rect = toPdfRect(originX + x, originY + centerY - swatch / 2, swatch, swatch)
    ctx.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(entry.color))
    drawChartText(ctx, label, x + swatch + 6, centerY + baselineOffset, { fontSize, color: resolvePdfColor(INK_SECONDARY), anchor: 'start', bold: false }, originX, originY)
    x += entryWidth + 14
  }
}

// Vertical/horizontal are two dedicated paths, not one axis-agnostic function — see
// chart-render.ts's renderCategoricalChart for the full rationale (mirrors group-layout.ts's
// layoutRow/layoutColumn split).
function drawCategoricalChart(ctx: PdfContext, node: CategoricalChartNode, plot: ChartBox, originX: number, originY: number): void {
  const categories = node.categories
  const series = node.series
  const colors = series.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)))

  const stacked = node.chartKind === 'bar' && (node.barMode ?? 'grouped') === 'stacked'
  const { dataMin, dataMax } = resolveChartDomain(categories, series, stacked, node.view ?? {})
  const axis = node.axis ?? {}
  const barBaselineValue = Math.max(dataMin, Math.min(dataMax, 0))
  const axisShow = axis.show !== false
  const gridlinesShow = axisShow && axis.gridlines !== false
  const tickCount = axis.tickCount ?? 5
  const formatTick = axis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const ticks = niceTickValues(dataMin, dataMax, tickCount)
  const tickFontSize = axis.tickFontSize ?? 11
  const categoryFontSize = axis.categoryFontSize ?? 11
  const tickBaselineOffset = textBaselineOffset(tickFontSize)

  if ((node.orientation ?? 'vertical') === 'horizontal') {
    drawHorizontalCategoricalChart(ctx, node, plot, originX, originY, {
      categories,
      series,
      colors,
      stacked,
      dataMin,
      dataMax,
      barBaselineValue,
      axisShow,
      gridlinesShow,
      ticks,
      formatTick,
      tickFontSize,
      categoryFontSize,
      tickBaselineOffset,
    })
    return
  }

  const categoryLabelOffset = categoryFontSize + 8

  const leftMargin = axisShow ? Math.max(30, Math.max(...ticks.map(t => estimateTextWidth(formatTick(t), tickFontSize))) + 20) : 4
  const bottomMargin = axisShow ? categoryLabelOffset + 6 : 4

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - 8
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const yScale = (value: number): number => plotBottom - ((value - dataMin) / (dataMax - dataMin)) * plotHeight

  if (gridlinesShow) {
    for (const tick of ticks) {
      const gy = yScale(tick)
      drawChartLine(ctx, plotLeft, gy, plotRight, gy, resolvePdfColor(GRIDLINE_COLOR), 1, originX, originY)
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const ty = yScale(tick)
      drawChartText(ctx, formatTick(tick), plotLeft - 8, ty + tickBaselineOffset, { fontSize: tickFontSize, color: resolvePdfColor(INK_MUTED), anchor: 'end', bold: false }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, resolvePdfColor(AXIS_COLOR), 1, originX, originY)
  }

  const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth
  const labelEstWidth = Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize)), 1)
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Number.POSITIVE_INFINITY

  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const cx = plotLeft + bandWidth * (ci + 0.5)
      drawChartText(ctx, category, cx, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, color: resolvePdfColor(INK_MUTED), anchor: 'middle', bold: false }, originX, originY)
    })
  }

  if (node.chartKind === 'bar' && stacked) {
    const segmentGap = node.barSegmentGap ?? 0
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandWidth - MARK_SURFACE_GAP * 2))

    categories.forEach((_, ci) => {
      const bandX = plotLeft + bandWidth * ci
      const barX = bandX + (bandWidth - barThickness) / 2
      const values = series.map(s => s.data[ci]!)
      for (const seg of stackedBarSegments(values)) {
        const range = stackedSegmentPixelRange(seg, yScale, segmentGap)
        if (range === null) continue
        drawChartPath(ctx, barPath(barX, range.coordStart, barThickness, range.length, seg.round), colors[seg.seriesIndex]!, originX, originY)
      }
    })
    return
  }

  if (node.chartKind === 'bar') {
    const rawThickness = (bandWidth - MARK_SURFACE_GAP * (series.length + 1)) / Math.max(series.length, 1)
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness))
    const groupWidth = barThickness * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)
    const zeroY = yScale(barBaselineValue)

    categories.forEach((_, ci) => {
      const bandX = plotLeft + bandWidth * ci
      const groupStart = bandX + (bandWidth - groupWidth) / 2
      series.forEach((s, si) => {
        const value = s.data[ci]!
        const barX = groupStart + si * (barThickness + MARK_SURFACE_GAP)
        const valueY = yScale(value)
        const barY = Math.min(zeroY, valueY)
        const barH = Math.abs(valueY - zeroY)
        if (barH <= 0) return
        drawChartPath(ctx, barPath(barX, barY, barThickness, barH, value >= barBaselineValue ? 'top' : 'bottom'), colors[si]!, originX, originY)
      })
    })
    return
  }

  // Line chart.
  const curve = node.lineCurve ?? 'linear'
  series.forEach((s, si) => {
    const points = categories.map((_, ci) => [plotLeft + bandWidth * (ci + 0.5), yScale(s.data[ci]!)] as const)
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      const baselineY = yScale(barBaselineValue)
      const { from, to } = areaFillGradientVector(points, 'x', baselineY)
      drawChartAreaFill(ctx, areaPath(points, curve, 'x', baselineY), 0, from, 0, to, resolvePdfColor(fill.color), fill.opacity, originX, originY)
    }
    drawChartPathStroke(ctx, linePath(points, curve, 'x'), colors[si]!, LINE_STROKE_WIDTH, originX, originY)
    for (const [px, py] of points) {
      drawChartCircle(ctx, px, py, MARKER_RING_RADIUS, resolvePdfColor(SURFACE_COLOR), originX, originY)
      drawChartCircle(ctx, px, py, MARKER_RADIUS, colors[si]!, originX, originY)
    }
  })
}

type CategoricalChartContext = {
  categories: string[]
  series: ChartSeries[]
  colors: string[]
  stacked: boolean
  dataMin: number
  dataMax: number
  barBaselineValue: number
  axisShow: boolean
  gridlinesShow: boolean
  ticks: number[]
  formatTick: (value: number) => string
  tickFontSize: number
  categoryFontSize: number
  tickBaselineOffset: number
}

// Mirrors chart-render.ts's renderHorizontalCategoricalChart field-for-field — categories run
// top-to-bottom, values run left-to-right, bars grow rightward (or leftward below the baseline).
function drawHorizontalCategoricalChart(ctx: PdfContext, node: CategoricalChartNode, plot: ChartBox, originX: number, originY: number, chartCtx: CategoricalChartContext): void {
  const { categories, series, colors, stacked, dataMin, dataMax, barBaselineValue, axisShow, gridlinesShow, ticks, formatTick, tickFontSize, categoryFontSize, tickBaselineOffset } = chartCtx

  const leftMargin = axisShow ? Math.max(30, Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize))) + 16) : 4
  const bottomMargin = axisShow ? tickFontSize + 20 : 4

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - 8
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const xScale = (value: number): number => plotLeft + ((value - dataMin) / (dataMax - dataMin)) * plotWidth

  if (gridlinesShow) {
    for (const tick of ticks) {
      const x = xScale(tick)
      drawChartLine(ctx, x, plotTop, x, plotBottom, resolvePdfColor(GRIDLINE_COLOR), 1, originX, originY)
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const x = xScale(tick)
      drawChartText(ctx, formatTick(tick), x, plotBottom + tickFontSize + 4, { fontSize: tickFontSize, color: resolvePdfColor(INK_MUTED), anchor: 'middle', bold: false }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotTop, plotLeft, plotBottom, resolvePdfColor(AXIS_COLOR), 1, originX, originY)
  }

  const bandHeight = categories.length > 0 ? plotHeight / categories.length : plotHeight
  const labelEstHeight = categoryFontSize + 4
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstHeight / Math.max(bandHeight, 1))) : Number.POSITIVE_INFINITY

  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const y = plotTop + bandHeight * (ci + 0.5)
      drawChartText(ctx, category, plotLeft - 8, y + tickBaselineOffset, { fontSize: categoryFontSize, color: resolvePdfColor(INK_MUTED), anchor: 'end', bold: false }, originX, originY)
    })
  }

  if (node.chartKind === 'bar' && stacked) {
    const segmentGap = node.barSegmentGap ?? 0
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandHeight - MARK_SURFACE_GAP * 2))

    categories.forEach((_, ci) => {
      const bandY = plotTop + bandHeight * ci
      const barY = bandY + (bandHeight - barThickness) / 2
      const values = series.map(s => s.data[ci]!)
      for (const seg of stackedBarSegments(values)) {
        const range = stackedSegmentPixelRange(seg, xScale, segmentGap)
        if (range === null) continue
        const round = seg.round === 'top' ? 'right' : seg.round === 'bottom' ? 'left' : 'none'
        drawChartPath(ctx, barPath(range.coordStart, barY, range.length, barThickness, round), colors[seg.seriesIndex]!, originX, originY)
      }
    })
    return
  }

  if (node.chartKind === 'bar') {
    const rawThickness = (bandHeight - MARK_SURFACE_GAP * (series.length + 1)) / Math.max(series.length, 1)
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness))
    const groupHeight = barThickness * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)
    const zeroX = xScale(barBaselineValue)

    categories.forEach((_, ci) => {
      const bandY = plotTop + bandHeight * ci
      const groupStart = bandY + (bandHeight - groupHeight) / 2
      series.forEach((s, si) => {
        const value = s.data[ci]!
        const barY = groupStart + si * (barThickness + MARK_SURFACE_GAP)
        const valueX = xScale(value)
        const barX = Math.min(zeroX, valueX)
        const barW = Math.abs(valueX - zeroX)
        if (barW <= 0) return
        drawChartPath(ctx, barPath(barX, barY, barW, barThickness, value >= barBaselineValue ? 'right' : 'left'), colors[si]!, originX, originY)
      })
    })
    return
  }

  // Line chart.
  const curve = node.lineCurve ?? 'linear'
  series.forEach((s, si) => {
    const points = categories.map((_, ci) => [xScale(s.data[ci]!), plotTop + bandHeight * (ci + 0.5)] as const)
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      const baselineX = xScale(barBaselineValue)
      const { from, to } = areaFillGradientVector(points, 'y', baselineX)
      drawChartAreaFill(ctx, areaPath(points, curve, 'y', baselineX), from, 0, to, 0, resolvePdfColor(fill.color), fill.opacity, originX, originY)
    }
    drawChartPathStroke(ctx, linePath(points, curve, 'y'), colors[si]!, LINE_STROKE_WIDTH, originX, originY)
    for (const [px, py] of points) {
      drawChartCircle(ctx, px, py, MARKER_RING_RADIUS, resolvePdfColor(SURFACE_COLOR), originX, originY)
      drawChartCircle(ctx, px, py, MARKER_RADIUS, colors[si]!, originX, originY)
    }
  })
}

function drawPieChart(ctx: PdfContext, node: RadialChartNode, plot: ChartBox, originX: number, originY: number): void {
  const slices = node.slices
  const colors = slices.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)))
  const total = slices.reduce((acc, s) => acc + s.value, 0) || 1

  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const radius = Math.max(0, Math.min(plot.width, plot.height) / 2 - 8)
  const isDonut = node.chartKind === 'donut'
  const innerRadius = node.chartKind === 'donut' ? radius * (node.donutInnerRadiusRatio ?? 0.6) : 0

  const gapDeg = slices.length > 1 ? (node.sliceGap ?? 1.5) : 0
  // See chart-render.ts's renderPieChart for the full rationale — a constant pixel half-width,
  // not a trimmed angle, so the gap stays the same width from the apex/inner rim to the outer rim.
  const halfGapPx = radius * Math.sin((gapDeg / 2) * (Math.PI / 180))
  let angle = -90
  slices.forEach((s, i) => {
    const sweep = (s.value / total) * 360
    if (sweep > 0) {
      // No border here — separation comes entirely from the offset geometry, so `sliceGap: 0`
      // means genuinely flush slices in the PDF too.
      const d = isDonut
        ? donutSlicePath(cx, cy, innerRadius, radius, angle, angle + sweep, halfGapPx)
        : pieSlicePath(cx, cy, radius, angle, angle + sweep, halfGapPx)
      drawChartPath(ctx, d, colors[i]!, originX, originY)
    }
    angle += sweep
  })
}

function drawChartNode(ctx: PdfContext, rendered: Extract<RenderedNode, { type: 'chart' }>, originX: number, originY: number): void {
  const node = rendered.node
  const width = rendered.box.width
  const height = rendered.box.height

  let top = 0
  let bottom = height
  let left = 0
  let right = width

  const title = resolveTitle(node)
  if (title !== null) {
    const band = title.fontSize + 16
    drawChartText(ctx, title.text, width / 2, top + title.fontSize + 4, { fontSize: title.fontSize, color: resolvePdfColor(title.color), anchor: 'middle', bold: false }, originX, originY)
    top += band
  }

  const entries = legendEntriesFor(node)
  if (resolveShowLegend(node, entries.length) && entries.length > 0) {
    const legendFontSize = node.legend?.fontSize ?? 11
    const position = node.legend?.position ?? 'right'
    if (position === 'right') {
      const legendWidth = Math.min(140, width * 0.28)
      right -= legendWidth
      drawChartLegend(ctx, entries, { x: right + 12, y: top, width: legendWidth - 12, height: bottom - top }, 'vertical', legendFontSize, originX, originY)
    } else {
      const legendHeight = Math.max(24, legendFontSize + 14)
      bottom -= legendHeight
      drawChartLegend(ctx, entries, { x: left, y: bottom, width: right - left, height: legendHeight }, 'horizontal', legendFontSize, originX, originY)
    }
  }

  const plot: ChartBox = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  if (node.chartKind === 'bar' || node.chartKind === 'line') {
    drawCategoricalChart(ctx, node, plot, originX, originY)
  } else {
    drawPieChart(ctx, node, plot, originX, originY)
  }
}

// ---- Dispatch (mirrors shadow-dom.ts's renderNode() 1:1; group/page-break have no PDF equivalent
// beyond recursing/no-op — see that file's own comments for why group's wrapper box is skipped) ----

async function drawNode(ctx: PdfContext, rendered: RenderedNode, originX: number, originY: number): Promise<void> {
  const x = originX + rendered.box.x
  const y = originY + rendered.box.y

  if (rendered.type === 'text') {
    const fontName = resolveTextFont(ctx, rendered.node)
    drawTextNode(ctx, rendered, x, y, fontName)
    return
  }
  if (rendered.type === 'separator') {
    drawSeparatorNode(ctx, rendered, x, y)
    return
  }
  if (rendered.type === 'page-break') return
  if (rendered.type === 'image') {
    await drawImageNode(ctx, rendered, x, y)
    return
  }
  if (rendered.type === 'chart') {
    // x/y (already includes rendered.box.x/y), NOT the raw originX/originY — drawChartNode treats
    // its origin as the chart's OWN box top-left, unlike table/group below (whose children's boxes
    // are already resolved relative to the unchanged origin, per geometry.ts's translateRendered).
    // Passing the raw origin here previously drew every chart at its enclosing group's origin instead
    // of its own position, stacking multiple charts on top of each other.
    drawChartNode(ctx, rendered, x, y)
    return
  }
  if (rendered.type === 'table') {
    await drawTableNode(ctx, rendered, originX, originY)
    return
  }

  for (const child of rendered.children) await drawNode(ctx, child, originX, originY)
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

  for (const pdfPage of result.pages) {
    // No args: addPage() reuses the doc-level `options` (size + margin) passed to the PDFDocument
    // constructor above as its default for every new page.
    doc.addPage()
    if (pdfPage.header !== null) await drawNode(ctx, pdfPage.header, headerOriginX, headerOriginY)
    for (const node of pdfPage.body) await drawNode(ctx, node, bodyOriginX, bodyOriginY)
    if (pdfPage.footer !== null) await drawNode(ctx, pdfPage.footer, footerOriginX, footerOriginY)
  }

  doc.end()
  return bytesPromise
}
