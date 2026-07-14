export function findTables(node) {
    switch (node.type) {
        case 'table': {
            const nested = node.rows.flatMap(row => row.kind === 'header' ? (row.cells ?? (row.content !== undefined ? [{ content: row.content }] : [])) : row.cells);
            return [node, ...nested.flatMap(cell => (cell.content !== undefined ? findTables(cell.content) : []))];
        }
        case 'group':
            return node.children.flatMap(findTables);
        case 'container':
            return findTables(node.child);
        case 'text':
        case 'richText':
        case 'separator':
        case 'page-break':
        case 'image':
        case 'svg':
        case 'qrcode':
        case 'barcode':
        case 'chart':
            return [];
    }
}
