// PDF drawing for the 'treemap' chart kind — split out of pdf.ts (see that file's header comment).
// Mirrors src/render/chart-render-treemap.ts field-for-field on the SVG side.

import type { TreemapChartNode } from '../../core/nodes.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { resolvePdfColor } from '../../render/pdf-render.ts'
import { CHART_FONT_FAMILY, MARK_SURFACE_GAP, SURFACE_COLOR, barPath, estimateChartTextWidth, normalizeChartText, resolveColor, squarifyTreemap } from '../../render/chart-geometry.ts'
import type { ChartBox } from '../../render/chart-geometry.ts'
import { drawChartPath, drawChartText } from './pdf.ts'

export function drawTreemapChart(ctx: PdfRenderCtx, node: TreemapChartNode, plot: ChartBox, originX: number, originY: number): void {
  const items = node.items
  const colors = items.map((item, i) => resolvePdfColor(resolveColor(item.color, node.colors, i)))
  const itemGap = node.itemGap ?? MARK_SURFACE_GAP
  const labelFontSize = node.labelFontSize ?? 12
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const rects = squarifyTreemap(items, plot)
  const labelColor = resolvePdfColor(SURFACE_COLOR)

  items.forEach((item, i) => {
    const r = rects[i]!
    const x = r.x + itemGap / 2
    const y = r.y + itemGap / 2
    const width = Math.max(0, r.width - itemGap)
    const height = Math.max(0, r.height - itemGap)
    if (width <= 0 || height <= 0) return

    drawChartPath(ctx, barPath(x, y, width, height, 'none'), colors[i]!, originX, originY)

    // Fit-check against the general ChartText line-splitting mechanism — see
    // chart-render-treemap.ts's renderTreemapChart for the full rationale; drawChartText() itself
    // now handles the actual multi-run/multi-line drawing in one call.
    const label = node.formatLabel?.(item) ?? item.label
    const lines = normalizeChartText(label, { fontSize: labelFontSize, color: '' })
    const hasContent = lines.some(line => line.length > 0)
    const lineHeight = Math.round(labelFontSize * 1.2)
    const totalHeight = lines.length * lineHeight
    const widestLineWidth = estimateChartTextWidth(label, labelFontSize)
    if (hasContent && widestLineWidth + 8 <= width && totalHeight + 6 <= height) {
      drawChartText(ctx, label, x + 4, y + labelFontSize + 2, { fontSize: labelFontSize, color: labelColor, anchor: 'start', bold: false, fontFamily }, originX, originY)
    }
  })
}
