// SVG (on-screen) rendering for the 'candlestick' chart kind — OHLC bars over the same categorical
// x-axis/category-band layout a categorical chart's vertical orientation uses (time/category along
// x, price along y). Candlestick has no horizontal-orientation counterpart — real-world candlestick
// charts are always drawn this one way, so unlike CategoricalChartNode there's no `orientation`
// field to branch on here. Split out of chart-render.ts (see that file's header comment). Mirrored
// field-for-field by src/nodes/chart/pdf-candlestick.ts on the PDF side.

import type { CandlestickChartNode } from '../core/nodes.ts'
import {
  AXIS_COLOR,
  BAR_MAX_THICKNESS,
  CANDLESTICK_DOWN_COLOR,
  CANDLESTICK_UP_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  MARK_SURFACE_GAP,
  candlestickGeometry,
  estimateTextWidth,
  niceTickValues,
  resolveDomainFromExtent,
  textBaselineOffset,
} from './chart-geometry.ts'
import type { ChartBox } from './chart-geometry.ts'
import { svgEl, svgText } from './chart-render.ts'

export function renderCandlestickChart(svg: SVGSVGElement, node: CandlestickChartNode, plot: ChartBox): void {
  const categories = node.categories
  const series = node.series
  const allValues = series.flatMap(s => s.data.flatMap(c => [c.high, c.low]))
  // Default 'auto', not 'zero' — see CandlestickChartNode.view's header comment.
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
  const axisColor = axis.color ?? AXIS_COLOR
  const gridlineColor = axis.gridlineColor ?? GRIDLINE_COLOR
  const tickColor = axis.tickColor ?? INK_MUTED

  const categoryLabelOffset = categoryFontSize + 8
  const leftMargin = axisShow ? Math.max(30, Math.max(...ticks.map(t => estimateTextWidth(formatTick(t), tickFontSize))) + 20) : 4
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
      svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: y, y2: y, stroke: gridlineColor, 'stroke-width': 1 }))
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const y = yScale(tick)
      svg.appendChild(svgText(formatTick(tick), plotLeft - 8, y + tickBaselineOffset, { fontSize: tickFontSize, fontFamily, fill: tickColor, 'text-anchor': 'end' }))
    }
    svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: plotBottom, y2: plotBottom, stroke: axisColor, 'stroke-width': 1 }))
  }

  const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth
  const labelEstWidth = Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize)), 1)
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Infinity
  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const x = plotLeft + bandWidth * (ci + 0.5)
      svg.appendChild(svgText(category, x, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, fontFamily, fill: tickColor, 'text-anchor': 'middle' }))
    })
  }

  // Same grouped-band sub-slot math a grouped bar chart uses for its per-series bars — a single
  // series's candle is exactly a "group of 1," so this degenerates to a plain centered candle per
  // band with no extra casing needed.
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
      const color = geo.isUp ? (s.upColor ?? node.upColor ?? CANDLESTICK_UP_COLOR) : (s.downColor ?? node.downColor ?? CANDLESTICK_DOWN_COLOR)
      svg.appendChild(svgEl('line', { x1: geo.wickX, x2: geo.wickX, y1: geo.wickY1, y2: geo.wickY2, stroke: color, 'stroke-width': wickWidth }))
      svg.appendChild(svgEl('rect', { x: geo.bodyX, y: geo.bodyY, width: geo.bodyWidth, height: geo.bodyHeight, fill: color }))
    })
  })
}
