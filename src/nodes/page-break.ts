// A page break is a pure flow-control marker: zero size, zero visible content. The actual "force a
// cut here" behavior lives in paginate.ts's page-walking recursion and group.ts's columnGroupSplit(),
// which look for `node.type === 'page-break'` directly — this registration only defines its inert
// fallback shape for contexts that don't special-case it (e.g. rendering it inside a header, or as a
// row's column).

import type { RenderedNode } from '../core/geometry.ts'
import { registerNode } from '../core/behavior.ts'
import type { PageBreakNode } from '../core/nodes.ts'

type Rendered = Extract<RenderedNode, { type: 'page-break' }>

function layout(node: PageBreakNode, width: number): Rendered {
  return { type: 'page-break', box: { x: 0, y: 0, width, height: 0 }, node }
}

registerNode('page-break', {
  measureHeight: () => 0,
  isSplittable: () => false,
  layout,
  renderDom: () => {}, // Pure flow-control marker — zero size, nothing to paint.
  drawPdf: () => {},
})
