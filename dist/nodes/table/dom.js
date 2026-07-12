// DOM rendering for TableNode — port of the old shadow-dom.ts's renderTableNode/renderTableBorders.
import { renderNodeDom } from "../../core/behavior.js";
import { styledDiv } from "../../render/shadow-dom.js";
import { BORDER_EPSILON, subtractIntervals } from "../../render/interval-utils.js";
import { resolveColumnWidths } from "./layout.js";
import { createHorizontalLineStyler, resolveBorderLine, resolveOuterBorderRadius } from "./border-resolve.js";
// Border modes render as single-thickness line segments (like a separator's own div), never a
// per-cell CSS `border` shorthand — that would double thickness at shared edges where two adjacent
// cells' own borders both draw at the same touching boundary. A colSpan/rowSpan cell's merged box
// must not have a divider line drawn through it either — see the cell-straddling check below, which
// naturally leaves the OUTER perimeter lines untouched too: a cell can never extend past the table's
// own edge, so it never "straddles" an outer boundary in the first place, only ever an inner one.
//
// `originX`/`originY` here is the SAME origin `rendered`'s own (x, y) was computed from — needed
// because `rendered.rows[].box` (unlike `colX`/`colWidths`, which are pure local offsets recomputed
// fresh here) is already fully origin-relative, exactly like a group's `children[].box` (see
// geometry.ts's `translateRendered` table branch, which shifts `rows[].box` by the same delta as the
// table's own box, in parallel — never nested). Adding it again on top of `y` (which already
// includes the table's own box offset) would double-count that offset.
// 'solid' fills a rect directly (exact geometry, matches every segment's own straddle-avoided
// extent flush). 'dashed'/'dotted' use a single-side `border` instead (native CSS border-style
// keywords), same technique as separator.ts's own renderDom.
function gridSegmentDiv(orientation, lineCoord, segStart, segEnd, thickness, color, style) {
    if (orientation === 'horizontal') {
        return styledDiv(style === 'solid'
            ? { left: `${segStart}px`, top: `${lineCoord}px`, width: `${segEnd - segStart}px`, height: `${thickness}px`, background: color }
            : { left: `${segStart}px`, top: `${lineCoord}px`, width: `${segEnd - segStart}px`, height: '0', borderTopWidth: `${thickness}px`, borderTopStyle: style, borderTopColor: color });
    }
    return styledDiv(style === 'solid'
        ? { left: `${lineCoord}px`, top: `${segStart}px`, width: `${thickness}px`, height: `${segEnd - segStart}px`, background: color }
        : { left: `${lineCoord}px`, top: `${segStart}px`, width: '0', height: `${segEnd - segStart}px`, borderLeftWidth: `${thickness}px`, borderLeftStyle: style, borderLeftColor: color });
}
function renderTableBorders(node, rendered, colWidths, colX, originX, originY, x, y, container, roundOuter) {
    const hasRowOverrides = rendered.rows.some(r => r.topBorder !== undefined || r.bottomBorder !== undefined);
    if (node.border === undefined && !hasRowOverrides)
        return;
    // `inner` (grid lines between rows/columns) and `outer` (the table's own perimeter) resolve fully
    // independently — see border-resolve.ts's own doc comment for the "object present = mode defaults
    // to all" rule. A row's own `topBorder`/`bottomBorder` (from `TableGroupLevel.headerBorder`/
    // `totalsBorder`, or hand-authored directly) draws independently of `node.border` entirely, same
    // as `TableCell.border` already does.
    const inner = resolveBorderLine(node.border, 'inner');
    const outer = resolveBorderLine(node.border, 'outer');
    const innerV = inner.mode === 'all' || inner.mode === 'vertical';
    const outerV = outer.mode === 'all' || outer.mode === 'vertical';
    const tableTop = y;
    const tableBottom = y + rendered.box.height;
    const tableLeft = x;
    const tableRight = x + rendered.box.width;
    const cellBox = (cell) => ({
        left: originX + cell.box.x,
        top: originY + cell.box.y,
        right: originX + cell.box.x + cell.box.width,
        bottom: originY + cell.box.y + cell.box.height,
    });
    // Absolute (origin-applied) boxes of every cell that has one — an ordinary 'cells' row, AND a
    // colSpan-aware 'header' row (see nodes.ts), which behaves exactly like an ordinary row for
    // border purposes (its cells only straddle the lines their own colSpan actually crosses, same as
    // any other cell). A `content`-shaped header (no `cells`) has none, handled separately below.
    const cellBoxes = rendered.rows.flatMap(row => (row.kind === 'header' ? (row.cells ?? []).map(cellBox) : row.cells.map(cellBox)));
    // A `content`-shaped 'header' row (a column-grouping header/divider bar with no per-column
    // cells) always spans the table's FULL width, so it "straddles" every inner VERTICAL line by
    // construction — unlike a cell, its horizontal extent never needs checking. It never straddles
    // an inner HORIZONTAL line: those sit exactly at row boundaries, which match a header row's own
    // top/bottom edges, never strictly inside its box (the straddle check below is strict), so no
    // horizontal-line handling is needed here. A `cells`-shaped header needs none of this special
    // casing — its cells are already covered by `cellBoxes` above, exactly like an ordinary row.
    const headerRowVRanges = rendered.rows
        .filter((row) => row.kind === 'header' && row.cells === undefined)
        .map(row => [originY + row.box.y, originY + row.box.y + row.box.height]);
    // Horizontal lines: style resolution (row override > headerSeparator > outer-position > inner)
    // is centralized in border-resolve.ts so this file and pdf.ts can't drift on the precedence rule.
    const { styler, candidateYs } = createHorizontalLineStyler({
        rows: rendered.rows,
        originY,
        tableTop,
        tableBottom,
        headerRows: node.headerRows ?? 0,
        headerSeparatorConfig: node.border?.headerSeparator,
        inner,
        outer,
        roundOuter,
    });
    for (const lineY of candidateYs) {
        const resolved = styler(lineY);
        if (resolved === null)
            continue;
        const straddling = cellBoxes.filter(b => b.top < lineY - BORDER_EPSILON && lineY + BORDER_EPSILON < b.bottom);
        const segments = subtractIntervals([tableLeft, tableRight], straddling.map(b => [b.left, b.right]));
        for (const [segStart, segEnd] of segments)
            container.appendChild(gridSegmentDiv('horizontal', lineY, segStart, segEnd, resolved.thickness, resolved.color, resolved.style));
    }
    const vLines = [];
    if (outerV && !roundOuter)
        vLines.push({ x: tableLeft, line: outer }, { x: tableRight, line: outer });
    if (innerV) {
        for (let i = 0; i < colWidths.length - 1; i++)
            vLines.push({ x: originX + colX[i] + colWidths[i], line: inner });
    }
    for (const { x: lineX, line } of vLines) {
        const straddling = cellBoxes.filter(b => b.left < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < b.right);
        // A header row's box is exactly [tableLeft, tableRight] — this same strict-inequality check
        // (mirroring the cell one above) is naturally false for the OUTER lines (lineX equals one of
        // the edges, never strictly between them) and true for every INNER line, so no separate
        // inner/outer branch is needed here.
        const headerHoles = tableLeft < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < tableRight ? headerRowVRanges : [];
        const segments = subtractIntervals([tableTop, tableBottom], [...straddling.map(b => [b.top, b.bottom]), ...headerHoles]);
        for (const [segStart, segEnd] of segments)
            container.appendChild(gridSegmentDiv('vertical', lineX, segStart, segEnd, line.thickness, line.color, line.style));
    }
}
// `originX`/`originY`, not `x`/`y`: `rendered.rows[].box` (and every cell's own box) is already
// fully origin-relative, the same convention a group's `children[].box` uses — see the comment on
// `renderTableBorders` above. Only the table's OWN box (`x`/`y`, derived once here) and the fresh
// local `colX`/`colWidths` offsets need `x`/`y`; everything read out of `rendered.rows` needs the
// original, un-offset origin.
export function renderTableNode(rendered, x, y, ctx) {
    const node = rendered.node;
    let { originX, originY, container } = ctx;
    const colWidths = resolveColumnWidths(node, rendered.box.width);
    const colX = [];
    let acc = 0;
    for (const w of colWidths) {
        colX.push(acc);
        acc += w;
    }
    const outer = resolveBorderLine(node.border, 'outer');
    const radius = resolveOuterBorderRadius(node.border);
    const roundOuter = outer.mode === 'all' && radius > 0;
    // Table wrapper: devtools parity only (per invariant #4 — same as group) UNLESS `roundOuter`, in
    // which case this becomes a REAL clip wrapper — the rounded outer border is its own CSS `border`
    // (replacing the 4 straight perimeter segments renderTableBorders would otherwise draw), and
    // `overflow: hidden` clips everything below to match.
    const wrapperStyle = { left: `${x}px`, top: `${y}px`, width: `${rendered.box.width}px`, height: `${rendered.box.height}px` };
    if (ctx.cursor !== undefined)
        wrapperStyle.cursor = ctx.cursor;
    if (roundOuter) {
        const r = Math.max(0, Math.min(radius, rendered.box.width / 2, rendered.box.height / 2));
        wrapperStyle.border = `${outer.thickness}px ${outer.style} ${outer.color}`;
        wrapperStyle.borderRadius = `${r}px`;
        wrapperStyle.overflow = 'hidden';
    }
    const wrapperEl = styledDiv(wrapperStyle);
    container.appendChild(wrapperEl);
    if (roundOuter) {
        // Deliberate, narrow exception to "DOM rendering is flat" (GUIDE.md invariant #4) — same
        // rebase-origin-into-a-real-wrapper technique container.ts's borderRadius clipping and
        // renderPreview() both use. Everything below (backgrounds/content/per-cell borders/inner grid
        // lines) becomes a REAL descendant of `wrapperEl`, in wrapper-local (0,0-based) coordinates, so
        // `overflow: hidden` actually clips square corners to the curve.
        originX -= x;
        originY -= y;
        container = wrapperEl;
        x = 0;
        y = 0;
        ctx = { container, originX, originY, unselectable: ctx.unselectable, cursor: ctx.cursor };
    }
    // Shared by an ordinary 'cells' row AND a colSpan-aware 'header' row (see nodes.ts) — same
    // per-cell background-then-content painting either way. Backgrounds use each cell's own FULL
    // extent (cell.box — column width × row height, pre-resolved at layout time), not the content
    // sub-box (cell.rendered.box).
    const renderCellsRow = (cells) => {
        for (const cell of cells) {
            if (cell.background === undefined)
                continue;
            container.appendChild(styledDiv({
                left: `${originX + cell.box.x}px`,
                top: `${originY + cell.box.y}px`,
                width: `${cell.box.width}px`,
                height: `${cell.box.height}px`,
                background: cell.background,
            }));
        }
        // Cell content — flat, never nested, same as a group's children (see invariant #4).
        for (const cell of cells)
            renderNodeDom(cell.rendered, originX, originY, ctx);
        // Per-cell border drawn last (on top of background/content), same ordering as the table-wide
        // border (drawn after every row below) — a plain CSS border on the cell's own full box,
        // independent of and NOT straddle-avoided against the table-wide border modes (see
        // TableCell.border's doc comment: two adjacent bordered cells double up, by design).
        for (const cell of cells) {
            if (cell.border === undefined)
                continue;
            container.appendChild(styledDiv({
                left: `${originX + cell.box.x}px`,
                top: `${originY + cell.box.y}px`,
                width: `${cell.box.width}px`,
                height: `${cell.box.height}px`,
                border: `${cell.border.thickness ?? 1}px ${cell.border.style ?? 'solid'} ${cell.border.color ?? '#000000'}`,
            }));
        }
    };
    for (const row of rendered.rows) {
        if (row.kind === 'header') {
            if (row.cells !== undefined) {
                renderCellsRow(row.cells);
                continue;
            }
            if (row.background !== undefined) {
                container.appendChild(styledDiv({
                    left: `${originX + row.box.x}px`,
                    top: `${originY + row.box.y}px`,
                    width: `${row.box.width}px`,
                    height: `${row.box.height}px`,
                    background: row.background,
                }));
            }
            renderNodeDom(row.content, originX, originY, ctx);
            continue;
        }
        renderCellsRow(row.cells);
    }
    renderTableBorders(node, rendered, colWidths, colX, originX, originY, x, y, container, roundOuter);
}
