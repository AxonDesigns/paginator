// Separator is a trivial atomic leaf. Its registry entry models the canonical "horizontal rule as
// a column child" orientation: reserved main-axis (height) size is thickness + 2*margin, spanning
// the full width handed to it. When a separator is used as a ROW child (vertical divider), the
// row-specific stretch-to-full-row-height behavior is assembled directly by group-layout.ts,
// which already knows the row's final height only after laying out every child — see §3.3 of the
// design: a separator always renders as a line perpendicular to its parent's main axis, spanning
// the parent's cross axis fully, using `thickness + 2*margin` along the main axis.

import type { NodeMeasurer } from './behavior.ts'
import type { SeparatorNode } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'

export function separatorMainSize(node: SeparatorNode): number {
  return (node.thickness ?? 1) + 2 * (node.margin ?? 0)
}

export const separatorMeasurer: NodeMeasurer<SeparatorNode> = {
  splittable: false,

  measureHeight(node) {
    return separatorMainSize(node)
  },

  layout(node, width): RenderedNode {
    return { type: 'separator', box: { x: 0, y: 0, width, height: separatorMainSize(node) }, node }
  },
}
