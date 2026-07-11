/** `rowStart`/`rowEnd`/`colStart`/`colEnd` are 0-indexed physical grid positions (inclusive) — a
 *  plain cell has rowStart===rowEnd and colStart===colEnd; a colSpan/rowSpan cell's merged block
 *  spans more than one. `innerMode`/`outerMode` resolve independently (pass `'none'` for a mode
 *  whose surrounding config is entirely absent — see nodes.ts's `TableNode.border` doc comment). */
export function borderSides(innerMode, outerMode, rowStart, rowEnd, colStart, colEnd, totalRows, columnCount) {
    const outerH = outerMode === 'all' || outerMode === 'horizontal';
    const innerH = innerMode === 'all' || innerMode === 'horizontal';
    const outerV = outerMode === 'all' || outerMode === 'vertical';
    const innerV = innerMode === 'all' || innerMode === 'vertical';
    const sideFor = (isOuterEdge, outerFlag, innerFlag) => (isOuterEdge ? (outerFlag ? 'outer' : 'none') : innerFlag ? 'inner' : 'none');
    return {
        top: sideFor(rowStart === 0, outerH, innerH),
        bottom: sideFor(rowEnd === totalRows - 1, outerH, innerH),
        left: sideFor(colStart === 0, outerV, innerV),
        right: sideFor(colEnd === columnCount - 1, outerV, innerV),
    };
}
export function borderStyleForThickness(thickness, styles) {
    if (thickness >= 3)
        return styles.thick;
    if (thickness >= 2)
        return styles.medium;
    return styles.thin;
}
