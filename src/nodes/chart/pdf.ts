// PDF drawing for ChartNode — port of chart-render.ts, reusing its pure geometry/color/text-estimate
// helpers unchanged, only the final SVG-element-append calls become pdfkit draw calls. Chart text
// deliberately never goes through the font registry the same way TextNode does: chart-render.ts
// already documents using a fixed heuristic text-width estimate rather than real measurement, so it
// never claimed font-exact fidelity to the document's own registered fonts — using the shared
// Helvetica fallback names here is free.

import type { RenderedNode } from '../../core/geometry.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import type { CategoricalChartNode, ChartSeries, RadialChartNode } from '../../core/nodes.ts'
import { PX_TO_PT, pxToPt, resolvePdfColor } from '../../render/pdf-render.ts'
import { resolveChartFontName } from '../../render/pdf-fonts.ts'
import {
  AXIS_COLOR,
  BAR_CORNER_RADIUS,
  BAR_MAX_THICKNESS,
  CHART_FONT_FAMILY,
  GRIDLINE_COLOR,
  INK_MUTED,
  INK_SECONDARY,
  LINE_STROKE_WIDTH,
  MARK_SURFACE_GAP,
  SURFACE_COLOR,
  areaFillGradientVector,
  areaPath,
  barPath,
  donutSlicePath,
  estimateTextWidth,
  legendEntriesFor,
  linePath,
  niceTickValues,
  pieSlicePath,
  resolveChartDomain,
  resolveColor,
  resolveLineFill,
  resolveMarkerRadii,
  resolveShowLegend,
  resolveTitle,
  stackedBarSegments,
  stackedSegmentPixelRange,
  textBaselineOffset,
  truncateToWidth,
} from '../../render/chart-render.ts'
import type { ChartBox, LegendEntry } from '../../render/chart-render.ts'

type Rendered = Extract<RenderedNode, { type: 'chart' }>

function chartToPagePoint(originX: number, originY: number, localX: number, localY: number): { x: number; y: number } {
  return { x: pxToPt(originX + localX), y: pxToPt(originY + localY) }
}

function drawChartLine(ctx: PdfRenderCtx, x1: number, y1: number, x2: number, y2: number, color: string, thickness: number, originX: number, originY: number): void {
  const start = chartToPagePoint(originX, originY, x1, y1)
  const end = chartToPagePoint(originX, originY, x2, y2)
  ctx.pdf.doc.moveTo(start.x, start.y).lineTo(end.x, end.y).lineWidth(pxToPt(thickness)).stroke(color)
}

// Strokes a chart-local SVG path string (as produced by chart-render.ts's linePath()) as ONE
// continuous stroke — same translate/scale content-matrix trick as drawChartPath below, so
// `thickness` is passed in raw local px (the ctx.scale(PX_TO_PT) already converts it), not
// pre-converted via pxToPt the way drawChartLine's per-segment moveTo/lineTo calls need. Round
// join/cap match chart-render.ts's SVG <path> stroke-linejoin/stroke-linecap so a curved
// multi-segment line doesn't grow visible miter spikes at points where the tangent changes direction.
function drawChartPathStroke(ctx: PdfRenderCtx, d: string, color: string, thickness: number, originX: number, originY: number): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  const doc = ctx.pdf.doc
  doc.save()
  doc.translate(origin.x, origin.y)
  doc.scale(PX_TO_PT)
  doc.path(d)
  doc.lineWidth(thickness).lineJoin('round').lineCap('round')
  doc.stroke(color)
  doc.restore()
}

// Fills a chart-local SVG path string with a linear gradient — opaque `color`/`opacity` at
// (gx1,gy1), fading to fully transparent at (gx2,gy2). Coordinates are in the SAME local chart-px
// space as `d` (see areaFillGradientVector()'s header comment): pdfkit's gradient reads the CTM at
// the moment `.fill(gradient)` runs, so defining it inside this save/translate/scale block —
// exactly like drawChartPath's solid fill — makes it pick up the same origin-translate + px->pt
// scale as the path itself, with no separate unit conversion needed.
function drawChartAreaFill(ctx: PdfRenderCtx, d: string, gx1: number, gy1: number, gx2: number, gy2: number, color: string, opacity: number, originX: number, originY: number): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  const doc = ctx.pdf.doc
  doc.save()
  doc.translate(origin.x, origin.y)
  doc.scale(PX_TO_PT)
  doc.path(d)
  const gradient = doc.linearGradient(gx1, gy1, gx2, gy2)
  gradient.stop(0, color, opacity)
  gradient.stop(1, color, 0)
  doc.fill(gradient)
  doc.restore()
}

