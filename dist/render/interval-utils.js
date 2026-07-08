// Shared by shadow-dom.ts and pdf-render.ts for table border-line segment math — kept in one place
// so both renderers draw the exact same segments (colSpan/rowSpan straddle handling included)
// instead of re-deriving the interval math per backend.
export const BORDER_EPSILON = 0.01;
// Sorts and merges `holes` (each already normalized so start <= end), then returns the sub-ranges
// of `full` NOT covered by any hole — used to skip a border line across whatever span a colSpan/
// rowSpan cell covers, drawing only the surviving segments either side of it instead of one
// uninterrupted line.
export function subtractIntervals(full, holes) {
    const sorted = [...holes].map(([a, b]) => (a <= b ? [a, b] : [b, a])).sort((a, b) => a[0] - b[0]);
    const result = [];
    let cursor = full[0];
    for (const [start, end] of sorted) {
        if (end <= cursor)
            continue;
        if (start > cursor)
            result.push([cursor, Math.min(start, full[1])]);
        cursor = Math.max(cursor, end);
        if (cursor >= full[1])
            break;
    }
    if (cursor < full[1])
        result.push([cursor, full[1]]);
    return result.filter(([a, b]) => b - a > BORDER_EPSILON);
}
