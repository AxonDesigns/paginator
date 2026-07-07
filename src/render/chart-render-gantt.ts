// SVG (on-screen) rendering for the 'gantt' chart kind — task/timeline bars over a single numeric
// x-axis (time), one row per task, with optional contiguous-run group header bands. Split out of
// chart-render.ts (see that file's header comment). Mirrored field-for-field by
// src/nodes/chart/pdf-gantt.ts on the PDF side.

import type { GanttChartNode } from '../core/nodes.ts'
import {
  AXIS_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  estimateTextWidth,
  niceTickValues,
  resolveColor,
  resolveDomainFromExtent,
  resolveGanttGroupStyle,
  resolveGanttRows,
  resolveGanttTaskLabelColor,
  roundedRectPath,
  textBaselineOffset,
} from './chart-geometry.ts'
import type { ChartBox } from './chart-geometry.ts'
import { svgEl, svgText } from './chart-render.ts'

const ROW_FONT_SIZE = 11

export function renderGanttChart(svg: SVGSVGElement, node: GanttChartNode, plot: ChartBox): void {
  const showGroupHeaders = node.showGroupHeaders ?? node.tasks.some(t => t.group !== undefined)
  const rows = resolveGanttRows(node.tasks, showGroupHeaders)
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const rowBaselineOffset = textBaselineOffset(ROW_FONT_SIZE)

  const xAxis = node.xAxis ?? {}
  const xAxisShow = xAxis.show !== false
  const xGridlinesShow = xAxisShow && xAxis.gridlines !== false
  const formatXTick = xAxis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const allStarts = node.tasks.map(t => t.start)
  const allEnds = node.tasks.map(t => t.end)
  // Default 'auto', not 'zero' — see GanttChartNode.xView's header comment.
  const { dataMin: xMin, dataMax: xMax } = resolveDomainFromExtent(Math.min(...allStarts), Math.max(...allEnds), node.xView ?? { domain: 'auto' })
  const xTicks = niceTickValues(xMin, xMax, xAxis.tickCount ?? 5)
  const xTickFontSize = xAxis.tickFontSize ?? 11
  const xAxisColor = xAxis.color ?? AXIS_COLOR
  const xGridlineColor = xAxis.gridlineColor ?? GRIDLINE_COLOR
  const xTickColor = xAxis.tickColor ?? INK_MUTED

  const leftMargin = Math.max(30, Math.max(...node.tasks.map(t => estimateTextWidth(t.label, ROW_FONT_SIZE))) + 16)
  const bottomMargin = xAxisShow ? xTickFontSize + 20 : 4
  const rightPad = xAxisShow && xTicks.length > 0 ? estimateTextWidth(formatXTick(xTicks[xTicks.length - 1]!), xTickFontSize) / 2 + 4 : 8

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - rightPad
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const xScale = (v: number): number => plotLeft + ((v - xMin) / (xMax - xMin)) * plotWidth
  // Explicit rowHeight is used exactly as given (may overflow the box); omitted divides the
  // available plot height evenly across every row — see GanttChartNode.rowHeight's header comment.
  const rowHeight = node.rowHeight ?? (rows.length > 0 ? plotHeight / rows.length : plotHeight)
  const gridBottom = plotTop + rows.length * rowHeight

  if (xGridlinesShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: plotTop, y2: gridBottom, stroke: xGridlineColor, 'stroke-width': 1 }))
    }
  }
  if (xAxisShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      svg.appendChild(svgText(formatXTick(tick), x, gridBottom + xTickFontSize + 4, { fontSize: xTickFontSize, fontFamily, fill: xTickColor, 'text-anchor': 'middle' }))
    }
    svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: gridBottom, y2: gridBottom, stroke: xAxisColor, 'stroke-width': 1 }))
  }

  let taskIndex = 0
  rows.forEach((row, ri) => {
    const rowTop = plotTop + ri * rowHeight
    const rowCenterY = rowTop + rowHeight / 2

    if (row.kind === 'header') {
      const { color: headerColor, background: headerBackground } = resolveGanttGroupStyle(node, row.label)
      svg.appendChild(svgEl('rect', { x: plot.x, y: rowTop, width: plot.width, height: rowHeight, fill: headerBackground }))
      svg.appendChild(
        svgText(row.label, plot.x + 8, rowCenterY + rowBaselineOffset, { fontSize: ROW_FONT_SIZE, fontFamily, fill: headerColor, 'font-weight': 700, 'text-anchor': 'start' }),
      )
      return
    }

    const task = row.task
    const color = resolveColor(task.color, node.colors, taskIndex)
    taskIndex++
    svg.appendChild(
      svgText(task.label, plotLeft - 8, rowCenterY + rowBaselineOffset, { fontSize: ROW_FONT_SIZE, fontFamily, fill: resolveGanttTaskLabelColor(node, task), 'text-anchor': 'end' }),
    )
    const barHeight = Math.max(4, rowHeight - 10)
    const barY = rowCenterY - barHeight / 2
    const barX = xScale(task.start)
    const barW = Math.max(2, xScale(task.end) - barX)
    svg.appendChild(svgEl('path', { d: roundedRectPath(barX, barY, barW, barHeight, barHeight / 2), fill: color }))
  })
}