function drawChartCircle(ctx: PdfRenderCtx, cx: number, cy: number, r: number, color: string, originX: number, originY: number): void {
  const center = chartToPagePoint(originX, originY, cx, cy)
  ctx.pdf.doc.circle(center.x, center.y, pxToPt(r)).fill(color)
}

// chart-render.ts's path builders (barPath/pieSlicePath/donutSlicePath) emit raw-px SVG path strings
// anchored at the chart's own local (0,0) — pdfkit's .path() takes an SVG path string literally in
// its CURRENT coordinate space with no coordinate reinterpretation of its own. So the origin
// translate (already in pt) and the px->pt unit scale are pushed as content-matrix transforms
// around the path — save()/translate()/scale()/restore() — rather than rewriting the numbers
// inside the `d` string by hand, which would be one misplaced digit away from corrupting an arc
// command's 0/1 flag fields.
function drawChartPath(ctx: PdfRenderCtx, d: string, color: string, originX: number, originY: number): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  const doc = ctx.pdf.doc
  doc.save()
  doc.translate(origin.x, origin.y)
  doc.scale(PX_TO_PT)
  doc.path(d)
  doc.fill(color)
  doc.restore()
}

// Chart <text> elements' x/y (per chart-render.ts's svgText()) are already the SVG baseline
// position directly — unlike PositionedLine.y (top of line box), so `baseline: 0` is exactly right
// here too, with no half-leading/ascent math needed; only the text-anchor emulation pdfkit's
// text() lacks natively (start/middle/end, via measuring width and shifting x — same
// manual-alignment approach positionLines() itself uses for body text).
function drawChartText(
  ctx: PdfRenderCtx,
  text: string,
  localX: number,
  localY: number,
  opts: { fontSize: number; color: string; anchor: 'start' | 'middle' | 'end'; bold: boolean; fontFamily: string },
  originX: number,
  originY: number,
): void {
  const fontName = resolveChartFontName(ctx.pdf, opts.fontFamily, opts.bold)
  const fontSizePt = pxToPt(opts.fontSize)
  const doc = ctx.pdf.doc
  doc.font(fontName).fontSize(fontSizePt)
  const widthPt = doc.widthOfString(text)
  const dx = opts.anchor === 'middle' ? -widthPt / 2 : opts.anchor === 'end' ? -widthPt : 0
  const { x, y } = chartToPagePoint(originX, originY, localX, localY)
  doc.fillColor(opts.color).text(text, x + dx, y, { lineBreak: false, baseline: 0 })
}

function drawChartLegend(
  ctx: PdfRenderCtx,
  entries: LegendEntry[],
  box: ChartBox,
  orientation: 'vertical' | 'horizontal',
  fontSize: number,
  fontFamily: string,
  color: string,
  originX: number,
  originY: number,
): void {
  const swatch = 10
  const baselineOffset = textBaselineOffset(fontSize)
  const doc = ctx.pdf.doc

  if (orientation === 'vertical') {
    const rowHeight = Math.max(swatch + 4, fontSize + 9)
    const maxRows = Math.max(0, Math.floor(box.height / rowHeight))
    entries.slice(0, maxRows).forEach((entry, i) => {
      const rowCenterY = box.y + i * rowHeight + rowHeight / 2
      const rect = { x: pxToPt(originX + box.x), y: pxToPt(originY + rowCenterY - swatch / 2), width: pxToPt(swatch), height: pxToPt(swatch) }
      doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(entry.color))
      const label = truncateToWidth(entry.label, box.width - swatch - 6, fontSize)
      drawChartText(ctx, label, box.x + swatch + 6, rowCenterY + baselineOffset, { fontSize, fontFamily, color, anchor: 'start', bold: false }, originX, originY)
    })
    return
  }

  let x = box.x
  const centerY = box.y + box.height / 2
  for (const entry of entries) {
    const labelMaxWidth = 90
    const label = truncateToWidth(entry.label, labelMaxWidth, fontSize)
    const labelWidth = Math.min(labelMaxWidth, estimateTextWidth(label, fontSize))
    const entryWidth = swatch + 6 + labelWidth
    if (x + entryWidth > box.x + box.width) break
    const rect = { x: pxToPt(originX + x), y: pxToPt(originY + centerY - swatch / 2), width: pxToPt(swatch), height: pxToPt(swatch) }
    doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(entry.color))
    drawChartText(ctx, label, x + swatch + 6, centerY + baselineOffset, { fontSize, fontFamily, color, anchor: 'start', bold: false }, originX, originY)
    x += entryWidth + 14
  }
}

