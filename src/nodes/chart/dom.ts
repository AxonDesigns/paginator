import type { RenderedNode } from '../../core/geometry.ts'
import type { DomRenderCtx } from '../../core/behavior.ts'
import { BASE_ELEMENT_STYLE } from '../../render/reset.ts'
import { renderChartSvg } from '../../render/chart-render.ts'

type Rendered = Extract<RenderedNode, { type: 'chart' }>

export function renderChartNode(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const svg = renderChartSvg(rendered.node, rendered.box.width, rendered.box.height)
  Object.assign(svg.style, BASE_ELEMENT_STYLE, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    // SVG <text> (axis labels, legend, title) is natively selectable same as HTML text — without
    // this, a drag gesture starting on (or bubbling up through) a draggable chart can also select
    // its labels, exactly the problem text.ts's own `unselectable` threading solves for text nodes.
    ...(ctx.unselectable ? { userSelect: 'none' as const } : {}),
    ...(ctx.cursor !== undefined ? { cursor: ctx.cursor } : {}),
  })
  ctx.container.appendChild(svg)
}
