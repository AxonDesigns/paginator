// A page break is a pure flow-control marker: zero size, zero visible content. The actual
// "force a cut here" behavior lives in paginate.ts's page-walking recursion and
// group-layout.ts's columnGroupSplit(), which look for `node.type === 'page-break'` directly —
// this measurer only defines its inert fallback shape for contexts that don't special-case it
// (e.g. rendering it inside a header, or as a row's column).

import type { NodeMeasurer } from './behavior.ts'
import type { PageBreakNode } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'

export const pageBreakMeasurer: NodeMeasurer<PageBreakNode> = {
  splittable: false,

  measureHeight() {
    return 0
  },

  layout(node, width): RenderedNode {
    return { type: 'page-break', box: { x: 0, y: 0, width, height: 0 }, node }
  },
}
