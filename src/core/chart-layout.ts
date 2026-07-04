// Chart sizing is pure arithmetic from declared width/height/aspectRatio, same as image-layout.ts
// and for the same reason: paginate() must stay synchronous, so nothing here can depend on
// measuring rendered SVG text (axis tick labels, legend entries, etc.) — that measurement-dependent
// layout happens later, in chart-render.ts, using fixed heuristic margins instead.

import type { NodeMeasurer } from './behavior.ts'
import type { ChartNode } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'

// chart()'s constructor already guarantees at least one of height/aspectRatio is present, so the
// fallback branch here is unreachable in practice — kept as a defensive error rather than a silent
// NaN if a node is ever hand-built bypassing the chart() builder.
function resolveHeight(node: ChartNode, width: number): number {
  if (node.height !== undefined) return node.height
  if (node.aspectRatio !== undefined) return width / node.aspectRatio
  throw new Error('[paginator] chart node has neither "height" nor "aspectRatio" — use the chart() builder, which validates this upfront.')
}

// The width this chart would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing (childCrossWidthInColumn), mirroring imageNaturalWidth.
export function chartNaturalWidth(node: ChartNode, availableWidth: number): number {
  if (node.width !== undefined) return node.width
  if (node.height !== undefined && node.aspectRatio !== undefined) return node.height * node.aspectRatio
  return availableWidth
}

export const chartMeasurer: NodeMeasurer<ChartNode> = {
  splittable: false,

  measureHeight(node, width) {
    return resolveHeight(node, width)
  },

  layout(node, width): RenderedNode {
    return { type: 'chart', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node }
  },
}
