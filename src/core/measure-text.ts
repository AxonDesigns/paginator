// Pretext adapter: all text measurement/line-breaking funnels through streamLines(), which is
// built on pretext's layoutNextLine()/LayoutCursor streaming API — the same mechanism pretext's
// own README uses for flowing text across column/page boundaries. measureHeight/layout/split all
// call this one helper so there is exactly one code path walking the cursor mechanism.

import { layoutNextLine, measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext'
import type { LayoutCursor, LayoutLine, PreparedTextWithSegments } from '@chenglou/pretext'
import type { PositionedLine, RenderedNode } from './geometry.ts'
import type { NodeMeasurer, SplitOutcome } from './behavior.ts'
import type { TextNode } from './nodes.ts'

function fontString(node: TextNode): string {
  const style = node.fontStyle === 'italic' ? 'italic ' : ''
  const weight = node.fontWeight ?? 400
  return `${style}${weight} ${node.fontSize}px ${node.fontFamily}`
}

function preparedFor(node: TextNode): PreparedTextWithSegments {
  if (node.__prepared) return node.__prepared as PreparedTextWithSegments
  const prepared = prepareWithSegments(node.content, fontString(node), {
    whiteSpace: node.whiteSpace,
    wordBreak: node.wordBreak,
    letterSpacing: node.letterSpacing,
  })
  node.__prepared = prepared
  return prepared
}

function startCursorFor(node: TextNode): LayoutCursor {
  return node.__resumeCursor ?? { segmentIndex: 0, graphemeIndex: 0 }
}

function streamLines(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  width: number,
  maxLines: number,
): { lines: LayoutLine[]; endCursor: LayoutCursor; exhausted: boolean } {
  const lines: LayoutLine[] = []
  let cursor = startCursor
  while (lines.length < maxLines) {
    const line = layoutNextLine(prepared, cursor, width)
    if (line === null) return { lines, endCursor: cursor, exhausted: true }
    lines.push(line)
    cursor = line.end
  }
  const probe = layoutNextLine(prepared, cursor, width)
  return { lines, endCursor: cursor, exhausted: probe === null }
}

function positionLines(lines: LayoutLine[], node: TextNode, width: number): PositionedLine[] {
  return lines.map((line, i) => ({
    x: node.align === 'center' ? (width - line.width) / 2 : node.align === 'right' ? width - line.width : 0,
    y: i * node.lineHeight,
    width: line.width,
    text: line.text,
  }))
}

function fullLines(node: TextNode, width: number): LayoutLine[] {
  const prepared = preparedFor(node)
  const { lines } = streamLines(prepared, startCursorFor(node), width, Infinity)
  return lines
}

/** Shrink-to-fit width for cross/main-axis sizing in Group layout — the widest forced line. */
export function measureTextNaturalWidth(node: TextNode): number {
  return measureNaturalWidth(preparedFor(node))
}

export const textMeasurer: NodeMeasurer<TextNode> = {
  splittable: true,

  measureHeight(node, width) {
    return fullLines(node, width).length * node.lineHeight
  },

  layout(node, width): RenderedNode {
    const lines = fullLines(node, width)
    return {
      type: 'text',
      box: { x: 0, y: 0, width, height: lines.length * node.lineHeight },
      node,
      lines: positionLines(lines, node, width),
    }
  },

  split(node, width, availableHeight): SplitOutcome<TextNode> {
    const maxLines = Math.floor(availableHeight / node.lineHeight)
    if (maxLines <= 0) return null

    const prepared = preparedFor(node)
    const { lines, endCursor, exhausted } = streamLines(prepared, startCursorFor(node), width, maxLines)
    if (lines.length === 0) return null

    const consumedHeight = lines.length * node.lineHeight
    const rendered: RenderedNode = {
      type: 'text',
      box: { x: 0, y: 0, width, height: consumedHeight },
      node,
      lines: positionLines(lines, node, width),
    }
    const rest: TextNode | null = exhausted ? null : { ...node, __prepared: prepared, __resumeCursor: endCursor }
    return { rendered, consumedHeight, rest }
  },
}
