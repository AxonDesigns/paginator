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
import { applyLineStyle, pxToPt, resetLineStyle, resolvePdfColor, toPdfRect } from '../render/pdf-render.ts'

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

// `thickness+2*margin` reserved, but only the `thickness`-wide middle is painted (see
// insetLineRect above). Rendered via a zero-size, single-side `border` rather than a filled
// rectangle so `style: 'dashed'`/`'dotted'` fall out of the native CSS border-style keywords —
// box-sizing: border-box (BASE_ELEMENT_STYLE) means a 0-height/width box with only its
// top/left border set still paints exactly `thickness` px, flush with the box's own top-left
// corner, matching the old filled-rect's geometry exactly for the default 'solid' case.
function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const node = rendered.node
  const line = insetLineRect(rendered, x, y)
  const color = node.color ?? '#000000'
  const style = node.style ?? 'solid'
  const el = styledDiv(
    rendered.orientation === 'horizontal'
      ? {
          left: `${line.x}px`,
          top: `${line.y}px`,
          width: `${line.width}px`,
          height: '0',
          borderTopWidth: `${line.height}px`,
          borderTopStyle: style,
          borderTopColor: color,
        }
      : {
          left: `${line.x}px`,
          top: `${line.y}px`,
          width: '0',
          height: `${line.height}px`,
          borderLeftWidth: `${line.width}px`,
          borderLeftStyle: style,
          borderLeftColor: color,
        },
  )
  if (ctx.cursor !== undefined) el.style.cursor = ctx.cursor
  ctx.container.appendChild(el)
}

// pdfkit has no native border-style keyword, so 'dashed'/'dotted' are approximated by stroking the
// centerline with a dash pattern instead of filling the inset rect: a plain fill can't produce gaps.
// 'solid' still fills the rect directly (exact geometry, cheapest path, and the default/common case).
function drawPdf(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): void {
  const node = rendered.node
  const line = insetLineRect(rendered, x, y)
  const color = resolvePdfColor(node.color ?? '#000000')
  const style = node.style ?? 'solid'
  if (style === 'solid') {
    const rect = toPdfRect(line.x, line.y, line.width, line.height)
    ctx.pdf.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(color)
    return
  }
  const thicknessPt = pxToPt(rendered.orientation === 'horizontal' ? line.height : line.width)
  const start =
    rendered.orientation === 'horizontal'
      ? { x: pxToPt(line.x), y: pxToPt(line.y + line.height / 2) }
      : { x: pxToPt(line.x + line.width / 2), y: pxToPt(line.y) }
  const end =
    rendered.orientation === 'horizontal'
      ? { x: pxToPt(line.x + line.width), y: pxToPt(line.y + line.height / 2) }
      : { x: pxToPt(line.x + line.width / 2), y: pxToPt(line.y + line.height) }
  const doc = ctx.pdf.doc
  doc.lineWidth(thicknessPt)
  applyLineStyle(doc, style, thicknessPt)
  doc.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke(color)
  resetLineStyle(doc)
}

registerNode('separator', {
  measureHeight: node => separatorMainSize(node),
  // A separator always stretches to whatever width its column hands it (layoutColumn special-cases
  // `child.type === 'separator'` to the full resolved width, bypassing childCrossWidthInColumn
  // entirely — see that function's comment). So it has no width preference of its own to contribute
  // when an ANCESTOR is shrink-wrapping and asking "how wide do my children want to be" (the
  // `childCrossWidthInColumn`/`shrinkWrapWidth` max-reduce in group.ts): without this override, the
  // generic naturalWidth() fallback ("wants the full width offered") would make a lone separator
  // sibling force a `flex: 'shrink'` column to claim the entire available width instead of shrinking
  // to its actual content.
  naturalWidth: () => 0,
  isSplittable: () => false,
  layout,
  renderDom,
  drawPdf,
})