// Vertical/horizontal are two dedicated paths, not one axis-agnostic function — see chart-render.ts's
// renderCategoricalChart for the full rationale (mirrors group.ts's layoutRow/layoutColumn split).
function drawCategoricalChart(ctx: PdfRenderCtx, node: CategoricalChartNode, plot: ChartBox, originX: number, originY: number): void {
  const categories = node.categories
  const series = node.series
  const colors = series.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)))

  const stacked = node.chartKind === 'bar' && (node.barMode ?? 'grouped') === 'stacked'
  const { dataMin, dataMax } = resolveChartDomain(categories, series, stacked, node.view ?? {})
  const axis = node.axis ?? {}
  const barBaselineValue = Math.max(dataMin, Math.min(dataMax, 0))
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

  if ((node.orientation ?? 'vertical') === 'horizontal') {
    drawHorizontalCategoricalChart(ctx, node, plot, originX, originY, {
      categories,
      series,
      colors,
      stacked,
      dataMin,
      dataMax,
      barBaselineValue,
      axisShow,
      gridlinesShow,
      ticks,
      formatTick,
      tickFontSize,
      categoryFontSize,
      tickBaselineOffset,
      fontFamily,
      axisColor,
      gridlineColor,
      tickColor,
    })
    return
  }

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
      const gy = yScale(tick)
      drawChartLine(ctx, plotLeft, gy, plotRight, gy, gridlineColor, 1, originX, originY)
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const ty = yScale(tick)
      drawChartText(ctx, formatTick(tick), plotLeft - 8, ty + tickBaselineOffset, { fontSize: tickFontSize, fontFamily, color: tickColor, anchor: 'end', bold: false }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, axisColor, 1, originX, originY)
  }

  const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth
  const labelEstWidth = Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize)), 1)
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Number.POSITIVE_INFINITY

  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const cx = plotLeft + bandWidth * (ci + 0.5)
      drawChartText(ctx, category, cx, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, fontFamily, color: tickColor, anchor: 'middle', bold: false }, originX, originY)
    })
  }

  if (node.chartKind === 'bar' && stacked) {
    const segmentGap = node.barSegmentGap ?? 0
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandWidth - MARK_SURFACE_GAP * 2))
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandX = plotLeft + bandWidth * ci
      const barX = bandX + (bandWidth - barThickness) / 2
      const values = series.map(s => s.data[ci]!)
      for (const seg of stackedBarSegments(values)) {
        const range = stackedSegmentPixelRange(seg, yScale, segmentGap)
        if (range === null) continue
        drawChartPath(ctx, barPath(barX, range.coordStart, barThickness, range.length, seg.round, cornerRadius), colors[seg.seriesIndex]!, originX, originY)
      }
    })
    return
  }

  if (node.chartKind === 'bar') {
    const rawThickness = (bandWidth - MARK_SURFACE_GAP * (series.length + 1)) / Math.max(series.length, 1)
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness))
    const groupWidth = barThickness * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)
    const zeroY = yScale(barBaselineValue)
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandX = plotLeft + bandWidth * ci
      const groupStart = bandX + (bandWidth - groupWidth) / 2
      series.forEach((s, si) => {
        const value = s.data[ci]!
        const barX = groupStart + si * (barThickness + MARK_SURFACE_GAP)
        const valueY = yScale(value)
        const barY = Math.min(zeroY, valueY)
        const barH = Math.abs(valueY - zeroY)
        if (barH <= 0) return
        drawChartPath(ctx, barPath(barX, barY, barThickness, barH, value >= barBaselineValue ? 'top' : 'bottom', cornerRadius), colors[si]!, originX, originY)
      })
    })
    return
  }

  // Line chart.
  const curve = node.lineCurve ?? 'linear'
  const lineStrokeWidth = node.lineStrokeWidth ?? LINE_STROKE_WIDTH
  const { radius: markerRadius, ringRadius: markerRingRadius } = resolveMarkerRadii(node)
  series.forEach((s, si) => {
    const points = categories.map((_, ci) => [plotLeft + bandWidth * (ci + 0.5), yScale(s.data[ci]!)] as const)
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      const baselineY = yScale(barBaselineValue)
      const { from, to } = areaFillGradientVector(points, 'x', baselineY)
      drawChartAreaFill(ctx, areaPath(points, curve, 'x', baselineY), 0, from, 0, to, resolvePdfColor(fill.color), fill.opacity, originX, originY)
    }
    drawChartPathStroke(ctx, linePath(points, curve, 'x'), colors[si]!, lineStrokeWidth, originX, originY)
    for (const [px, py] of points) {
      drawChartCircle(ctx, px, py, markerRingRadius, resolvePdfColor(SURFACE_COLOR), originX, originY)
      drawChartCircle(ctx, px, py, markerRadius, colors[si]!, originX, originY)
    }
  })
}

