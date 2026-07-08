// PDF drawing for ChartNode — port of the SVG renderer (src/render/chart-render*.ts), reusing its
// pure geometry/color/text-estimate helpers (src/render/chart-geometry.ts) unchanged, only the
// final SVG-element-append calls become pdfkit draw calls. Chart text deliberately never goes
// through the font registry the same way TextNode does: chart-geometry.ts already documents using a
// fixed heuristic text-width estimate rather than real measurement, so it never claimed font-exact
// fidelity to the document's own registered fonts — using the shared Helvetica fallback names here
// is free.
//
// This file is now just the entry point (`drawChartNode`, dispatching by `chartKind`) plus the
// handful of low-level pdfkit-draw primitives every chart-kind family needs (`drawChartLine`,
// `drawChartPathStroke`, `drawChartAreaFill`, `drawChartCircle`, `drawChartPath`, `drawChartText`,
// `drawChartLegend`) — each chart-kind family's own drawing logic lives in its own
// `pdf-<kind>.ts` (see e.g. `pdf-categorical.ts`, `pdf-radial.ts`), which import these primitives
// back from here. Same safe two-way (circular) module relationship as chart-render.ts's own header
// comment describes — every cross-file reference here only ever runs inside a function body.

import type { RenderedNode } from '../../core/geometry.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { PX_TO_PT, pxToPt, resolvePdfColor } from '../../render/pdf-render.ts'
import { resolveChartFontName } from '../../render/pdf-fonts.ts'
import { normalizeFontWeight } from '../../render/font-registry.ts'
import {
  CHART_FONT_FAMILY,
  INK_SECONDARY,
  estimateChartTextWidth,
  legendEntriesFor,
  normalizeChartText,
  resolveShowLegend,
  resolveTitle,
  textBaselineOffset,
  truncateToWidth,
  wrapChartTextToWidth,
} from '../../render/chart-geometry.ts'
import type { ChartBox, LegendEntry } from '../../render/chart-geometry.ts'
import type { ChartText } from '../../core/nodes.ts'
import { drawCategoricalChart } from './pdf-categorical.ts'
import { drawRadialChart } from './pdf-radial.ts'
import { drawScatterChart } from './pdf-scatter.ts'
import { drawGanttChart } from './pdf-gantt.ts'
import { drawRadarChart } from './pdf-radar.ts'
import { drawCandlestickChart } from './pdf-candlestick.ts'
import { drawTreemapChart } from './pdf-treemap.ts'

type Rendered = Extract<RenderedNode, { type: 'chart' }>

function chartToPagePoint(originX: number, originY: number, localX: number, localY: number): { x: number; y: number } {
  return { x: pxToPt(originX + localX), y: pxToPt(originY + localY) }
}

export function drawChartLine(ctx: PdfRenderCtx, x1: number, y1: number, x2: number, y2: number, color: string, thickness: number, originX: number, originY: number): void {
  const start = chartToPagePoint(originX, originY, x1, y1)
  const end = chartToPagePoint(originX, originY, x2, y2)
  ctx.pdf.doc.moveTo(start.x, start.y).lineTo(end.x, end.y).lineWidth(pxToPt(thickness)).stroke(color)
}

