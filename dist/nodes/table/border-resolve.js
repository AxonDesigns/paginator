// Shared, framework-agnostic style resolution for TableNode.border — both table/dom.ts and
// table/pdf.ts draw against this so the two independently-implemented renderers can't silently
// drift on the precedence rule between a row's own accent border, `border.headerSeparator`, and
// the table-wide `border.inner`/`border.outer` lines. The actual drawing (styled divs vs pdfkit
// calls) stays duplicated in each renderer, same as the rest of that deliberate twin structure.
import { BORDER_EPSILON } from "../../render/interval-utils.js";
function resolveContainerBorder(b) {
    return { thickness: b.thickness ?? 1, color: b.color ?? '#000000', style: b.style ?? 'solid' };
}
// `border.inner`/`border.outer` each default to mode 'all' whenever `border` itself is present
// (even with that one sub-object entirely absent) — the same "object present = mode defaults to
// all" rule the old single `border.mode` used, now applied to each group independently. If `border`
// itself is undefined, both groups resolve to 'none' (no borders at all, as before).
export function resolveBorderLine(border, group) {
    if (border === undefined)
        return { mode: 'none', thickness: 1, color: '#000000', style: 'solid' };
    const line = border[group];
    return { mode: line?.mode ?? 'all', thickness: line?.thickness ?? 1, color: line?.color ?? '#000000', style: line?.style ?? 'solid' };
}
export function resolveOuterBorderRadius(border) {
    return border?.outer?.borderRadius ?? 0;
}
function resolveHeaderSeparator(headerSeparator, inner) {
    if (headerSeparator === undefined || headerSeparator === false)
        return undefined;
    if (headerSeparator === true)
        return inner;
    return resolveContainerBorder(headerSeparator);
}
// Row order matters for the tie-break at a boundary shared by two adjacent rows: row i's own
// `bottomBorder` is pushed before row i+1's `topBorder` is even considered, so `.find()` (first
// match, in `styleForY` below) makes row i's bottomBorder win — a totals row's own closing rule
// "belongs" to it more than the next section's opening rule. Don't reorder this without
// re-checking that guarantee.
function collectRowOverrides(rows, originY) {
    const overrides = [];
    for (const row of rows) {
        if (row.topBorder !== undefined)
            overrides.push({ y: originY + row.box.y, line: resolveContainerBorder(row.topBorder) });
        if (row.bottomBorder !== undefined)
            overrides.push({ y: originY + row.box.y + row.box.height, line: resolveContainerBorder(row.bottomBorder) });
    }
    return overrides;
}
// Precomputes everything needed to resolve, for any candidate Y, which line style (if any) draws
// there. Precedence at a given Y (most-specific wins): a row's own topBorder/bottomBorder >
// `border.headerSeparator` > the outer perimeter's own style (only when Y is an outer position) >
// the ordinary inner grid style. Returns null from the styler when nothing applies (e.g. an inner
// position while `inner.mode` doesn't draw that axis, with no override/separator at that exact Y).
//
// `roundOuter`: when the outer perimeter is drawn separately as a rounded stroke/clip-wrapper (see
// dom.ts/pdf.ts's own `roundOuter` handling), the ordinary straight outer-position draw is skipped
// here to avoid double-drawing it — EXCEPT a row's own override still draws straight at that exact
// Y even then (a known, documented cosmetic limitation: an accent border landing on row 0 or the
// last row isn't itself clipped to the curve).
export function createHorizontalLineStyler(args) {
    const { rows, originY, tableTop, tableBottom, headerRows, headerSeparatorConfig, inner, outer, roundOuter } = args;
    const overrides = collectRowOverrides(rows, originY);
    const headerSep = resolveHeaderSeparator(headerSeparatorConfig, inner);
    const headerBoundaryY = headerSep !== undefined && headerRows > 0 && headerRows < rows.length ? originY + rows[headerRows - 1].box.y + rows[headerRows - 1].box.height : undefined;
    const innerH = inner.mode === 'all' || inner.mode === 'horizontal';
    const outerH = outer.mode === 'all' || outer.mode === 'horizontal';
    const candidateYs = new Set();
    candidateYs.add(tableTop);
    candidateYs.add(tableBottom);
    for (let i = 0; i < rows.length - 1; i++)
        candidateYs.add(originY + rows[i].box.y + rows[i].box.height);
    for (const o of overrides)
        candidateYs.add(o.y);
    if (headerBoundaryY !== undefined)
        candidateYs.add(headerBoundaryY);
    const near = (a, b) => Math.abs(a - b) < BORDER_EPSILON;
    const styler = y => {
        const override = overrides.find(o => near(o.y, y));
        if (override !== undefined)
            return override.line;
        if (headerBoundaryY !== undefined && near(headerBoundaryY, y))
            return headerSep;
        const isOuterY = near(y, tableTop) || near(y, tableBottom);
        if (isOuterY)
            return roundOuter ? null : outerH ? outer : null;
        return innerH ? inner : null;
    };
    return { styler, candidateYs: Array.from(candidateYs) };
}
