// PDF drawing for the 'candlestick' chart kind — split out of pdf.ts (see that file's header
// comment). Mirrors src/render/chart-render-candlestick.ts field-for-field on the SVG side.

import type { CandlestickChartNode } from '../../core/nodes.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { resolvePdfColor } from '../../render/pdf-render.ts'
import {
  AXIS_COLOR,
  BAR_MAX_THICKNESS,
  CANDLESTICK_DOWN_COLOR,
  CANDLESTICK_UP_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  MARK_SURFACE_GAP,
  barPath,
  candlestickGeometry,
  estimateChartTextWidth,
  niceTickValues,
  resolveDomainFromExtent,
  textBaselineOffset,
} from '../../render/chart-geometry.ts'
import type { ChartBox } from '../../render/chart-geometry.ts'
import { drawChartLine, drawChartPath, drawChartText } from './pdf.ts'

export function drawCandlestickChart(ctx: PdfRenderCtx, node: CandlestickChartNode, plot: ChartBox, originX: number, originY: number): void {
  const categories = node.categories
  const series = node.series
  const allValues = series.flatMap(s => s.data.flatMap(c => [c.high, c.low]))
  const { dataMin, dataMax } = resolveDomainFromExtent(Math.min(...allValues), Math.max(...allValues), node.view ?? { domain: 'auto' })

  const axis = node.axis ?? {}
  const axisShow = axis.show !== false
  const gridlinesShow = axisShow && axis.gridlines !== false
  const tickCount = axis.tickCount ?? 5
  const formatTick = axis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const ticks = niceTickValues(dataMin, dataMax, tickCount)
  const tickFontSize = axis.tickFontSize ?? 11
  const categoryFontSize = axis.categoryFontSize ?? 11
  const tickBaselineOffset = textBaselineOffset(tickFontSize)
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const axisColor = resolvePdfColor(axis.color ?? AXIS_COLOR)
  const gridlineColor = resolvePdfColor(axis.gridlineColor ?? GRIDLINE_COLOR)
  const tickColor = resolvePdfColor(axis.tickColor ?? INK_MUTED)

  const categoryLabelOffset = categoryFontSize + 8
  const leftMargin = axisShow ? Math.max(30, Math.max(...ticks.map(t => estimateChartTextWidth(formatTick(t), tickFontSize))) + 20) : 4
  const bottomMargin = axisShow ? categoryLabelOffset + 6 : 4

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - 8
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const yScale = (value: number): number => plotBottom - ((value - dataMin) / (dataMax - dataMin)) * plotHeight

  if (gridlinesShow) {
    for (const tick of ticks) {
      const y = yScale(tick)
      drawChartLine(ctx, plotLeft, y, plotRight, y, gridlineColor, 1, originX, originY)
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const y = yScale(tick)
      drawChartText(ctx, formatTick(tick), plotLeft - 8, y + tickBaselineOffset, { fontSize: tickFontSize, color: tickColor, anchor: 'end', bold: false, fontFamily }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, axisColor, 1, originX, originY)
  }

  const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth
  const labelEstWidth = Math.max(...categories.map(c => estimateChartTextWidth(c, categoryFontSize)), 1)
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Number.POSITIVE_INFINITY
  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const x = plotLeft + bandWidth * (ci + 0.5)
      drawChartText(ctx, category, x, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, color: tickColor, anchor: 'middle', bold: false, fontFamily }, originX, originY)
    })
  }

  const rawWidth = (bandWidth - MARK_SURFACE_GAP * (series.length + 1)) / series.length
  const candleWidth = node.candleWidth ?? Math.max(1, Math.min(BAR_MAX_THICKNESS, rawWidth))
  const wickWidth = node.wickWidth ?? 1
  const groupWidth = candleWidth * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)

  categories.forEach((_, ci) => {
    const bandX = plotLeft + bandWidth * ci
    const groupStart = bandX + (bandWidth - groupWidth) / 2
    series.forEach((s, si) => {
      const candle = s.data[ci]!
      const centerX = groupStart + si * (candleWidth + MARK_SURFACE_GAP) + candleWidth / 2
      const geo = candlestickGeometry(candle, centerX, yScale, candleWidth)
      const color = resolvePdfColor(geo.isUp ? (s.upColor ?? node.upColor ?? CANDLESTICK_UP_COLOR) : (s.downColor ?? node.downColor ?? CANDLESTICK_DOWN_COLOR))
      drawChartLine(ctx, geo.wickX, geo.wickY1, geo.wickX, geo.wickY2, color, wickWidth, originX, originY)
      drawChartPath(ctx, barPath(geo.bodyX, geo.bodyY, geo.bodyWidth, geo.bodyHeight, 'none'), color, originX, originY)
    })
  })
}
