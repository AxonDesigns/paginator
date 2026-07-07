// PDF drawing for the 'gantt' chart kind — split out of pdf.ts (see that file's header comment).
// Mirrors src/render/chart-render-gantt.ts field-for-field on the SVG side.

import type { GanttChartNode } from '../../core/nodes.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { resolvePdfColor } from '../../render/pdf-render.ts'
import {
  AXIS_COLOR,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  barPath,
  estimateTextWidth,
  niceTickValues,
  resolveColor,
  resolveDomainFromExtent,
  resolveGanttGroupStyle,
  resolveGanttRows,
  resolveGanttTaskLabelColor,
  roundedRectPath,
  textBaselineOffset,
} from '../../render/chart-geometry.ts'
import type { ChartBox } from '../../render/chart-geometry.ts'
import { drawChartLine, drawChartPath, drawChartText } from './pdf.ts'

const ROW_FONT_SIZE = 11

export function drawGanttChart(ctx: PdfRenderCtx, node: GanttChartNode, plot: ChartBox, originX: number, originY: number): void {
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
  const { dataMin: xMin, dataMax: xMax } = resolveDomainFromExtent(Math.min(...allStarts), Math.max(...allEnds), node.xView ?? { domain: 'auto' })
  const xTicks = niceTickValues(xMin, xMax, xAxis.tickCount ?? 5)
  const xTickFontSize = xAxis.tickFontSize ?? 11
  const xAxisColor = resolvePdfColor(xAxis.color ?? AXIS_COLOR)
  const xGridlineColor = resolvePdfColor(xAxis.gridlineColor ?? GRIDLINE_COLOR)
  const xTickColor = resolvePdfColor(xAxis.tickColor ?? INK_MUTED)

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
  const rowHeight = node.rowHeight ?? (rows.length > 0 ? plotHeight / rows.length : plotHeight)
  const gridBottom = plotTop + rows.length * rowHeight

  if (xGridlinesShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      drawChartLine(ctx, x, plotTop, x, gridBottom, xGridlineColor, 1, originX, originY)
    }
  }
  if (xAxisShow) {
    for (const tick of xTicks) {
      const x = xScale(tick)
      drawChartText(ctx, formatXTick(tick), x, gridBottom + xTickFontSize + 4, { fontSize: xTickFontSize, color: xTickColor, anchor: 'middle', bold: false, fontFamily }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, gridBottom, plotRight, gridBottom, xAxisColor, 1, originX, originY)
  }

  let taskIndex = 0
  rows.forEach((row, ri) => {
    const rowTop = plotTop + ri * rowHeight
    const rowCenterY = rowTop + rowHeight / 2

    if (row.kind === 'header') {
      const { color: headerColor, background: headerBackground } = resolveGanttGroupStyle(node, row.label)
      // Reuses barPath's plain-rect 'none' mode rather than a bespoke pdfkit .rect() call, so this
      // stays in the same local-chart-px space every other draw primitive here already uses.
      drawChartPath(ctx, barPath(plot.x, rowTop, plot.width, rowHeight, 'none'), resolvePdfColor(headerBackground), originX, originY)
      drawChartText(ctx, row.label, plot.x + 8, rowCenterY + rowBaselineOffset, { fontSize: ROW_FONT_SIZE, color: resolvePdfColor(headerColor), anchor: 'start', bold: true, fontFamily }, originX, originY)
      return
    }

    const task = row.task
    const color = resolvePdfColor(resolveColor(task.color, node.colors, taskIndex))
    taskIndex++
    drawChartText(
      ctx,
      task.label,
      plotLeft - 8,
      rowCenterY + rowBaselineOffset,
      { fontSize: ROW_FONT_SIZE, color: resolvePdfColor(resolveGanttTaskLabelColor(node, task)), anchor: 'end', bold: false, fontFamily },
      originX,
      originY,
    )
    const barHeight = Math.max(4, rowHeight - 10)
    const barY = rowCenterY - barHeight / 2
    const barX = xScale(task.start)
    const barW = Math.max(2, xScale(task.end) - barX)
    drawChartPath(ctx, roundedRectPath(barX, barY, barW, barHeight, barHeight / 2), color, originX, originY)
  })
}