type CategoricalChartContext = {
  categories: string[]
  series: ChartSeries[]
  colors: string[]
  stacked: boolean
  dataMin: number
  dataMax: number
  barBaselineValue: number
  axisShow: boolean
  gridlinesShow: boolean
  ticks: number[]
  formatTick: (value: number) => string
  tickFontSize: number
  categoryFontSize: number
  tickBaselineOffset: number
  fontFamily: string
  axisColor: string
  gridlineColor: string
  tickColor: string
}

// Mirrors chart-render.ts's renderHorizontalCategoricalChart field-for-field — categories run
// top-to-bottom, values run left-to-right, bars grow rightward (or leftward below the baseline).
function drawHorizontalCategoricalChart(ctx: PdfRenderCtx, node: CategoricalChartNode, plot: ChartBox, originX: number, originY: number, chartCtx: CategoricalChartContext): void {
  const { categories, series, colors, stacked, dataMin, dataMax, barBaselineValue, axisShow, gridlinesShow, ticks, formatTick, tickFontSize, categoryFontSize, tickBaselineOffset, fontFamily, axisColor, gridlineColor, tickColor } =
    chartCtx

  const leftMargin = axisShow ? Math.max(30, Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize))) + 16) : 4
  const bottomMargin = axisShow ? tickFontSize + 20 : 4

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - 8
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const xScale = (value: number): number => plotLeft + ((value - dataMin) / (dataMax - dataMin)) * plotWidth

  if (gridlinesShow) {
    for (const tick of ticks) {
      const x = xScale(tick)
      drawChartLine(ctx, x, plotTop, x, plotBottom, gridlineColor, 1, originX, originY)
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const x = xScale(tick)
      drawChartText(ctx, formatTick(tick), x, plotBottom + tickFontSize + 4, { fontSize: tickFontSize, fontFamily, color: tickColor, anchor: 'middle', bold: false }, originX, originY)
    }
    drawChartLine(ctx, plotLeft, plotTop, plotLeft, plotBottom, axisColor, 1, originX, originY)
  }

  const bandHeight = categories.length > 0 ? plotHeight / categories.length : plotHeight
  const labelEstHeight = categoryFontSize + 4
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstHeight / Math.max(bandHeight, 1))) : Number.POSITIVE_INFINITY

  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const y = plotTop + bandHeight * (ci + 0.5)
      drawChartText(ctx, category, plotLeft - 8, y + tickBaselineOffset, { fontSize: categoryFontSize, fontFamily, color: tickColor, anchor: 'end', bold: false }, originX, originY)
    })
  }

  if (node.chartKind === 'bar' && stacked) {
    const segmentGap = node.barSegmentGap ?? 0
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandHeight - MARK_SURFACE_GAP * 2))
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandY = plotTop + bandHeight * ci
      const barY = bandY + (bandHeight - barThickness) / 2
      const values = series.map(s => s.data[ci]!)
      for (const seg of stackedBarSegments(values)) {
        const range = stackedSegmentPixelRange(seg, xScale, segmentGap)
        if (range === null) continue
        const round = seg.round === 'top' ? 'right' : seg.round === 'bottom' ? 'left' : 'none'
        drawChartPath(ctx, barPath(range.coordStart, barY, range.length, barThickness, round, cornerRadius), colors[seg.seriesIndex]!, originX, originY)
      }
    })
    return
  }

  if (node.chartKind === 'bar') {
    const rawThickness = (bandHeight - MARK_SURFACE_GAP * (series.length + 1)) / Math.max(series.length, 1)
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness))
    const groupHeight = barThickness * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)
    const zeroX = xScale(barBaselineValue)
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandY = plotTop + bandHeight * ci
      const groupStart = bandY + (bandHeight - groupHeight) / 2
      series.forEach((s, si) => {
        const value = s.data[ci]!
        const barY = groupStart + si * (barThickness + MARK_SURFACE_GAP)
        const valueX = xScale(value)
        const barX = Math.min(zeroX, valueX)
        const barW = Math.abs(valueX - zeroX)
        if (barW <= 0) return
        drawChartPath(ctx, barPath(barX, barY, barW, barThickness, value >= barBaselineValue ? 'right' : 'left', cornerRadius), colors[si]!, originX, originY)
      })
    })
    return
  }

  // Line chart.
  const curve = node.lineCurve ?? 'linear'
  const lineStrokeWidth = node.lineStrokeWidth ?? LINE_STROKE_WIDTH
  const { radius: markerRadius, ringRadius: markerRingRadius } = resolveMarkerRadii(node)
  series.forEach((s, si) => {
    const points = categories.map((_, ci) => [xScale(s.data[ci]!), plotTop + bandHeight * (ci + 0.5)] as const)
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      const baselineX = xScale(barBaselineValue)
      const { from, to } = areaFillGradientVector(points, 'y', baselineX)
      drawChartAreaFill(ctx, areaPath(points, curve, 'y', baselineX), from, 0, to, 0, resolvePdfColor(fill.color), fill.opacity, originX, originY)
    }
    drawChartPathStroke(ctx, linePath(points, curve, 'y'), colors[si]!, lineStrokeWidth, originX, originY)
    for (const [px, py] of points) {
      drawChartCircle(ctx, px, py, markerRingRadius, resolvePdfColor(SURFACE_COLOR), originX, originY)
      drawChartCircle(ctx, px, py, markerRadius, colors[si]!, originX, originY)
    }
  })
}

