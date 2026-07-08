// PDF drawing for the 'scatter' chart kind — split out of pdf.ts (see that file's header comment).
// Mirrors src/render/chart-render-scatter.ts field-for-field on the SVG side.

import type { ScatterChartNode } from '../../core/nodes.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { resolvePdfColor } from '../../render/pdf-render.ts'
import {
  AXIS_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  MARKER_RADIUS,
  SURFACE_COLOR,
  estimateChartTextWidth,
  niceTickValues,
  resolveBubbleRadius,
  resolveColor,
  resolveDomainFromExtent,
  resolveMarkerRadii,
  textBaselineOffset,
} from '../../render/chart-geometry.ts'
import type { ChartBox } from '../../render/chart-geometry.ts'
import { drawChartCircle, drawChartLine, drawChartText } from './pdf.ts'

export function drawScatterChart(ctx: PdfRenderCtx, node: ScatterChartNode, plot: ChartBox, originX: number, originY: number): void {
  const series = node.series
  const colors = series.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)))

  const allX = series.flatMap(s => s.points.map(p => p.x))
  const allY = series.flatMap(s => s.points.map(p => p.y))
  const { dataMin: xMin, dataMax: xMax } = resolveDomainFromExtent(Math.min(...allX), Math.max(...allX), node.xView ?? { domain: 'auto' })
  const { dataMin: yMin, dataMax: yMax } = resolveDomainFromExtent(Math.min(...allY), Math.max(...allY), node.yView ?? { domain: 'auto' })

  const xAxis = node.xAxis ?? {}
  const yAxis = node.yAxis ?? {}
  const xAxisShow = xAxis.show !== false
  const yAxisShow = yAxis.show !== false
  const xGridlinesShow = xAxisShow && xAxis.gridlines !== false
  const yGridlinesShow = yAxisShow && yAxis.gridlines !== false
  const formatXTick = xAxis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const formatYTick = yAxis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const xTicks = niceTickValues(xMin, xMax, xAxis.tickCount ?? 5)
  const yTicks = niceTickValues(yMin, yMax, yAxis.tickCount ?? 5)
  const xTickFontSize = xAxis.tickFontSize ?? 11
  const yTickFontSize = yAxis.tickFontSize ?? 11
  const yTickBaselineOffset = textBaselineOffset(yTickFontSize)
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const xAxisColor = resolvePdfColor(xAxis.color ?? AXIS_COLOR)
  const yAxisColor = resolvePdfColor(yAxis.color ?? AXIS_COLOR)
  const xGridlineColor = resolvePdfColor(xAxis.gridlineColor ?? GRIDLINE_COLOR)
  const yGridlineColor = resolvePdfColor(yAxis.gridlineColor ?? GRIDLINE_COLOR)
  const xTickColor = resolvePdfColor(xAxis.tickColor ?? INK_MUTED)
  const yTickColor = resolvePdfColor(yAxis.tickColor ?? INK_MUTED)

  const leftMargin = yAxisShow ? Math.max(30, Math.max(...yTicks.map(t => estimateChartTextWidth(formatYTick(t), yTickFontSize))) + 20) : 4
  const bottomMargin = xAxisShow ? xTickFontSize + 20 : 4
  const rightPad = xAxisShow && xTicks.length > 0 ? estimateChartTextWidth(formatXTick(xTicks[xTicks.length - 1]!), xTickFontSize) / 2 + 4 : 8

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - rightPad
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const xScale = (v: number): number => plotLeft + ((v - xMin) / (xMax - xMin)) * plotWidth
  const yScale = (v: number): number => plotBottom - ((v - yMin) / (yMax - yMin)) * plotHeight

  if (yGridlinesShow) {
    for (const tick of yTicks) {
      const y = yScale(tick)
      drawChartLine(ctx, plotLeft, y, plotRight, y, yGridlineColor, 1, originX, originY)
    }
  }
  if (xGridlinesShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      drawChartLine(ctx, x, plotTop, x, plotBottom, xGridlineColor, 1, originX, originY)
    }
  }
  if (yAxisShow) {
    for (const tick of yTicks) {
      const y = yScale(tick)
      drawChartText(ctx, formatYTick(tick), plotLeft - 8, y + yTickBaselineOffset, { fontSize: yTickFontSize, color: yTickColor, anchor: 'end', bold: false, fontFamily }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotTop, plotLeft, plotBottom, yAxisColor, 1, originX, originY)
  }
  if (xAxisShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      drawChartText(ctx, formatXTick(tick), x, plotBottom + xTickFontSize + 4, { fontSize: xTickFontSize, color: xTickColor, anchor: 'middle', bold: false, fontFamily }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, xAxisColor, 1, originX, originY)
  }

  const sizeScale = node.sizeScale
  const allSizes = sizeScale !== undefined ? series.flatMap(s => s.points.map(p => p.size).filter((v): v is number => v !== undefined)) : []
  const sizeMin = allSizes.length > 0 ? Math.min(...allSizes) : 0
  const sizeMax = allSizes.length > 0 ? Math.max(...allSizes) : 1
  const scaleType = sizeScale?.type ?? 'sqrt'
  const range = sizeScale?.range ?? [4, 24]

  series.forEach((s, si) => {
    for (const p of s.points) {
      const radius = sizeScale !== undefined && p.size !== undefined ? resolveBubbleRadius(p.size, sizeMin, sizeMax, scaleType, range) : (node.pointRadius ?? MARKER_RADIUS)
      const { radius: r, ringRadius } = resolveMarkerRadii(radius)
      const fillColor = p.color !== undefined ? resolvePdfColor(p.color) : colors[si]!
      const cx = xScale(p.x)
      const cy = yScale(p.y)
      drawChartCircle(ctx, cx, cy, ringRadius, resolvePdfColor(SURFACE_COLOR), originX, originY)
      drawChartCircle(ctx, cx, cy, r, fillColor, originX, originY)
    }
  })
}
