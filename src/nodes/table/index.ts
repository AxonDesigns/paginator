import { registerNode } from '../../core/behavior.ts'
import { layoutTable, measureTableHeight, splitTable } from './layout.ts'
import { renderTableNode } from './dom.ts'
import { drawTableNode } from './pdf.ts'

export { resolveColumnWidths } from './layout.ts'

registerNode('table', {
  measureHeight: measureTableHeight,
  isSplittable: () => true,
  split: splitTable,
  layout: layoutTable,
  renderDom: renderTableNode,
  drawPdf: drawTableNode,
})
