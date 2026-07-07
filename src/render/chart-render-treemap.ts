// SVG (on-screen) rendering for the 'treemap' chart kind — flat, single-level, squarified layout
// (see chart-geometry.ts's squarifyTreemap for the algorithm itself). Zero axis/domain machinery at
// all — no ticks, gridlines, or axis chrome; the whole plot box IS the treemap. Split out of
// chart-render.ts (see that file's header comment). Mirrored field-for-field by
// src/nodes/chart/pdf-treemap.ts on the PDF side.

import type { TreemapChartNode } from '../core/nodes.ts'
import { CHART_FONT_FAMILY, MARK_SURFACE_GAP, SURFACE_COLOR, estimateTextWidth, resolveColor, squarifyTreemap } from './chart-geometry.ts'
import type { ChartBox } from './chart-geometry.ts'
import { svgEl, svgText } from './chart-render.ts'

export function renderTreemapChart(svg: SVGSVGElement, node: TreemapChartNode, plot: ChartBox): void {
  const items = node.items
  const colors = items.map((item, i) => resolveColor(item.color, node.colors, i))
  const itemGap = node.itemGap ?? MARK_SURFACE_GAP
  const labelFontSize = node.labelFontSize ?? 12
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const rects = squarifyTreemap(items, plot)

  items.forEach((item, i) => {
    const r = rects[i]!
    // Every rectangle's OWN edges get inset by half the gap (see TreemapChartNode.itemGap's header
    // comment for why this differs from a stacked bar's flush-outer-edge exception).
    const x = r.x + itemGap / 2
    const y = r.y + itemGap / 2
    const width = Math.max(0, r.width - itemGap)
    const height = Math.max(0, r.height - itemGap)
    if (width <= 0 || height <= 0) return

    svg.appendChild(svgEl('rect', { x, y, width, height, fill: colors[i]! }))

    const labelWidth = estimateTextWidth(item.label, labelFontSize)
    if (labelWidth + 8 <= width && labelFontSize + 6 <= height) {
      // White label text on a colored fill — every other chart here only ever puts text on the
      // plain white plot surface, so this is a genuinely new situation; white reads acceptably
      // against this palette's mid-to-dark saturated swatches without a full contrast computation
      // this codebase has no other precedent for.
      svg.appendChild(svgText(item.label, x + 4, y + labelFontSize + 2, { fontSize: labelFontSize, fontFamily, fill: SURFACE_COLOR, 'text-anchor': 'start' }))
    }
  })
}
