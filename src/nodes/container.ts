// Container is a single-child decorative wrapper (background/border/borderRadius/padding) around
// arbitrary content — see nodes.ts's ContainerNode for the full field contract. `height` is a
// MINIMUM, not exact: box content height is Math.max(node.height ?? 0, childNaturalHeight +
// padding.top + padding.bottom), the same targetHeight-as-floor pattern group.ts's layoutColumn
// already uses — deliberately chosen over exact/clipped sizing so no clip-region code is needed in
// either renderer, and content is never silently lost. Padding always insets the child from
// whatever width/height the box resolved to, exactly like table/layout.ts's layoutCell does with
// cellPadding. Border/borderRadius are pure paint, never consuming layout space.
//
// Unlike the old container-layout.ts, this module recurses into its child via the fully generic
// measureNodeHeight/layoutNodeFull/isSplittable/splitNode/renderNodeDom/drawPdfNode dispatchers —
// safe now that behavior.ts never imports concrete node modules (see behavior.ts's header comment),
// so there's no cycle left to avoid by hand-rolling a local copy of that dispatch.

import type { RenderedNode } from '../core/geometry.ts'
import { translateRendered } from '../core/geometry.ts'
import { drawPdfNode, isSplittable, layoutNodeFull, measureNodeHeight, registerNode, renderNodeDom, splitNode } from '../core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx, SplitOutcome } from '../core/behavior.ts'
import type { ContainerNode, Margins } from '../core/nodes.ts'
import { styledDiv } from '../render/shadow-dom.ts'
import { applyLineStyle, pxToPt, resetLineStyle, resolvePdfColor, toPdfRect } from '../render/pdf-render.ts'

type Rendered = Extract<RenderedNode, { type: 'container' }>

function resolvePadding(padding: number | Margins | undefined): Margins {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding }
  return padding
}

// The width this container would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing, mirroring imageNaturalWidth/chartNaturalWidth
// exactly (no aspectRatio concept here, so it's simpler).
export function containerNaturalWidth(node: ContainerNode, availableWidth: number): number {
  return node.width ?? availableWidth
}

function measureHeight(node: ContainerNode, width: number): number {
  const pad = resolvePadding(node.padding)
  const childWidth = Math.max(0, width - pad.left - pad.right)
  const childHeight = measureNodeHeight(node.child, childWidth)
  return Math.max(node.height ?? 0, childHeight + pad.top + pad.bottom)
}

function layout(node: ContainerNode, width: number): Rendered {
  const pad = resolvePadding(node.padding)
  const childWidth = Math.max(0, width - pad.left - pad.right)
  const rawChild = layoutNodeFull(node.child, childWidth)
  const boxHeight = Math.max(node.height ?? 0, rawChild.box.height + pad.top + pad.bottom)
  const child = translateRendered(rawChild, pad.left, pad.top)
  return { type: 'container', box: { x: 0, y: 0, width, height: boxHeight }, node, child }
}

function split(node: ContainerNode, width: number, availableHeight: number): SplitOutcome<ContainerNode> {
  if (!isSplittable(node.child)) return null
  const pad = resolvePadding(node.padding)
  const childWidth = Math.max(0, width - pad.left - pad.right)
  const childAvailable = availableHeight - pad.top - pad.bottom
  if (childAvailable <= 0) return null
  const childSplit = splitNode(node.child, childWidth, childAvailable)
  if (childSplit === null) return null
  const child = translateRendered(childSplit.rendered, pad.left, pad.top)
  const consumedHeight = pad.top + childSplit.consumedHeight + pad.bottom
  // `height` is a MINIMUM only, deliberately NOT re-applied here: enforcing it on a fragment that
  // continues onto the next page would inflate consumedHeight past what the child actually used,
  // corrupting the caller's page-cursor bookkeeping. If `rest` later fits fully on its own (no
  // further split needed), the ordinary layout() path above re-applies the minimum naturally on
  // that final fragment.
  const rest: ContainerNode | null = childSplit.rest === null ? null : { ...node, child: childSplit.rest }
  return {
    rendered: { type: 'container', box: { x: 0, y: 0, width, height: consumedHeight }, node, child },
    consumedHeight,
    rest,
  }
}

