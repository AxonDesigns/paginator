export function flattenNodeToText(node) {
    switch (node.type) {
        case 'text':
            return node.content;
        case 'richText':
            return node.runs.map(run => run.text).join('');
        case 'group':
            return node.children.map(flattenNodeToText).filter(text => text.length > 0).join(node.direction === 'row' ? ' ' : '\n');
        case 'container':
            return flattenNodeToText(node.child);
        case 'table':
            return node.rows
                .flatMap(row => (row.kind === 'header' ? (row.cells ?? (row.content !== undefined ? [{ content: row.content }] : [])) : row.cells))
                .map(cell => (cell.content !== undefined ? flattenNodeToText(cell.content) : ''))
                .filter(text => text.length > 0)
                .join(' ');
        case 'qrcode':
        case 'barcode':
            // Unlike image/svg/chart (no natural text representation), a qrcode/barcode node's own
            // `value` IS a meaningful plain-text reduction — e.g. an xlsx cell showing the encoded value
            // is more useful than an empty one.
            return node.value;
        case 'separator':
        case 'page-break':
        case 'image':
        case 'svg':
        case 'chart':
            return '';
    }
}
