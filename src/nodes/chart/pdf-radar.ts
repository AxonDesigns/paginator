// PDF drawing for the 'radar'/spider chart kind — split out of pdf.ts (see that file's header
// comment). Mirrors src/render/chart-render-radar.ts field-for-field on the SVG side.

import type { RadarChartNode } from '../../core/nodes.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { resolvePdfColor } from '../../render/pdf-render.ts'
import {
  AXIS_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  LINE_STROKE_WIDTH,
  MARKER_RADIUS,
  SURFACE_COLOR,
  niceTickValues,
  polygonPath,
  radarPolygonPoints,
  radarSpokeAngle,
  resolveChartDomain,
  resolveColor,
  resolveLineFill,
  resolveMarkerRadii,
  textBaselineOffset,
} from '../../render/chart-geometry.ts'
import type { ChartBox } from '../../render/chart-geometry.ts'
import { drawChartCircle, drawChartLine, drawChartPath, drawChartPathStroke, drawChartText } from './pdf.ts'

export function drawRadarChart(ctx: PdfRenderCtx, node: RadarChartNode, plot: ChartBox, originX: number, originY: number): void {
  const categories = node.categories
  const series = node.series
  const colors = series.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)))
  const spokeCount = categories.length

  const { dataMin, dataMax } = resolveChartDomain(categories, series, false, node.view ?? {})

  const axis = node.axis ?? {}
  const axisShow = axis.show !== false
  const gridlinesShow = axisShow && axis.gridlines !== false
  const tickFontSize = axis.tickFontSize ?? 11
  const categoryFontSize = axis.categoryFontSize ?? 11
  const formatTick = axis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const gridlineColor = resolvePdfColor(axis.gridlineColor ?? GRIDLINE_COLOR)
  const axisColor = resolvePdfColor(axis.color ?? AXIS_COLOR)
  const tickColor = resolvePdfColor(axis.tickColor ?? INK_MUTED)
  const ticks = niceTickValues(dataMin, dataMax, axis.tickCount ?? 5)

  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const labelMargin = axisShow ? 28 : 8
  const outerRadius = Math.max(0, Math.min(plot.width, plot.height) / 2 - labelMargin)

  if (gridlinesShow) {
    for (const tick of ticks) {
      const r = Math.max(0, ((tick - dataMin) / (dataMax - dataMin || 1)) * outerRadius)
      // A circle drawn as a two-arc closed path (pdfkit has a native .circle(), but every other
      // mark in this chart goes through drawChartPath's shared origin/scale content-matrix — a
      // stroked, unfilled path keeps this one consistent with them rather than a one-off call).
      drawChartCirclePath(ctx, cx, cy, r, gridlineColor, originX, originY)
    }
    for (let i = 0; i < spokeCount; i++) {
      const angle = (radarSpokeAngle(i, spokeCount) * Math.PI) / 180
      drawChartLine(ctx, cx, cy, cx + outerRadius * Math.cos(angle), cy + outerRadius * Math.sin(angle), axisColor, 1, originX, originY)
    }
  }

  if (axisShow) {
    const tickBaselineOffset = textBaselineOffset(tickFontSize)
    for (const tick of ticks) {
      const r = Math.max(0, ((tick - dataMin) / (dataMax - dataMin || 1)) * outerRadius)
      drawChartText(ctx, formatTick(tick), cx + 4, cy - r + tickBaselineOffset, { fontSize: tickFontSize, color: tickColor, anchor: 'start', bold: false, fontFamily }, originX, originY)
    }
    const categoryBaselineOffset = textBaselineOffset(categoryFontSize)
    categories.forEach((category, i) => {
      const angleDeg = radarSpokeAngle(i, spokeCount)
      const angle = (angleDeg * Math.PI) / 180
      const cosA = Math.cos(angle)
      const anchor = cosA > 0.3 ? 'start' : cosA < -0.3 ? 'end' : 'middle'
      const labelR = outerRadius + 10
      drawChartText(
        ctx,
        category,
        cx + labelR * cosA,
        cy + labelR * Math.sin(angle) + categoryBaselineOffset,
        { fontSize: categoryFontSize, color: tickColor, anchor, bold: false, fontFamily },
        originX,
        originY,
      )
    })
  }

  const lineStrokeWidth = node.lineStrokeWidth ?? LINE_STROKE_WIDTH
  const markerRadius = node.markerRadius ?? MARKER_RADIUS

  series.forEach((s, si) => {
    const points = radarPolygonPoints(cx, cy, s.data, dataMin, dataMax, outerRadius)
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      drawChartPath(ctx, polygonPath(points), resolvePdfColor(fill.color), originX, originY, fill.opacity)
    }
    drawChartPathStroke(ctx, polygonPath(points), colors[si]!, lineStrokeWidth, originX, originY)
    if (markerRadius > 0) {
      const { radius: r, ringRadius } = resolveMarkerRadii(markerRadius)
      for (const [px, py] of points) {
        drawChartCircle(ctx, px, py, ringRadius, resolvePdfColor(SURFACE_COLOR), originX, originY)
        drawChartCircle(ctx, px, py, r, colors[si]!, originX, originY)
      }
    }
  })
}

// A stroked-only circle via the same local-chart-px path convention every other primitive here
// uses (two semicircular arcs, matching donutSlicePath's own arc-command style) — kept local to
// this file since nothing else needs an unfilled circle outline.
function drawChartCirclePath(ctx: PdfRenderCtx, cx: number, cy: number, r: number, color: string, originX: number, originY: number): void {
  if (r <= 0) return
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
  drawChartPathStroke(ctx, d, color, 1, originX, originY)
}
