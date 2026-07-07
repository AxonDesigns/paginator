// SVG (on-screen) rendering for the 'scatter' chart kind — true continuous numeric x/y, with
// optional bubble sizing. Split out of chart-render.ts (see that file's header comment). Mirrored
// field-for-field by src/nodes/chart/pdf-scatter.ts on the PDF side.
//
// The FIRST chart kind in this codebase with two independent numeric axes (every categorical chart
// has exactly one numeric axis — the other is a category band) — so unlike renderCategoricalChart,
// this draws a full axis "frame" (both a left vertical baseline for y and a bottom horizontal
// baseline for x, each independently toggleable) rather than a single baseline on whichever edge
// carries the category axis.

import type { ScatterChartNode } from '../core/nodes.ts'
import {
  AXIS_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  MARKER_RADIUS,
  SURFACE_COLOR,
  estimateTextWidth,
  niceTickValues,
  resolveBubbleRadius,
  resolveColor,
  resolveDomainFromExtent,
  resolveMarkerRadii,
  textBaselineOffset,
} from './chart-geometry.ts'
import type { ChartBox } from './chart-geometry.ts'
import { svgEl, svgText } from './chart-render.ts'

export function renderScatterChart(svg: SVGSVGElement, node: ScatterChartNode, plot: ChartBox): void {
  const series = node.series
  const colors = series.map((s, i) => resolveColor(s.color, node.colors, i))

  const allX = series.flatMap(s => s.points.map(p => p.x))
  const allY = series.flatMap(s => s.points.map(p => p.y))
  // Default 'auto' (tight to data), NOT 'zero' — see ScatterChartNode.xView/yView's header comment.
  // A per-builder default, applied here rather than changing ChartViewConfig's own shared default.
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
  const xAxisColor = xAxis.color ?? AXIS_COLOR
  const yAxisColor = yAxis.color ?? AXIS_COLOR
  const xGridlineColor = xAxis.gridlineColor ?? GRIDLINE_COLOR
  const yGridlineColor = yAxis.gridlineColor ?? GRIDLINE_COLOR
  const xTickColor = xAxis.tickColor ?? INK_MUTED
  const yTickColor = yAxis.tickColor ?? INK_MUTED

  const leftMargin = yAxisShow ? Math.max(30, Math.max(...yTicks.map(t => estimateTextWidth(formatYTick(t), yTickFontSize))) + 20) : 4
  const bottomMargin = xAxisShow ? xTickFontSize + 20 : 4
  // Half the rightmost x-tick label's estimated width, so its CENTERED text doesn't clip the plot's
  // own right edge — categorical charts never needed this (their tick labels sit flush left of a
  // left-edge axis), but a numeric x-axis's ticks run all the way to the plot's own right edge.
  const rightPad = xAxisShow && xTicks.length > 0 ? estimateTextWidth(formatXTick(xTicks[xTicks.length - 1]!), xTickFontSize) / 2 + 4 : 8

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
      svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: y, y2: y, stroke: yGridlineColor, 'stroke-width': 1 }))
    }
  }
  if (xGridlinesShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: plotTop, y2: plotBottom, stroke: xGridlineColor, 'stroke-width': 1 }))
    }
  }
  if (yAxisShow) {
    for (const tick of yTicks) {
      const y = yScale(tick)
      svg.appendChild(svgText(formatYTick(tick), plotLeft - 8, y + yTickBaselineOffset, { fontSize: yTickFontSize, fontFamily, fill: yTickColor, 'text-anchor': 'end' }))
    }
    svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotLeft, y1: plotTop, y2: plotBottom, stroke: yAxisColor, 'stroke-width': 1 }))
  }
  if (xAxisShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      svg.appendChild(svgText(formatXTick(tick), x, plotBottom + xTickFontSize + 4, { fontSize: xTickFontSize, fontFamily, fill: xTickColor, 'text-anchor': 'middle' }))
    }
    svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: plotBottom, y2: plotBottom, stroke: xAxisColor, 'stroke-width': 1 }))
  }

  // Bubble sizing is an explicit opt-in (sizeScale's mere PRESENCE, even `{}`) — see
  // ScatterChartNode.sizeScale's header comment — so the size domain is only ever computed, and
  // only ever consulted per-point, when the caller actually asked for it.
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
      const fillColor = p.color ?? colors[si]!
      const cx = xScale(p.x)
      const cy = yScale(p.y)
      svg.appendChild(svgEl('circle', { cx, cy, r: ringRadius, fill: SURFACE_COLOR }))
      svg.appendChild(svgEl('circle', { cx, cy, r, fill: fillColor }))
    }
  })
}
