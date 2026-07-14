// Depth-first walk over the semantic (pre-pagination) Node tree collecting every `table` node, at
// any depth — used by generateXlsx() (tables-only export scope) to find its worksheets. Recurses
// into `group.children`, `container.child`, and a table cell's own `content` (tables can nest inside
// cells, see GUIDE.md's "Cell Spans" demo). Stops at chart/svg/qrcode/barcode/image/text/richText/
// separator/page-break, which are leaves for this purpose.
import type { Node, TableNode } from '../core/nodes.ts'

export function findTables(node: Node): TableNode[] {
  switch (node.type) {
    case 'table': {
      const nested = node.rows.flatMap(row =>
        row.kind === 'header' ? (row.cells ?? (row.content !== undefined ? [{ content: row.content }] : [])) : row.cells,
      )
      return [node, ...nested.flatMap(cell => (cell.content !== undefined ? findTables(cell.content) : []))]
    }
    case 'group':
      return node.children.flatMap(findTables)
    case 'container':
      return findTables(node.child)
    case 'text':
    case 'richText':
    case 'separator':
    case 'page-break':
    case 'image':
    case 'svg':
    case 'qrcode':
    case 'barcode':
    case 'chart':
      return []
  }
}
