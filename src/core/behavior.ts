// The extension seam: every node type plugs into pagination/group-layout purely through this
// registry. Adding a Phase-2 node type (Table/Image/Svg/custom) means adding it to the `Node`
// union in nodes.ts and adding one entry here — paginate.ts and group-layout.ts never need to
// change, they only ever dispatch through `registry[node.type]` and `isSplittable(node)`.

import type { ChartNode, GroupNode, ImageNode, Node, PageBreakNode, SeparatorNode, TableNode, TextNode } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'
import { textMeasurer } from './measure-text.ts'
import { separatorMeasurer } from './separator-layout.ts'
import { groupMeasurer } from './group-layout.ts'
import { pageBreakMeasurer } from './page-break-layout.ts'
import { imageMeasurer } from './image-layout.ts'
import { tableMeasurer } from './table-layout.ts'
import { chartMeasurer } from './chart-layout.ts'

export type SplitOutcome<T extends Node> = {
  /** The portion that fit this page, box-local (x=0, y=0). */
  rendered: RenderedNode
  consumedHeight: number
  /** null when the node finished exactly on this page. */
  rest: T | null
} | null // null = zero content fit (orphan case) — caller pushes the whole node to the next page

export interface NodeMeasurer<T extends Node = Node> {
  /** Full natural height this node occupies at `width`, ignoring page boundaries entirely. */
  measureHeight(node: T, width: number): number
  splittable: boolean
  /** Only meaningful when `splittable` (or, for groups, `isSplittable(node)`) is true. */
  split?(node: T, width: number, availableHeight: number): SplitOutcome<T>
  /** Full, unpaginated layout, box-local (x=0, y=0). */
  layout(node: T, width: number): RenderedNode
}

export const registry: {
  text: NodeMeasurer<TextNode>
  separator: NodeMeasurer<SeparatorNode>
  group: NodeMeasurer<GroupNode>
  'page-break': NodeMeasurer<PageBreakNode>
  image: NodeMeasurer<ImageNode>
  table: NodeMeasurer<TableNode>
  chart: NodeMeasurer<ChartNode>
} = {
  text: textMeasurer,
  separator: separatorMeasurer,
  group: groupMeasurer,
  'page-break': pageBreakMeasurer,
  image: imageMeasurer,
  table: tableMeasurer,
  chart: chartMeasurer,
}

// Column groups split between children; separators and page breaks are always atomic; row groups
// are atomic UNLESS explicitly opted into independent per-column splitting via `splitColumns`.
// This is a function rather than a static `registry[...].splittable` field because splittability
// for a group depends on its `direction`/`splitColumns`, not just its `type`.
export function isSplittable(node: Node): boolean {
  if (node.type === 'text') return true
  if (node.type === 'table') return true
  if (node.type !== 'group') return false
  return node.direction === 'column' || node.splitColumns === true
}

// Type-safe dispatch wrappers around `registry`. TypeScript cannot verify `registry[node.type]`
// against a union-typed `node` without narrowing per-branch first (a "correlated union" it can't
// solve structurally), so these switches are the honest way to keep full type safety at the one
// place (paginate.ts) that needs to call the registry generically across all three node types.

export function measureNodeHeight(node: Node, width: number): number {
  switch (node.type) {
    case 'text':
      return registry.text.measureHeight(node, width)
    case 'separator':
      return registry.separator.measureHeight(node, width)
    case 'group':
      return registry.group.measureHeight(node, width)
    case 'page-break':
      return registry['page-break'].measureHeight(node, width)
    case 'image':
      return registry.image.measureHeight(node, width)
    case 'table':
      return registry.table.measureHeight(node, width)
    case 'chart':
      return registry.chart.measureHeight(node, width)
  }
}

export function layoutNodeFull(node: Node, width: number): RenderedNode {
  switch (node.type) {
    case 'text':
      return registry.text.layout(node, width)
    case 'separator':
      return registry.separator.layout(node, width)
    case 'group':
      return registry.group.layout(node, width)
    case 'page-break':
      return registry['page-break'].layout(node, width)
    case 'image':
      return registry.image.layout(node, width)
    case 'table':
      return registry.table.layout(node, width)
    case 'chart':
      return registry.chart.layout(node, width)
  }
}

export function splitNode(node: Node, width: number, availableHeight: number): SplitOutcome<Node> {
  switch (node.type) {
    case 'text':
      return registry.text.split!(node, width, availableHeight)
    case 'group':
      return registry.group.split!(node, width, availableHeight)
    case 'table':
      return registry.table.split!(node, width, availableHeight)
    case 'separator':
    case 'page-break':
    case 'image':
    case 'chart':
      return null
  }
}