function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const node = rendered.node
  const style: Partial<CSSStyleDeclaration> = {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
  }
  if (node.background !== undefined) style.background = node.background
  if (node.border !== undefined) style.border = `${node.border.thickness ?? 1}px ${node.border.style ?? 'solid'} ${node.border.color ?? '#000000'}`
  const needsClip = node.borderRadius !== undefined && node.borderRadius > 0
  if (node.borderRadius !== undefined) style.borderRadius = `${node.borderRadius}px`
  // A rounded box whose child fills it edge-to-edge (its own background, or an unrounded image)
  // would otherwise show square corners poking past the curve — `overflow: hidden` here clips the
  // child's real painted content to match, not just the decorative background/border shape.
  if (needsClip) style.overflow = 'hidden'
  const el = styledDiv(style)
  ctx.container.appendChild(el)
  if (needsClip) {
    // Deliberate, narrow exception to "DOM rendering is flat" (GUIDE.md invariant #4): the child
    // becomes a REAL descendant of `el` so `overflow: hidden` actually clips it, same technique
    // `renderPreview()` already uses (rebase origin to the wrapper's own top-left instead of the
    // page's). Safe because hit-testing/interactions resolve purely from RenderedNode geometry
    // data, never real DOM parent/child relationships (see attach-interactions.ts).
    //
    // `el` keeps `box-sizing: border-box`, so its CSS `border` (set above, when present) eats into
    // its own box instead of sitting outside it — meaning an absolutely positioned REAL child of
    // `el` is anchored to `el`'s padding edge, which is already inset by the border's thickness.
    // Border is supposed to be pure paint per this module's header comment (never consuming layout
    // space, unlike the sibling-of-`el` non-clip branch below, where the child is positioned purely
    // from absolute page coordinates and never touches `el`'s box model at all) — so that inset is
    // subtracted back out here to keep the child's position identical whether or not this container
    // happens to also have a borderRadius.
    const borderPx = node.border !== undefined ? node.border.thickness ?? 1 : 0
    renderNodeDom(rendered.child, ctx.originX - x - borderPx, ctx.originY - y - borderPx, { container: el, unselectable: ctx.unselectable })
    return
  }
  // Same convention as group/table: rendered.child.box is already resolved relative to this SAME
  // (originX, originY), not to the container's own box (translateRendered's container branch
  // shifts both by the same delta) — so recursion reuses the UNCHANGED origin, not (x, y).
  renderNodeDom(rendered.child, ctx.originX, ctx.originY, ctx)
}

async function drawPdf(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): Promise<void> {
  const node = rendered.node
  const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height)
  // Clamped against the box's own half-width/half-height (chart-geometry.ts's roundedRectPath()
  // clamps the same way) — an oversized radius degrades to a stadium shape instead of a malformed
  // pdfkit path.
  const radiusPt = node.borderRadius !== undefined ? pxToPt(Math.max(0, Math.min(node.borderRadius, rendered.box.width / 2, rendered.box.height / 2))) : 0
  const doc = ctx.pdf.doc

  if (node.background !== undefined) {
    doc.roundedRect(rect.x, rect.y, rect.width, rect.height, radiusPt).fill(resolvePdfColor(node.background))
  }
  if (node.border !== undefined) {
    const thicknessPt = pxToPt(node.border.thickness ?? 1)
    applyLineStyle(doc, node.border.style, thicknessPt)
    doc.roundedRect(rect.x, rect.y, rect.width, rect.height, radiusPt).lineWidth(thicknessPt).stroke(resolvePdfColor(node.border.color ?? '#000000'))
    resetLineStyle(doc)
  }
  // Same clip-region technique image.ts already uses for ImageNode.borderRadius (save/clip/
  // restore around just the child draw) — pdfkit clip regions are pure graphics-state, unaffected
  // by coordinate math, so no origin adjustment is needed here (unlike the DOM branch above).
  const needsClip = node.borderRadius !== undefined && node.borderRadius > 0
  if (needsClip) {
    doc.save()
    doc.roundedRect(rect.x, rect.y, rect.width, rect.height, radiusPt).clip()
  }
  // Same origin convention as group/table (NOT the chart module's own-origin exception) — see
  // shadow-dom.ts's renderContainerNode-era rationale, preserved here.
  await drawPdfNode(rendered.child, ctx.originX, ctx.originY, ctx.pdf)
  if (needsClip) doc.restore()
}

registerNode('container', {
  measureHeight,
  isSplittable: node => isSplittable(node.child),
  split,
  layout,
  naturalWidth: containerNaturalWidth,
  renderDom,
  drawPdf,
})
