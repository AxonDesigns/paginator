// SeparatorNode is a trivial atomic leaf. Its registered entry models the canonical "horizontal rule
// as a column child" orientation: reserved main-axis (height) size is thickness + 2*margin, spanning
// the full width handed to it. When a separator is used as a ROW child (vertical divider), the
// row-specific stretch-to-full-row-height behavior is assembled directly by group.ts, which already
// knows the row's final height only after laying out every child — a separator always renders as a
// line perpendicular to its parent's main axis, spanning the parent's cross axis fully, using
// `thickness + 2*margin` along the main axis. That row-specific box is pre-resolved by group.ts
// itself rather than by this file's own `layout()` — see group.ts's layoutResolvedChild.

import type { RenderedNode } from '../core/geometry.ts'
import { registerNode } from '../core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx } from '../core/behavior.ts'
import type { SeparatorNode } from '../core/nodes.ts'
import { styledDiv } from '../render/shadow-dom.ts'
import { resolvePdfColor, toPdfRect } from '../render/pdf-render.ts'

type Rendered = Extract<RenderedNode, { type: 'separator' }>

export function separatorMainSize(node: SeparatorNode): number {
  return (node.thickness ?? 1) + 2 * (node.margin ?? 0)
}

function layout(node: SeparatorNode, width: number): Rendered {
  return { type: 'separator', box: { x: 0, y: 0, width, height: separatorMainSize(node) }, node, orientation: 'horizontal' }
}

// The reserved box spans `thickness + 2*margin` along the main axis (see separatorMainSize) but only
// the `thickness`-wide middle should be painted — `margin` is blank space, not part of the line.
function insetLineRect(rendered: Rendered, x: number, y: number): { x: number; y: number; width: number; height: number } {
  const margin = rendered.node.margin ?? 0
  const { box, orientation } = rendered
  if (orientation === 'horizontal') return { x, y: y + margin, width: box.width, height: box.height - 2 * margin }
  return { x: x + margin, y, width: box.width - 2 * margin, height: box.height }
}

function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const node = rendered.node
  const line = insetLineRect(rendered, x, y)
  const el = styledDiv({
    left: `${line.x}px`,
    top: `${line.y}px`,
    width: `${line.width}px`,
    height: `${line.height}px`,
    background: node.color ?? '#000000',
  })
  ctx.container.appendChild(el)
}

function drawPdf(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): void {
  const node = rendered.node
  const line = insetLineRect(rendered, x, y)
  const rect = toPdfRect(line.x, line.y, line.width, line.height)
  ctx.pdf.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(node.color ?? '#000000'))
}

registerNode('separator', {
  measureHeight: node => separatorMainSize(node),
  isSplittable: () => false,
  layout,
  renderDom,
  drawPdf,
})