// Strokes a chart-local SVG path string (as produced by chart-geometry.ts's linePath()) as ONE
// continuous stroke — same translate/scale content-matrix trick as drawChartPath below, so
// `thickness` is passed in raw local px (the ctx.scale(PX_TO_PT) already converts it), not
// pre-converted via pxToPt the way drawChartLine's per-segment moveTo/lineTo calls need. Round
// join/cap match the SVG renderer's stroke-linejoin/stroke-linecap so a curved multi-segment line
// doesn't grow visible miter spikes at points where the tangent changes direction.
export function drawChartPathStroke(ctx: PdfRenderCtx, d: string, color: string, thickness: number, originX: number, originY: number): void {
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
// space as `d` (see chart-geometry.ts's areaFillGradientVector()'s header comment): pdfkit's
// gradient reads the CTM at the moment `.fill(gradient)` runs, so defining it inside this
// save/translate/scale block — exactly like drawChartPath's solid fill — makes it pick up the same
// origin-translate + px->pt scale as the path itself, with no separate unit conversion needed.
export function drawChartAreaFill(ctx: PdfRenderCtx, d: string, gx1: number, gy1: number, gx2: number, gy2: number, color: string, opacity: number, originX: number, originY: number): void {
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

export function drawChartCircle(ctx: PdfRenderCtx, cx: number, cy: number, r: number, color: string, originX: number, originY: number): void {
  const center = chartToPagePoint(originX, originY, cx, cy)
  ctx.pdf.doc.circle(center.x, center.y, pxToPt(r)).fill(color)
}

// chart-geometry.ts's path builders (barPath/pieSlicePath/donutSlicePath) emit raw-px SVG path
// strings anchored at the chart's own local (0,0) — pdfkit's .path() takes an SVG path string
// literally in its CURRENT coordinate space with no coordinate reinterpretation of its own. So the
// origin translate (already in pt) and the px->pt unit scale are pushed as content-matrix
// transforms around the path — save()/translate()/scale()/restore() — rather than rewriting the
// numbers inside the `d` string by hand, which would be one misplaced digit away from corrupting an
// arc command's 0/1 flag fields.
export function drawChartPath(ctx: PdfRenderCtx, d: string, color: string, originX: number, originY: number, opacity = 1): void {
  const origin = chartToPagePoint(originX, originY, 0, 0)
  const doc = ctx.pdf.doc
  doc.save()
  doc.translate(origin.x, origin.y)
  doc.scale(PX_TO_PT)
  doc.path(d)
  doc.opacity(opacity)
  doc.fill(color)
  doc.restore()
}

// Chart <text> elements' x/y (per chart-geometry.ts/chart-render.ts's svgText()) are already the
// SVG baseline position directly — unlike PositionedLine.y (top of line box), so `baseline: 0` is
// exactly right here too, with no half-leading/ascent math needed; only the text-anchor emulation
// pdfkit's text() lacks natively (start/middle/end, via measuring width and shifting x — same
// manual-alignment approach positionLines() itself uses for body text).
//
// `text` is `ChartText` — same rich per-run styling / explicit multi-line content `svgText()`
// supports (see that function's own header comment and `ChartTextRun` in nodes.ts). Unlike the SVG
// side (which lets the browser's native <tspan> layout position same-line runs), this measures
// each run's width with pdfkit's own REAL `doc.widthOfString()` — exact, not the heuristic — since
// that's already the natural, available primitive here, same as `positionLines()`'s own manual
// text-anchor alignment elsewhere in this codebase. A run's `fontWeight` maps to pdfkit's
// bold/not-bold font resolution via the same `normalizeFontWeight` threshold `pdf-fonts.ts` uses
// elsewhere; `fontStyle: 'italic'` has no PDF-side effect — `resolveChartFontName` has no italic
// variant to resolve to (unlike `TextNode`'s own font resolution), so it only ever renders as
// italic in the on-screen SVG. Opacity is applied via `save()`/`fillOpacity()`/`restore()` around
// just that one run's `.text()` call so it can never leak into whatever draws next.
export function drawChartText(
  ctx: PdfRenderCtx,
  text: ChartText,
  localX: number,
  localY: number,
  opts: { fontSize: number; color: string; anchor: 'start' | 'middle' | 'end'; bold: boolean; fontFamily: string },
  originX: number,
  originY: number,
): void {
  const doc = ctx.pdf.doc
  const lines = normalizeChartText(text, { fontSize: opts.fontSize, color: opts.color })
  const { x: baseX, y: baseY } = chartToPagePoint(originX, originY, localX, localY)
  let lineY = baseY
  let previousLineHeightPt = 0
  lines.forEach((line, li) => {
    if (li > 0) lineY += previousLineHeightPt

    const measured = line.map(run => {
      const isBold = run.fontWeight !== undefined ? normalizeFontWeight(run.fontWeight) >= 700 : opts.bold
      const fontName = resolveChartFontName(ctx.pdf, opts.fontFamily, isBold)
      const fontSizePt = pxToPt(run.fontSize)
      doc.font(fontName).fontSize(fontSizePt)
      return { run, fontName, fontSizePt, widthPt: doc.widthOfString(run.text) }
    })
    const totalWidthPt = measured.reduce((sum, m) => sum + m.widthPt, 0)
    const startDx = opts.anchor === 'middle' ? -totalWidthPt / 2 : opts.anchor === 'end' ? -totalWidthPt : 0

    let cursorX = baseX + startDx
    for (const { run, fontName, fontSizePt, widthPt } of measured) {
      // `resolvePdfColor` is idempotent on an already-resolved hex string (the common case, where
      // `run.color` fell back to `opts.color` — itself already resolved by every call site before
      // reaching here), and is what actually DOES the resolving for the new, not-yet-resolved case:
      // an author-specified per-run `ChartTextRun.color` override, which no caller has ever had the
      // chance to pre-resolve since individual runs are opaque to them.
      doc.font(fontName).fontSize(fontSizePt).fillColor(resolvePdfColor(run.color))
      if (run.opacity !== 1) {
        doc.save()
        doc.fillOpacity(run.opacity)
        doc.text(run.text, cursorX, lineY, { lineBreak: false, baseline: 0 })
        doc.restore()
      } else {
        doc.text(run.text, cursorX, lineY, { lineBreak: false, baseline: 0 })
      }
      cursorX += widthPt
    }

    const maxFontSizePx = Math.max(opts.fontSize, ...line.map(run => run.fontSize))
    previousLineHeightPt = pxToPt(Math.round(maxFontSizePx * 1.2))
  })
}

export function drawChartLegend(
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
    const labelWidth = Math.min(labelMaxWidth, estimateChartTextWidth(label, fontSize))
    const entryWidth = swatch + 6 + labelWidth
    if (x + entryWidth > box.x + box.width) break
    const rect = { x: pxToPt(originX + x), y: pxToPt(originY + centerY - swatch / 2), width: pxToPt(swatch), height: pxToPt(swatch) }
    doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(entry.color))
    drawChartText(ctx, label, x + swatch + 6, centerY + baselineOffset, { fontSize, fontFamily, color, anchor: 'start', bold: false }, originX, originY)
    x += entryWidth + 14
  }
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
    // Word-wrapped exactly like chart-render.ts's renderChartSvg — see that function's header
    // comment for the full rationale (title chrome sizing was never part of paginate()'s
    // synchronous layout, so a content-dependent band height here is legitimate and, critically,
    // computed from the SAME wrapChartTextToWidth heuristic both renderers share, so they wrap at
    // the exact same word and land on the exact same band height).
    const wrappedLines = wrapChartTextToWidth(title.text, width - 16, title.fontSize, title.color)
    const lineHeight = Math.round(title.fontSize * 1.2)
    const band = wrappedLines.length * lineHeight + 10
    wrappedLines.forEach((line, li) => {
      drawChartText(
        ctx,
        line,
        width / 2,
        top + title.fontSize + 4 + li * lineHeight,
        { fontSize: title.fontSize, fontFamily, color: resolvePdfColor(title.color), anchor: 'middle', bold: false },
        originX,
        originY,
      )
    })
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
  if (node.chartKind === 'categorical') {
    drawCategoricalChart(ctx, node, plot, originX, originY)
  } else if (node.chartKind === 'radial') {
    drawRadialChart(ctx, node, plot, originX, originY)
  } else if (node.chartKind === 'scatter') {
    drawScatterChart(ctx, node, plot, originX, originY)
  } else if (node.chartKind === 'gantt') {
    drawGanttChart(ctx, node, plot, originX, originY)
  } else if (node.chartKind === 'radar') {
    drawRadarChart(ctx, node, plot, originX, originY)
  } else if (node.chartKind === 'candlestick') {
    drawCandlestickChart(ctx, node, plot, originX, originY)
  } else {
    drawTreemapChart(ctx, node, plot, originX, originY)
  }
}
