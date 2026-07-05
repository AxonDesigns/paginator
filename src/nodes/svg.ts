// Svg sizing is pure arithmetic from declared width/height/aspectRatio — never from the markup's own
// intrinsic viewBox/width/height, which would force paginate() to become asynchronous (same rationale
// as image.ts). The resolved box only needs to be the right SHAPE; the markup's own viewBox +
// preserveAspectRatio (native SVG behavior in the DOM preview, svg-to-pdfkit's own handling in the
// PDF) reconciles any mismatch between that box and the content's real aspect ratio.

import SVGtoPDF from 'svg-to-pdfkit'
import type { RenderedNode } from '../core/geometry.ts'
import { registerNode } from '../core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx } from '../core/behavior.ts'
import type { SvgNode } from '../core/nodes.ts'
import { BASE_ELEMENT_STYLE } from '../render/reset.ts'
import { toPdfRect } from '../render/pdf-render.ts'

type Rendered = Extract<RenderedNode, { type: 'svg' }>

// Height at a given (already-resolved) box width. svg()'s constructor already guarantees at least
// one of height/aspectRatio is present, so the fallback branch here is unreachable in practice —
// kept as a defensive error rather than a silent NaN if a node is ever hand-built bypassing the
// svg() builder.
function resolveHeight(node: SvgNode, width: number): number {
  if (node.height !== undefined) return node.height
  if (node.aspectRatio !== undefined) return width / node.aspectRatio
  throw new Error('[paginator] svg node has neither "height" nor "aspectRatio" — use the svg() builder, which validates this upfront.')
}

// The width this svg would claim on its own, before the parent's alignment/flex rules are applied —
// used for column shrink-wrap sizing, mirroring imageNaturalWidth.
export function svgNaturalWidth(node: SvgNode, availableWidth: number): number {
  if (node.width !== undefined) return node.width
  if (node.height !== undefined && node.aspectRatio !== undefined) return node.height * node.aspectRatio
  return availableWidth
}

function layout(node: SvgNode, width: number): Rendered {
  return { type: 'svg', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node }
}

// Unlike image.ts, there's no rasterize-and-embed step here — the browser already renders SVG
// natively, so the real markup is parsed and inserted directly. This path is intentionally STRICT
// (throws on malformed markup) since a browser has zero tolerance for invalid XML — unlike the PDF
// path below (svg-to-pdfkit), which degrades gracefully via a warning instead, because its own
// hand-rolled XML parser is deliberately lenient.
const svgParser = new DOMParser()

function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const node = rendered.node
  const parsed = svgParser.parseFromString(node.markup, 'image/svg+xml')
  const parserError = parsed.querySelector('parsererror')
  if (parserError !== null) {
    throw new Error(`[paginator] svg node: failed to parse markup — ${parserError.textContent?.trim() ?? 'malformed SVG'}`)
  }
  const root = parsed.documentElement
  const el = document.importNode(root, true) as unknown as SVGSVGElement
  Object.assign(el.style, BASE_ELEMENT_STYLE, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    ...(node.opacity !== undefined ? { opacity: `${node.opacity}` } : {}),
  })
  // Overridden so the box (not the markup's own width/height attributes) drives the outer size —
  // the root's own viewBox + default preserveAspectRatio ('xMidYMid meet') then contain-fits the
  // content into that box natively, same behavior as an <img>'s object-fit: contain.
  el.setAttribute('width', '100%')
  el.setAttribute('height', '100%')
  ctx.container.appendChild(el)
}

// True vector content — svg-to-pdfkit parses the markup with its own hand-rolled, environment-
// agnostic XML parser (no DOMParser/fs dependency) and emits the same doc.path()/.fill()/.stroke()
// pdfkit calls chart drawing already uses. Its internal px->pt conversion (72/96) is identical to
// this codebase's own PX_TO_PT, so toPdfRect() produces exactly the (x, y, width, height) it expects,
// no separate unit math needed. No borderRadius/clip concept on SvgNode (unlike ImageNode), so only
// the opacity half of image.ts's save/restore pattern applies here.
function drawPdf(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): void {
  const node = rendered.node
  const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
  const doc = ctx.pdf.doc
  const needsOpacity = node.opacity !== undefined
  if (needsOpacity) doc.save().opacity(node.opacity!)
  SVGtoPDF(doc, node.markup, rect.x, rect.y, {
    width: rect.width,
    height: rect.height,
    preserveAspectRatio: 'xMidYMid meet',
    // svg-to-pdfkit's own parser is deliberately lenient (unlike the DOM path's strict DOMParser
    // above) — even markup too malformed for it to make sense of only produces a warning here, never
    // a thrown error, so a document that already renders fine on screen never fails PDF export over
    // one broken decorative element.
    warningCallback: (w: string) => console.warn(`[paginator] svg node: ${w}`),
  })
  if (needsOpacity) doc.restore()
}

registerNode('svg', {
  measureHeight: (node, width) => resolveHeight(node, width),
  isSplittable: () => false,
  layout,
  naturalWidth: svgNaturalWidth,
  renderDom,
  drawPdf,
})
