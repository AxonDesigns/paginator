// RichTextNode: mirrors text.ts's shape exactly, swapping the plain-text prepareWithSegments()/
// layoutNextLine() API for @chenglou/pretext/rich-inline's mixed-style-run equivalent
// (prepareRichInline()/layoutNextRichInlineLineRange()). This is what lets a RichTextNode mix
// fonts/colors/decorations per run within one wrapped paragraph, and still resume mid-run across a
// page split via a saved cursor, exactly like TextNode does.

import { layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats, prepareRichInline } from '@chenglou/pretext/rich-inline'
import type { PreparedRichInline, RichInlineCursor, RichInlineLine } from '@chenglou/pretext/rich-inline'
import type { PositionedRichLine, PositionedRun, RenderedNode } from '../core/geometry.ts'
import { registerNode } from '../core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx, SplitOutcome } from '../core/behavior.ts'
import type { RichTextNode, RichTextRun } from '../core/nodes.ts'
import { styledDiv } from '../render/shadow-dom.ts'
import { BASE_ELEMENT_STYLE } from '../render/reset.ts'
import { pxToPt, resolvePdfColor } from '../render/pdf-render.ts'
import { measureFontMetricsPx, richTextNodeFontString, resolveRunFont } from '../render/pdf-fonts.ts'
import { resolveActiveFontFamily } from '../render/font-registry.ts'

type Rendered = Extract<RenderedNode, { type: 'richText' }>

// No equivalent of measureNaturalWidth() exists for rich-inline, so a very wide probe width stands
// in for "effectively unconstrained" — wide enough that no realistic document width would ever
// force a wrap, same trick a binary-search-for-natural-width caller would use.
const UNCONSTRAINED_WIDTH = 1_000_000

// See text.ts's fontString() for what resolveActiveFontFamily() does and when it's a no-op.
function runFontString(run: RichTextRun, node: RichTextNode): string {
  const style = (run.fontStyle ?? node.fontStyle) === 'italic' ? 'italic ' : ''
  const weight = run.fontWeight ?? node.fontWeight ?? 400
  const size = run.fontSize ?? node.fontSize
  const rawFamily = run.fontFamily ?? node.fontFamily
  const family = resolveActiveFontFamily(rawFamily, weight, run.fontStyle ?? node.fontStyle)
  return `${style}${weight} ${size}px ${family}`
}

function preparedFor(node: RichTextNode): PreparedRichInline {
  if (node.__prepared) return node.__prepared as PreparedRichInline
  const items = node.runs.map(run => ({
    text: run.text,
    font: runFontString(run, node),
    letterSpacing: run.letterSpacing ?? node.letterSpacing,
  }))
  const prepared = prepareRichInline(items)
  node.__prepared = prepared
  return prepared
}

function startCursorFor(node: RichTextNode): RichInlineCursor | undefined {
  return node.__resumeCursor
}

function streamRichLines(
  prepared: PreparedRichInline,
  startCursor: RichInlineCursor | undefined,
  width: number,
  maxLines: number,
): { lines: RichInlineLine[]; endCursor: RichInlineCursor | undefined; exhausted: boolean } {
  const lines: RichInlineLine[] = []
  let cursor = startCursor
  while (lines.length < maxLines) {
    const range = layoutNextRichInlineLineRange(prepared, width, cursor)
    if (range === null) return { lines, endCursor: cursor, exhausted: true }
    lines.push(materializeRichInlineLineRange(prepared, range))
    cursor = range.end
  }
  const probe = layoutNextRichInlineLineRange(prepared, width, cursor)
  return { lines, endCursor: cursor, exhausted: probe === null }
}

// Per the rich-inline README: `gapBefore` is the collapsed boundary gap paid before a fragment on
// its line, and `occupiedWidth` is its text width (plus any caller-owned extraWidth, unused here) —
// accumulating both across a line's fragments in order reconstructs each fragment's absolute x.
function positionRichLines(lines: RichInlineLine[], node: RichTextNode, width: number): PositionedRichLine[] {
  return lines.map((line, i) => {
    const lineX = node.align === 'center' ? (width - line.width) / 2 : node.align === 'right' ? width - line.width : 0
    let cursor = 0
    const runs: PositionedRun[] = line.fragments.map(f => {
      cursor += f.gapBefore
      const x = lineX + cursor
      cursor += f.occupiedWidth
      return { x, width: f.occupiedWidth, text: f.text, runIndex: f.itemIndex }
    })
    return { y: i * node.lineHeight, width: line.width, runs }
  })
}

function fullLines(node: RichTextNode, width: number): RichInlineLine[] {
  const prepared = preparedFor(node)
  const { lines } = streamRichLines(prepared, startCursorFor(node), width, Infinity)
  return lines
}

/** Shrink-to-fit width for cross/main-axis sizing in Group/Table layout — the widest forced line. */
export function richTextNaturalWidth(node: RichTextNode): number {
  const prepared = preparedFor(node)
  return measureRichInlineStats(prepared, UNCONSTRAINED_WIDTH).maxLineWidth
}

function measureHeight(node: RichTextNode, width: number): number {
  return fullLines(node, width).length * node.lineHeight
}

function layout(node: RichTextNode, width: number): Rendered {
  const lines = fullLines(node, width)
  return {
    type: 'richText',
    box: { x: 0, y: 0, width, height: lines.length * node.lineHeight },
    node,
    lines: positionRichLines(lines, node, width),
  }
}

