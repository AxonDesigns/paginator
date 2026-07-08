// Best-effort plain-text reduction of an arbitrary Node — used wherever a target cell/field
// fundamentally can't hold nested layout (an xlsx cell, or an unrecognized node type in docx
// export). Never throws on an unsupported node type; degrades to an empty string instead, since
// this is always a fallback path, not the primary rendering path for a node type.
import type { Node } from '../core/nodes.ts'

export function flattenNodeToText(node: Node): string {
  switch (node.type) {
    case 'text':
      return node.content
    case 'richText':
      return node.runs.map(run => run.text).join('')
    case 'group':
      return node.children.map(flattenNodeToText).filter(text => text.length > 0).join(node.direction === 'row' ? ' ' : '\n')
    case 'container':
      return flattenNodeToText(node.child)
    case 'table':
      return node.rows
        .flatMap(row => (row.kind === 'header' ? (row.cells ?? (row.content !== undefined ? [{ content: row.content }] : [])) : row.cells))
        .map(cell => (cell.content !== undefined ? flattenNodeToText(cell.content) : ''))
        .filter(text => text.length > 0)
        .join(' ')
    case 'separator':
    case 'page-break':
    case 'image':
    case 'svg':
    case 'chart':
      return ''
  }
}
