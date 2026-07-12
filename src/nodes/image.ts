// Image sizing is pure arithmetic from declared width/height/aspectRatio — never from the loaded
// asset's actual pixel dimensions, which would force paginate() to become asynchronous. The resolved
// box only needs to be the right SHAPE; any mismatch between that box and the real image's aspect
// ratio is reconciled by the native `object-fit` CSS property on the rendered <img> in the DOM
// renderer (and the equivalent rasterized crop in the PDF renderer), exactly the way it would be for
// a plain HTML image.

import type { RenderedNode } from '../core/geometry.ts'
import { registerNode } from '../core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx } from '../core/behavior.ts'
import type { ImageNode } from '../core/nodes.ts'
import { BASE_ELEMENT_STYLE } from '../render/reset.ts'
import { embedImage, pxToPt, toPdfRect } from '../render/pdf-render.ts'

type Rendered = Extract<RenderedNode, { type: 'image' }>

// Height at a given (already-resolved) box width. image()'s constructor already guarantees at
// least one of height/aspectRatio is present, so the fallback branch here is unreachable in
// practice — kept as a defensive error rather than a silent NaN if a node is ever hand-built
// bypassing the image() builder.
function resolveHeight(node: ImageNode, width: number): number {
  if (node.height !== undefined) return node.height
  if (node.aspectRatio !== undefined) return width / node.aspectRatio
  throw new Error('[paginator] image node has neither "height" nor "aspectRatio" — use the image() builder, which validates this upfront.')
}

// The width this image would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing. An image with no explicit width and only an
// aspectRatio has no opinion of its own and defaults to filling whatever width it's offered, same
// as a separator.
export function imageNaturalWidth(node: ImageNode, availableWidth: number): number {
  if (node.width !== undefined) return node.width
  if (node.height !== undefined && node.aspectRatio !== undefined) return node.height * node.aspectRatio
  return availableWidth
}

function layout(node: ImageNode, width: number): Rendered {
  return { type: 'image', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node }
}

function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const node = rendered.node
  const el = document.createElement('img')
  Object.assign(el.style, BASE_ELEMENT_STYLE, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    objectFit: node.objectFit ?? 'fill',
    // A replaced element (like <img>) clips its own painted content to border-radius natively —
    // no extra overflow:hidden wrapper needed, unlike a generic block-level box.
    ...(node.borderRadius !== undefined ? { borderRadius: `${node.borderRadius}px` } : {}),
    ...(node.opacity !== undefined ? { opacity: `${node.opacity}` } : {}),
    ...(ctx.cursor !== undefined ? { cursor: ctx.cursor } : {}),
  })
  el.src = node.src
  if (node.alt !== undefined) el.alt = node.alt
  ctx.container.appendChild(el)
}

async function drawPdf(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): Promise<void> {
  const node = rendered.node
  const dataUri = await embedImage(ctx.pdf, node, rendered.box.width, rendered.box.height)
  const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
  const doc = ctx.pdf.doc

  const needsClip = node.borderRadius !== undefined
  const needsOpacity = node.opacity !== undefined
  if (needsClip || needsOpacity) doc.save()
  if (needsClip) doc.roundedRect(rect.x, rect.y, rect.width, rect.height, pxToPt(node.borderRadius!)).clip()
  if (needsOpacity) doc.opacity(node.opacity!)
  doc.image(dataUri, rect.x, rect.y, { width: rect.width, height: rect.height })
  if (needsClip || needsOpacity) doc.restore()
}

registerNode('image', {
  measureHeight: (node, width) => resolveHeight(node, width),
  isSplittable: () => false,
  layout,
  naturalWidth: imageNaturalWidth,
  renderDom,
  drawPdf,
})