function split(node: RichTextNode, width: number, availableHeight: number): SplitOutcome<RichTextNode> {
  const maxLines = Math.floor(availableHeight / node.lineHeight)
  if (maxLines <= 0) return null

  const prepared = preparedFor(node)
  const { lines, endCursor, exhausted } = streamRichLines(prepared, startCursorFor(node), width, maxLines)
  if (lines.length === 0) return null

  const consumedHeight = lines.length * node.lineHeight
  const rendered: Rendered = {
    type: 'richText',
    box: { x: 0, y: 0, width, height: consumedHeight },
    node,
    lines: positionRichLines(lines, node, width),
  }
  const rest: RichTextNode | null = exhausted ? null : { ...node, __prepared: prepared, __resumeCursor: endCursor }
  return { rendered, consumedHeight, rest }
}

// One element per RUN/fragment (not per line, unlike text.ts) since style can vary within a line. A
// run carrying `href` renders as a real `<a>` — natively clickable/hoverable/keyboard-focusable —
// rather than going through the generic interactive/hit-registry system (see RichTextRun.href's doc
// comment in nodes.ts for why).
function renderDom(rendered: Rendered, x: number, y: number, ctx: DomRenderCtx): void {
  const node = rendered.node
  const boxEl = styledDiv({
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    ...(ctx.unselectable ? { userSelect: 'none' as const } : {}),
  })

  for (const line of rendered.lines) {
    for (const run of line.runs) {
      const source = node.runs[run.runIndex]!
      const decoration = source.textDecoration ?? node.textDecoration
      const isLink = source.href !== undefined
      const style: Partial<CSSStyleDeclaration> = {
        left: `${run.x}px`,
        top: `${line.y}px`,
        width: `${run.width}px`,
        height: `${node.lineHeight}px`,
        font: runFontString(source, node),
        lineHeight: `${node.lineHeight}px`,
        color: source.color ?? node.color ?? '#000000',
        letterSpacing: (source.letterSpacing ?? node.letterSpacing) !== undefined ? `${source.letterSpacing ?? node.letterSpacing}px` : 'normal',
        whiteSpace: 'pre',
        ...(decoration !== undefined && decoration !== 'none' ? { textDecoration: decoration } : {}),
        ...(isLink ? { display: 'block' as const } : {}),
      }
      const runEl: HTMLElement = isLink ? document.createElement('a') : document.createElement('div')
      Object.assign(runEl.style, BASE_ELEMENT_STYLE, style)
      if (isLink) {
        const a = runEl as HTMLAnchorElement
        a.href = source.href!
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
      }
      runEl.textContent = run.text
      boxEl.appendChild(runEl)
    }
  }
  ctx.container.appendChild(boxEl)
}

// Mirrors text.ts's drawPdf, but loops per line -> per RUN/fragment instead of per line only, since
// style (font/size/color/decoration) can vary within one line. Baseline vertical metrics are
// computed ONCE from the node's own default font — not per run — matching pretext's own model
// (lineHeight is a single caller-supplied layout input, not derived per-fragment), so mixing run
// font SIZES on one line shares one baseline rather than doing CSS-style per-inline-box vertical
// alignment (see GUIDE.md's known-limitations note on richText). A run with `href` additionally
// gets a real pdfkit link annotation over its exact fragment box — the PDF-side counterpart to the
// DOM's `<a href>` for the same run, entirely independent of the interactive/hit-registry system.
function drawPdf(rendered: Rendered, x: number, y: number, ctx: PdfRenderCtx): void {
  const node = rendered.node
  const doc = ctx.pdf.doc
  const { ascentPx, descentPx } = measureFontMetricsPx(richTextNodeFontString(node))
  const lineHeightPt = pxToPt(node.lineHeight)
  const ascentPt = pxToPt(ascentPx)
  const fullHeightPt = pxToPt(ascentPx + descentPx)
  const halfLeadingPt = (lineHeightPt - fullHeightPt) / 2
  const baselineFromTopPt = halfLeadingPt + ascentPt

  for (const line of rendered.lines) {
    const lineTopPt = pxToPt(y + line.y)
    const baselinePt = lineTopPt + baselineFromTopPt

    for (const run of line.runs) {
      const source = node.runs[run.runIndex]!
      const fontName = resolveRunFont(ctx.pdf, source, node)
      const fontSizePt = pxToPt(source.fontSize ?? node.fontSize)
      const color = resolvePdfColor(source.color ?? node.color ?? '#000000')
      const letterSpacing = source.letterSpacing ?? node.letterSpacing
      const characterSpacing = letterSpacing !== undefined ? pxToPt(letterSpacing) : 0
      const startXPt = pxToPt(x + run.x)
      const widthPt = pxToPt(run.width)

      doc.font(fontName).fontSize(fontSizePt).fillColor(color)
      doc.text(run.text, startXPt, baselinePt, { lineBreak: false, baseline: 0, characterSpacing })

      const decoration = source.textDecoration ?? node.textDecoration
      if (decoration === 'underline' || decoration === 'line-through') {
        const decorationThicknessPt = Math.max(0.5, fontSizePt * 0.05)
        const decorationYPt = decoration === 'underline' ? baselinePt + fontSizePt * 0.08 : baselinePt - fontSizePt * 0.3
        doc.moveTo(startXPt, decorationYPt).lineTo(startXPt + widthPt, decorationYPt).lineWidth(decorationThicknessPt).stroke(color)
      }

      if (source.href !== undefined) {
        doc.link(startXPt, lineTopPt, widthPt, lineHeightPt, source.href)
      }
    }
  }
}

registerNode('richText', {
  measureHeight,
  isSplittable: () => true,
  split,
  layout,
  naturalWidth: node => richTextNaturalWidth(node),
  renderDom,
  drawPdf,
})
