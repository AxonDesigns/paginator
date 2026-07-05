// Pretext rich-inline adapter: mirrors measure-text.ts's shape exactly, swapping the plain-text
// prepareWithSegments()/layoutNextLine() API for @chenglou/pretext/rich-inline's mixed-style-run
// equivalent (prepareRichInline()/layoutNextRichInlineLineRange()). This is what lets a RichTextNode
// mix fonts/colors/decorations per run within one wrapped paragraph, and still resume mid-run across
// a page split via a saved cursor, exactly like TextNode does.

import { layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats, prepareRichInline } from '@chenglou/pretext/rich-inline'
import type { PreparedRichInline, RichInlineCursor, RichInlineLine } from '@chenglou/pretext/rich-inline'
import type { PositionedRichLine, PositionedRun, RenderedNode } from './geometry.ts'
import type { NodeMeasurer, SplitOutcome } from './behavior.ts'
import type { RichTextNode, RichTextRun } from './nodes.ts'

// No equivalent of measureNaturalWidth() exists for rich-inline, so a very wide probe width stands
// in for "effectively unconstrained" — wide enough that no realistic document width would ever
// force a wrap, same trick a binary-search-for-natural-width caller would use.
const UNCONSTRAINED_WIDTH = 1_000_000

function runFontString(run: RichTextRun, node: RichTextNode): string {
  const style = (run.fontStyle ?? node.fontStyle) === 'italic' ? 'italic ' : ''
  const weight = run.fontWeight ?? node.fontWeight ?? 400
  const size = run.fontSize ?? node.fontSize
  const family = run.fontFamily ?? node.fontFamily
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

/** Shrink-to-fit width for cross/main-axis sizing in Group layout — the widest forced line. */
export function richTextNaturalWidth(node: RichTextNode): number {
  const prepared = preparedFor(node)
  return measureRichInlineStats(prepared, UNCONSTRAINED_WIDTH).maxLineWidth
}

export const richTextMeasurer: NodeMeasurer<RichTextNode> = {
  splittable: true,

  measureHeight(node, width) {
    return fullLines(node, width).length * node.lineHeight
  },

  layout(node, width): RenderedNode {
    const lines = fullLines(node, width)
    return {
      type: 'richText',
      box: { x: 0, y: 0, width, height: lines.length * node.lineHeight },
      node,
      lines: positionRichLines(lines, node, width),
    }
  },

  split(node, width, availableHeight): SplitOutcome<RichTextNode> {
    const maxLines = Math.floor(availableHeight / node.lineHeight)
    if (maxLines <= 0) return null

    const prepared = preparedFor(node)
    const { lines, endCursor, exhausted } = streamRichLines(prepared, startCursorFor(node), width, maxLines)
    if (lines.length === 0) return null

    const consumedHeight = lines.length * node.lineHeight
    const rendered: RenderedNode = {
      type: 'richText',
      box: { x: 0, y: 0, width, height: consumedHeight },
      node,
      lines: positionRichLines(lines, node, width),
    }
    const rest: RichTextNode | null = exhausted ? null : { ...node, __prepared: prepared, __resumeCursor: endCursor }
    return { rendered, consumedHeight, rest }
  },
}