function drawPieChart(ctx: PdfRenderCtx, node: RadialChartNode, plot: ChartBox, originX: number, originY: number): void {
  const slices = node.slices
  const colors = slices.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)))
  const total = slices.reduce((acc, s) => acc + s.value, 0) || 1

  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const radius = Math.max(0, Math.min(plot.width, plot.height) / 2 - 8)
  const isDonut = node.chartKind === 'donut'
  const innerRadius = node.chartKind === 'donut' ? radius * (node.donutInnerRadiusRatio ?? 0.6) : 0

  const gapDeg = slices.length > 1 ? (node.sliceGap ?? 1.5) : 0
  // See chart-render.ts's renderPieChart for the full rationale — a constant pixel half-width,
  // not a trimmed angle, so the gap stays the same width from the apex/inner rim to the outer rim.
  const halfGapPx = radius * Math.sin((gapDeg / 2) * (Math.PI / 180))
  let angle = -90
  slices.forEach((s, i) => {
    const sweep = (s.value / total) * 360
    if (sweep > 0) {
      // No border here — separation comes entirely from the offset geometry, so `sliceGap: 0`
      // means genuinely flush slices in the PDF too.
      const d = isDonut
        ? donutSlicePath(cx, cy, innerRadius, radius, angle, angle + sweep, halfGapPx)
        : pieSlicePath(cx, cy, radius, angle, angle + sweep, halfGapPx)
      drawChartPath(ctx, d, colors[i]!, originX, originY)
    }
    angle += sweep
  })
}

export function drawChartNode(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): void {
  const node = rendered.node
  const width = rendered.box.width
  const height = rendered.box.height
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  // (x, y), NOT ctx.originX/ctx.originY: chart draws its own local geometry treating its OWN box
  // top-left as the origin, unlike table/group/container (whose children's boxes are already
  // resolved relative to the unchanged outer origin, per geometry.ts's translateRendered). Passing
  // the outer origin here would draw every chart at its enclosing group's origin instead of its own
  // position, stacking multiple charts on top of each other.
  const originX = x
  const originY = y

  let top = 0
  let bottom = height
  let left = 0
  let right = width

  const title = resolveTitle(node)
  if (title !== null) {
    const band = title.fontSize + 16
    drawChartText(ctx, title.text, width / 2, top + title.fontSize + 4, { fontSize: title.fontSize, fontFamily, color: resolvePdfColor(title.color), anchor: 'middle', bold: false }, originX, originY)
    top += band
  }

  const entries = legendEntriesFor(node)
  if (resolveShowLegend(node, entries.length) && entries.length > 0) {
    const legendFontSize = node.legend?.fontSize ?? 11
    const legendColor = resolvePdfColor(node.legend?.color ?? INK_SECONDARY)
    const position = node.legend?.position ?? 'right'
    if (position === 'right') {
      const legendWidth = Math.min(140, width * 0.28)
      right -= legendWidth
      drawChartLegend(ctx, entries, { x: right + 12, y: top, width: legendWidth - 12, height: bottom - top }, 'vertical', legendFontSize, fontFamily, legendColor, originX, originY)
    } else {
      const legendHeight = Math.max(24, legendFontSize + 14)
      bottom -= legendHeight
      drawChartLegend(ctx, entries, { x: left, y: bottom, width: right - left, height: legendHeight }, 'horizontal', legendFontSize, fontFamily, legendColor, originX, originY)
    }
  }

  const plot: ChartBox = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  if (node.chartKind === 'bar' || node.chartKind === 'line') {
    drawCategoricalChart(ctx, node, plot, originX, originY)
  } else {
    drawPieChart(ctx, node, plot, originX, originY)
  }
}
