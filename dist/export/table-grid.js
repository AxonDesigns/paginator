/** `rowStart`/`rowEnd`/`colStart`/`colEnd` are 0-indexed physical grid positions (inclusive) — a
 *  plain cell has rowStart===rowEnd and colStart===colEnd; a colSpan/rowSpan cell's merged block
 *  spans more than one. */
export function borderSides(mode, rowStart, rowEnd, colStart, colEnd, totalRows, columnCount) {
    const outerH = mode === 'all' || mode === 'outer' || mode === 'horizontal';
    const innerH = mode === 'all' || mode === 'horizontal';
    const outerV = mode === 'all' || mode === 'outer' || mode === 'vertical';
    const innerV = mode === 'all' || mode === 'vertical';
    return {
        top: rowStart === 0 ? outerH : innerH,
        bottom: rowEnd === totalRows - 1 ? outerH : innerH,
        left: colStart === 0 ? outerV : innerV,
        right: colEnd === columnCount - 1 ? outerV : innerV,
    };
}
export function borderStyleForThickness(thickness, styles) {
    if (thickness >= 3)
        return styles.thick;
    if (thickness >= 2)
        return styles.medium;
    return styles.thin;
}
