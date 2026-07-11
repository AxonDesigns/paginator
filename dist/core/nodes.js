// Public document-tree node types and builder functions.
import { DEFAULT_FONT_FAMILY } from "../render/font-registry.js";
// Phase 2 (not built here): a generic CustomNode escape hatch — added as a new union member plus a
// new registry entry in behavior.ts, with no change required to paginate.ts or group-layout.ts.
export function definePage(config, body) {
    return { ...config, body };
}
export function group(config, children) {
    return { type: 'group', ...config, children };
}
export function text(config) {
    const lineHeight = config.lineHeight ?? Math.round(config.fontSize * 1.2);
    return { type: 'text', ...config, lineHeight };
}
export function richText(config) {
    const lineHeight = config.lineHeight ?? Math.round(config.fontSize * 1.2);
    return { type: 'richText', ...config, lineHeight };
}
export function separator(config) {
    return { type: 'separator', ...config };
}
/**
 * Forces a page break at this point in the document flow. Redundant/leading breaks (nothing has
 * been placed on the current page yet) are silently no-ops rather than producing a blank page —
 * only meaningful inside COLUMN-direction structure; has no effect as a row's column.
 */
export function pageBreak() {
    return { type: 'page-break' };
}
export function image(config) {
    const hasHeight = config.height !== undefined;
    const hasAspectRatio = config.aspectRatio !== undefined;
    if (!hasHeight && !hasAspectRatio) {
        throw new Error('[paginator] image() needs "height" or "aspectRatio" to determine its height — image dimensions are never auto-detected from the loaded asset.');
    }
    return { type: 'image', ...config };
}
export function svg(config) {
    if (!config.markup.includes('<svg')) {
        throw new Error('[paginator] svg() "markup" does not look like an SVG document — expected a string containing an "<svg" root element.');
    }
    const hasHeight = config.height !== undefined;
    const hasAspectRatio = config.aspectRatio !== undefined;
    if (!hasHeight && !hasAspectRatio) {
        throw new Error('[paginator] svg() needs "height" or "aspectRatio" to determine its height — dimensions are never auto-detected from the markup.');
    }
    return { type: 'svg', ...config };
}
export function container(config, child) {
    return { type: 'container', ...config, child };
}
// A plain-text preview of a `ChartText` value for use ONLY in chart()'s own error messages (never
// for rendering) — a rich `ChartTextRun[]` has no single obvious "the text," so this concatenates
// every run's own text in order, ignoring styling entirely.
function chartTextPreview(content) {
    if (content === undefined)
        return '';
    if (typeof content === 'string')
        return content;
    return content.map(r => r.text).join('');
}
// A `ChartTextRun[]` with zero runs has nothing to render and no single sensible "the text" for
// error messages either — thrown for every REQUIRED label field (optional `name?`/`title?` fields
// simply render nothing when omitted entirely, so an empty array there is comparatively harmless
// and left unvalidated, same leniency this codebase gives other optional cosmetic fields).
function assertNonEmptyChartText(content, fieldDescription) {
    if (Array.isArray(content) && content.length === 0) {
        throw new Error(`[paginator] chart() ${fieldDescription} is an empty array — a ChartTextRun[] must have at least one run.`);
    }
}
export function chart(config) {
    const hasHeight = config.height !== undefined;
    const hasAspectRatio = config.aspectRatio !== undefined;
    if (!hasHeight && !hasAspectRatio) {
        throw new Error('[paginator] chart() needs "height" or "aspectRatio" to determine its height — chart dimensions are never auto-detected.');
    }
    // Cast used only for the cross-branch defensive checks below: a plain-JS caller isn't held to
    // the bar/line-vs-pie/donut split the types now enforce, so these still need to inspect fields
    // the narrowed type says shouldn't exist on the other branch.
    const raw = config;
    if (config.chartKind === 'categorical') {
        if (raw.slices !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "categorical" cannot use "slices" — use "categories"/"series" instead.`);
        }
        if (config.categories === undefined || config.categories.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "categorical" needs a non-empty "categories" array.`);
        }
        config.categories.forEach((c, ci) => assertNonEmptyChartText(c, `categories[${ci}]`));
        if (config.series === undefined || config.series.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "categorical" needs a non-empty "series" array.`);
        }
        config.series.forEach((s, i) => {
            const namePreview = chartTextPreview(s.name);
            const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`;
            if (s.data.length !== config.categories.length) {
                throw new Error(`[paginator] chart() series ${label} has ${s.data.length} data points, expected ${config.categories.length} (one per category).`);
            }
            const kind = s.kind ?? 'bar';
            if (s.fill !== undefined && kind !== 'line') {
                throw new Error(`[paginator] chart() series ${label} sets "fill", which only applies to a 'line'-kind series (this series is "${kind}").`);
            }
            if (typeof s.fill === 'object' && s.fill.opacity !== undefined && (s.fill.opacity < 0 || s.fill.opacity > 1)) {
                throw new Error(`[paginator] chart() series ${label} "fill.opacity" must be in [0, 1], got ${s.fill.opacity}.`);
            }
            if (s.curve !== undefined && kind !== 'line' && kind !== 'points') {
                throw new Error(`[paginator] chart() series ${label} sets "curve", which only applies to a 'line'/'points'-kind series (this series is "${kind}").`);
            }
            if (s.strokeWidth !== undefined && kind !== 'line') {
                throw new Error(`[paginator] chart() series ${label} sets "strokeWidth", which only applies to a 'line'-kind series (this series is "${kind}").`);
            }
            if (s.markerRadius !== undefined && kind !== 'line' && kind !== 'points') {
                throw new Error(`[paginator] chart() series ${label} sets "markerRadius", which only applies to a 'line'/'points'-kind series (this series is "${kind}").`);
            }
        });
        if (config.barSegmentGap !== undefined && config.barSegmentGap < 0) {
            throw new Error(`[paginator] chart() "barSegmentGap" must be non-negative, got ${config.barSegmentGap}.`);
        }
        const domain = config.view?.domain;
        if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
            throw new Error(`[paginator] chart() "view.domain.min" (${domain.min}) must be less than "view.domain.max" (${domain.max}).`);
        }
        if (config.view?.padding !== undefined && config.view.padding < 0) {
            throw new Error(`[paginator] chart() "view.padding" must be non-negative, got ${config.view.padding}.`);
        }
    }
    else if (config.chartKind === 'radial') {
        if (raw.categories !== undefined || raw.series !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "radial" cannot use "categories"/"series" — use "rings" instead.`);
        }
        if (raw.slices !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "radial" has no top-level "slices" — author a single-ring pie as "rings: [{ slices: [...] }]".`);
        }
        if (config.rings === undefined || config.rings.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "radial" needs a non-empty "rings" array.`);
        }
        config.rings.forEach((ring, ri) => {
            if (ring.slices === undefined || ring.slices.length === 0) {
                throw new Error(`[paginator] chart() ring ${ri} needs a non-empty "slices" array.`);
            }
            ring.slices.forEach((s, si) => {
                assertNonEmptyChartText(s.label, `ring ${ri} slice ${si} "label"`);
                if (!Number.isFinite(s.value) || s.value < 0) {
                    throw new Error(`[paginator] chart() ring ${ri} slice ${si} ("${chartTextPreview(s.label)}") needs a non-negative finite "value", got ${s.value}.`);
                }
            });
            if (ri === 0) {
                if (ring.slices.some(s => s.parentIndex !== undefined)) {
                    throw new Error(`[paginator] chart() ring 0 slices cannot set "parentIndex" — there is no ring inside the innermost ring.`);
                }
            }
            else {
                const parentedCount = ring.slices.filter(s => s.parentIndex !== undefined).length;
                if (parentedCount > 0 && parentedCount < ring.slices.length) {
                    throw new Error(`[paginator] chart() ring ${ri} mixes slices with and without "parentIndex" — a ring must be either fully hierarchical (every slice has a parentIndex) or fully flat (none do).`);
                }
                const previousRingSliceCount = config.rings[ri - 1].slices.length;
                ring.slices.forEach((s, si) => {
                    if (s.parentIndex !== undefined && (s.parentIndex < 0 || s.parentIndex >= previousRingSliceCount || !Number.isInteger(s.parentIndex))) {
                        throw new Error(`[paginator] chart() ring ${ri} slice ${si} "parentIndex" (${s.parentIndex}) is out of bounds for ring ${ri - 1}, which has ${previousRingSliceCount} slice(s).`);
                    }
                });
            }
            if (ring.sliceGap !== undefined && ring.sliceGap < 0) {
                throw new Error(`[paginator] chart() ring ${ri} "sliceGap" must be non-negative, got ${ring.sliceGap}.`);
            }
        });
        if (config.innerRadiusRatio !== undefined && (config.innerRadiusRatio < 0 || config.innerRadiusRatio >= 1)) {
            throw new Error(`[paginator] chart() "innerRadiusRatio" must be in [0, 1), got ${config.innerRadiusRatio}.`);
        }
        if (config.sliceGap !== undefined && config.sliceGap < 0) {
            throw new Error(`[paginator] chart() "sliceGap" must be non-negative, got ${config.sliceGap}.`);
        }
    }
    else if (config.chartKind === 'scatter') {
        if (raw.categories !== undefined || raw.slices !== undefined || raw.rings !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "scatter" cannot use "categories"/"slices"/"rings" — use "series" (with per-point x/y) instead.`);
        }
        if (config.series === undefined || config.series.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "scatter" needs a non-empty "series" array.`);
        }
        config.series.forEach((s, i) => {
            const namePreview = chartTextPreview(s.name);
            const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`;
            if (s.points === undefined || s.points.length === 0) {
                throw new Error(`[paginator] chart() series ${label} needs a non-empty "points" array.`);
            }
            s.points.forEach((p, pi) => {
                if (p.size !== undefined && p.size < 0) {
                    throw new Error(`[paginator] chart() series ${label} point ${pi} "size" must be non-negative, got ${p.size}.`);
                }
            });
        });
        if (config.sizeScale?.range !== undefined) {
            const [rMin, rMax] = config.sizeScale.range;
            if (rMin < 0 || rMax < 0 || rMin >= rMax) {
                throw new Error(`[paginator] chart() "sizeScale.range" must be [min, max] with 0 <= min < max, got [${rMin}, ${rMax}].`);
            }
        }
        for (const [key, view] of [['xView', config.xView], ['yView', config.yView]]) {
            const domain = view?.domain;
            if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
                throw new Error(`[paginator] chart() "${key}.domain.min" (${domain.min}) must be less than "${key}.domain.max" (${domain.max}).`);
            }
            if (view?.padding !== undefined && view.padding < 0) {
                throw new Error(`[paginator] chart() "${key}.padding" must be non-negative, got ${view.padding}.`);
            }
        }
    }
    else if (config.chartKind === 'gantt') {
        if (raw.categories !== undefined || raw.slices !== undefined || raw.rings !== undefined || raw.series !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "gantt" cannot use "categories"/"slices"/"rings"/"series" — use "tasks" instead.`);
        }
        if (config.tasks === undefined || config.tasks.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "gantt" needs a non-empty "tasks" array.`);
        }
        config.tasks.forEach((t, i) => {
            assertNonEmptyChartText(t.label, `task ${i} "label"`);
            if (t.end < t.start) {
                throw new Error(`[paginator] chart() task ${i} ("${chartTextPreview(t.label)}") has "end" (${t.end}) before "start" (${t.start}).`);
            }
        });
        const domain = config.xView?.domain;
        if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
            throw new Error(`[paginator] chart() "xView.domain.min" (${domain.min}) must be less than "xView.domain.max" (${domain.max}).`);
        }
        if (config.xView?.padding !== undefined && config.xView.padding < 0) {
            throw new Error(`[paginator] chart() "xView.padding" must be non-negative, got ${config.xView.padding}.`);
        }
        if (config.rowHeight !== undefined && config.rowHeight <= 0) {
            throw new Error(`[paginator] chart() "rowHeight" must be positive, got ${config.rowHeight}.`);
        }
    }
    else if (config.chartKind === 'radar') {
        if (raw.slices !== undefined || raw.rings !== undefined || raw.tasks !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "radar" cannot use "slices"/"rings"/"tasks" — use "categories"/"series" instead.`);
        }
        if (config.categories === undefined || config.categories.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "radar" needs a non-empty "categories" array.`);
        }
        config.categories.forEach((c, ci) => assertNonEmptyChartText(c, `categories[${ci}]`));
        if (config.series === undefined || config.series.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "radar" needs a non-empty "series" array.`);
        }
        config.series.forEach((s, i) => {
            const namePreview = chartTextPreview(s.name);
            const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`;
            if (s.data.length !== config.categories.length) {
                throw new Error(`[paginator] chart() series ${label} has ${s.data.length} data points, expected ${config.categories.length} (one per category).`);
            }
            if (typeof s.fill === 'object' && s.fill.opacity !== undefined && (s.fill.opacity < 0 || s.fill.opacity > 1)) {
                throw new Error(`[paginator] chart() series ${label} "fill.opacity" must be in [0, 1], got ${s.fill.opacity}.`);
            }
        });
        const domain = config.view?.domain;
        if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
            throw new Error(`[paginator] chart() "view.domain.min" (${domain.min}) must be less than "view.domain.max" (${domain.max}).`);
        }
        if (config.view?.padding !== undefined && config.view.padding < 0) {
            throw new Error(`[paginator] chart() "view.padding" must be non-negative, got ${config.view.padding}.`);
        }
        if (config.markerRadius !== undefined && config.markerRadius < 0) {
            throw new Error(`[paginator] chart() "markerRadius" must be non-negative, got ${config.markerRadius}.`);
        }
    }
    else if (config.chartKind === 'candlestick') {
        if (raw.slices !== undefined || raw.rings !== undefined || raw.tasks !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "candlestick" cannot use "slices"/"rings"/"tasks" — use "categories"/"series" instead.`);
        }
        if (config.categories === undefined || config.categories.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "candlestick" needs a non-empty "categories" array.`);
        }
        config.categories.forEach((c, ci) => assertNonEmptyChartText(c, `categories[${ci}]`));
        if (config.series === undefined || config.series.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "candlestick" needs a non-empty "series" array.`);
        }
        config.series.forEach((s, i) => {
            const namePreview = chartTextPreview(s.name);
            const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`;
            if (s.data.length !== config.categories.length) {
                throw new Error(`[paginator] chart() series ${label} has ${s.data.length} candles, expected ${config.categories.length} (one per category).`);
            }
            s.data.forEach((c, ci) => {
                if (c.low > Math.min(c.open, c.close)) {
                    throw new Error(`[paginator] chart() series ${label} candle ${ci} "low" (${c.low}) must be <= min(open, close) (${Math.min(c.open, c.close)}).`);
                }
                if (c.high < Math.max(c.open, c.close)) {
                    throw new Error(`[paginator] chart() series ${label} candle ${ci} "high" (${c.high}) must be >= max(open, close) (${Math.max(c.open, c.close)}).`);
                }
            });
        });
        if (config.candleWidth !== undefined && config.candleWidth < 0) {
            throw new Error(`[paginator] chart() "candleWidth" must be non-negative, got ${config.candleWidth}.`);
        }
        if (config.wickWidth !== undefined && config.wickWidth < 0) {
            throw new Error(`[paginator] chart() "wickWidth" must be non-negative, got ${config.wickWidth}.`);
        }
        const domain = config.view?.domain;
        if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
            throw new Error(`[paginator] chart() "view.domain.min" (${domain.min}) must be less than "view.domain.max" (${domain.max}).`);
        }
        if (config.view?.padding !== undefined && config.view.padding < 0) {
            throw new Error(`[paginator] chart() "view.padding" must be non-negative, got ${config.view.padding}.`);
        }
    }
    else {
        // chartKind === 'treemap'
        if (raw.categories !== undefined || raw.series !== undefined || raw.slices !== undefined || raw.rings !== undefined || raw.tasks !== undefined) {
            throw new Error(`[paginator] chart() with chartKind "treemap" cannot use "categories"/"series"/"slices"/"rings"/"tasks" — use "items" instead.`);
        }
        if (config.items === undefined || config.items.length === 0) {
            throw new Error(`[paginator] chart() with chartKind "treemap" needs a non-empty "items" array.`);
        }
        config.items.forEach((item, i) => {
            assertNonEmptyChartText(item.label, `item ${i} "label"`);
            if (!Number.isFinite(item.value) || item.value < 0) {
                throw new Error(`[paginator] chart() item ${i} ("${chartTextPreview(item.label)}") needs a non-negative finite "value", got ${item.value}.`);
            }
        });
        if (config.itemGap !== undefined && config.itemGap < 0) {
            throw new Error(`[paginator] chart() "itemGap" must be non-negative, got ${config.itemGap}.`);
        }
    }
    return { type: 'chart', ...config };
}
function defaultGroupHeader(value) {
    return text({ content: value, fontFamily: DEFAULT_FONT_FAMILY, fontSize: 12, fontWeight: 700, lineHeight: 15 });
}
// Stable "global regroup by value": every row appends to its value's bucket regardless of its
// position in `rows` (not just adjacent runs), while bucket ORDER follows each distinct value's
// first appearance — see GUIDE.md's "Column grouping" section for why this was chosen over
// contiguous-run grouping.
function stableGroupBy(rows, level) {
    const order = [];
    const buckets = new Map();
    for (const row of rows) {
        if (row.kind === 'header')
            continue; // unreachable — applyGroupingRows() rejects header rows upfront when grouping is configured
        const value = row.groupValues?.[level] ?? '';
        if (!buckets.has(value)) {
            buckets.set(value, []);
            order.push(value);
        }
        buckets.get(value).push(row);
    }
    return order.map(value => ({ value, rows: buckets.get(value) }));
}
// A rowSpan cluster's physical rows must agree on every group level's value — otherwise bucketing
// (which only ever FILTERS rows into buckets, never reorders them) would have no choice but to
// interleave a synthesized header/totals row into the middle of an atomic cluster, corrupting the
// contiguous row range resolveRowHeights()/tableMeasurer.split() (table-layout.ts) assume a cluster
// occupies. Checked once, covering every level, before any bucketing begins — sufficient to
// guarantee bucketing never splits a cluster apart at any nesting depth, since a cluster's rows
// (physically contiguous already) can only ever be filtered together into the same bucket if they
// all share that bucket's value.
function validateGroupClusterConstancy(rows, levelCount) {
    let clusterStart = 0;
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row.kind === 'header')
            throw new Error('[paginator] unreachable: header row found where only data rows were expected');
        if (!(row.__atomicWithNext ?? false)) {
            for (let k = clusterStart; k < r; k++) {
                const first = rows[clusterStart];
                const other = rows[k + 1];
                for (let level = 0; level < levelCount; level++) {
                    if (other.groupValues[level] !== first.groupValues[level]) {
                        throw new Error(`[paginator] table() rows ${clusterStart}..${r} form a rowSpan cluster but disagree on group values ("${first.groupValues[level]}" vs "${other.groupValues[level]}" at level ${level}) — a rowSpan cluster must share the same group values throughout.`);
                    }
                }
            }
            clusterStart = r + 1;
        }
    }
}
// Desugars `TableNode.groups` into a plain, already-flat array of TableRow: no more `groups` levels,
// rows already bucketed with synthesized header/totals rows woven in. table-layout.ts, geometry.ts,
// shadow-dom.ts, and hit-registry.ts operate on the OUTPUT of table() only — none of them need to
// know grouping happened. Called once at build time, never inside the measurer, so `rest`
// reconstruction across page splits needs no special handling: by the time a table reaches page 2,
// it's already desugared. Pure row-array transform — the caller (table()) is responsible for
// slicing header rows out of `rows` beforehand, validating `groupValues` presence/length and cluster
// constancy, and rejecting a manually-authored `kind: 'header'` row among `rows`.
function applyGroupingRows(rows, groups, repeatGroupHeadersDefault, columnCount) {
    function recurse(rows, level) {
        // Leaf case: no more levels to bucket by. MUST be a literal pass-through, not a per-row
        // reconstructed object — rows may carry `__atomicWithNext`, and cells may carry `__resolvedCol`,
        // both baked in by resolveCellSpans() upstream; reconstructing the row object here would
        // silently drop whichever of those fields this function doesn't know to copy, with no test that
        // would catch the regression (no prior coverage of "spans + grouping in the same table").
        if (level >= groups.length)
            return rows;
        const groupConfig = groups[level];
        const out = [];
        for (const bucket of stableGroupBy(rows, level)) {
            const headerResult = groupConfig.header?.(bucket.value, bucket.rows) ?? defaultGroupHeader(bucket.value);
            if (Array.isArray(headerResult)) {
                // Resolved through the same implicit-flow tiling a totals() row gets (see there) — a
                // header can use colSpan across its cells too, column-grid-aligned instead of indented by
                // depth. `rowSpan` has nothing to span into (a header is always exactly one row) and
                // surfaces as the same "extends past the last row" throw resolveCellSpans() already gives.
                let resolved;
                try {
                    ;
                    [resolved] = resolveCellSpans([{ cells: headerResult }], columnCount);
                }
                catch (e) {
                    throw new Error(`[paginator] table() group "${bucket.value}" (level ${level})'s header(): ${e.message}`);
                }
                if (resolved.kind === 'header')
                    throw new Error('[paginator] unreachable: resolveCellSpans() never returns a header-kind row');
                out.push({
                    kind: 'header',
                    depth: level,
                    cells: resolved.cells,
                    background: groupConfig.background,
                    repeat: groupConfig.repeat ?? repeatGroupHeadersDefault,
                    topBorder: groupConfig.headerBorder?.top,
                    bottomBorder: groupConfig.headerBorder?.bottom,
                });
            }
            else {
                out.push({
                    kind: 'header',
                    depth: level,
                    content: headerResult,
                    background: groupConfig.background,
                    repeat: groupConfig.repeat ?? repeatGroupHeadersDefault,
                    topBorder: groupConfig.headerBorder?.top,
                    bottomBorder: groupConfig.headerBorder?.bottom,
                });
            }
            out.push(...recurse(bucket.rows, level + 1));
            if (groupConfig.totals !== undefined) {
                const totalsCells = groupConfig.totals(bucket.rows);
                // Resolved the same way as an ordinary body row — a totals row can use colSpan across its
                // cells (e.g. a label spanning two columns, then a figure in the last one) via the same
                // implicit-flow tiling `resolveCellSpans()` already gives body rows; content-presence and
                // occupancy validation come along for free from that one call. `rowSpan` on a totals cell
                // has nothing to span into (it's always exactly one row) and falls out as a natural
                // "extends past the last row of the table" throw from the same call. `topBorder`/
                // `bottomBorder` are passed on the INPUT row (not bolted onto the output afterward) —
                // resolveCellSpans() spreads `...row` first before overwriting `kind`/`cells`/
                // `__atomicWithNext`, so they survive untouched, exactly like `groupValues` already does
                // when spans and grouping coexist (see that function's own header comment).
                let totalsRow;
                try {
                    ;
                    [totalsRow] = resolveCellSpans([{ cells: totalsCells, topBorder: groupConfig.totalsBorder?.top, bottomBorder: groupConfig.totalsBorder?.bottom }], columnCount);
                }
                catch (e) {
                    throw new Error(`[paginator] table() group "${bucket.value}" (level ${level})'s totals(): ${e.message}`);
                }
                out.push(totalsRow);
            }
        }
        return out;
    }
    return recurse(rows, 0);
}
// Resolves implicit HTML-table-like colSpan/rowSpan authoring into explicit grid positions: bakes
// `__resolvedCol` onto every cell and `__atomicWithNext` onto every row — see GUIDE.md's "Cell
// spans" section. Pure row-array transform, mirroring applyGroupingRows's shape. The caller
// (table()) is responsible for slicing any literal header-row prefix out of `rows` beforehand
// (spanning is never attempted there) and for the mutual-exclusion throws (column grouping,
// manually-authored `kind: 'header'` rows).
function resolveCellSpans(rows, columnCount) {
    const occupancy = new Array(columnCount).fill(null);
    const result = rows.map((row, r) => {
        if (row.kind === 'header')
            throw new Error('[paginator] unreachable: header row found where only data rows were expected');
        let colCursor = 0;
        const resolvedCells = row.cells.map(cell => {
            const colSpan = cell.colSpan ?? 1;
            const rowSpan = cell.rowSpan ?? 1;
            if (!Number.isInteger(colSpan) || colSpan < 1) {
                throw new Error(`[paginator] table() row ${r}: colSpan must be a positive integer, got ${colSpan}`);
            }
            if (!Number.isInteger(rowSpan) || rowSpan < 1) {
                throw new Error(`[paginator] table() row ${r}: rowSpan must be a positive integer, got ${rowSpan}`);
            }
            if (cell.content === undefined) {
                throw new Error(`[paginator] table() row ${r}: cell needs "content"`);
            }
            // Advance past columns already occupied by an earlier row's rowSpan.
            while (colCursor < columnCount && occupancy[colCursor] !== null)
                colCursor++;
            if (colCursor + colSpan > columnCount) {
                throw new Error(`[paginator] table() row ${r}: cell needs ${colSpan} column(s) starting at column ${colCursor}, but the table only has ${columnCount} columns`);
            }
            const resolvedCol = colCursor;
            for (let c = colCursor; c < colCursor + colSpan; c++) {
                occupancy[c] = { remaining: rowSpan, originRow: r, originCol: resolvedCol };
            }
            colCursor += colSpan;
            return { ...cell, __resolvedCol: resolvedCol };
        });
        // Keep advancing through any remaining TRAILING occupied columns before checking the row fully
        // tiled the grid — a trailing gap that's occupied by an earlier rowSpan is fine; only a
        // genuinely unfilled, non-occupied column is a real "too few cells" error.
        while (colCursor < columnCount && occupancy[colCursor] !== null)
            colCursor++;
        if (colCursor !== columnCount) {
            throw new Error(`[paginator] table() row ${r} has too few cells — column ${colCursor} is neither filled by this row nor occupied by an earlier rowSpan`);
        }
        // This row can't be separated from the next by a page cut if any column's rowSpan still has at
        // least one more row left to cover after this one.
        const atomicWithNext = occupancy.some(o => o !== null && o.remaining > 1);
        for (let c = 0; c < columnCount; c++) {
            const o = occupancy[c];
            if (o !== null) {
                o.remaining--;
                if (o.remaining <= 0)
                    occupancy[c] = null;
            }
        }
        // Spread `row` first (not a hand-picked field list) so any field this function doesn't know
        // about — `groupValues` in particular, when spans and grouping coexist in the same table —
        // passes through untouched instead of being silently dropped by a reconstructed literal.
        return { ...row, kind: 'cells', cells: resolvedCells, __atomicWithNext: atomicWithNext };
    });
    const dangling = occupancy.find((o) => o !== null);
    if (dangling !== undefined) {
        throw new Error(`[paginator] table() cell at row ${dangling.originRow}, column ${dangling.originCol} has a rowSpan that extends past the last row of the table`);
    }
    return result;
}
/**
 * Convenience for a rowSpan cluster's physical rows that all belong to the same group bucket: they
 * must share identical `groupValues` (see "Column grouping" in GUIDE.md's cluster-constancy rule),
 * so instead of repeating the same array by hand on every row, spread it once here. Purely an
 * authoring shortcut — it doesn't change what `table()` validates; the cluster-constancy check
 * still runs on the result exactly as if you'd set `groupValues` on each row yourself.
 */
export function rowGroup(groupValues, rows) {
    return rows.map(row => ({ ...row, groupValues }));
}
export function table(config) {
    const hasGroups = (config.groups?.length ?? 0) > 0;
    const hasStripe = config.stripe !== undefined;
    if (config.border?.outer?.borderRadius !== undefined) {
        const resolvedOuterMode = config.border.outer.mode ?? 'all';
        if (resolvedOuterMode !== 'all') {
            throw new Error(`[paginator] table() border.outer.borderRadius needs border.outer.mode "all" (got "${resolvedOuterMode}") — no rectangular outer perimeter exists to round otherwise`);
        }
        if (config.border.outer.borderRadius < 0) {
            throw new Error('[paginator] table() border.outer.borderRadius cannot be negative');
        }
    }
    if ((config.border?.inner?.thickness ?? 0) < 0) {
        throw new Error('[paginator] table() border.inner.thickness cannot be negative');
    }
    if ((config.border?.outer?.thickness ?? 0) < 0) {
        throw new Error('[paginator] table() border.outer.thickness cannot be negative');
    }
    if (typeof config.border?.headerSeparator === 'object' && (config.border.headerSeparator.thickness ?? 0) < 0) {
        throw new Error('[paginator] table() border.headerSeparator.thickness cannot be negative');
    }
    config.groups?.forEach((g, level) => {
        if (g.totalsBorder !== undefined && g.totals === undefined) {
            throw new Error(`[paginator] table() groups[${level}].totalsBorder requires groups[${level}].totals to be set — there's no totals row to attach it to`);
        }
    });
    const hasAnySpan = config.rows.some(row => row.kind !== 'header' && row.cells.some(c => (c.colSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1));
    if (hasAnySpan && config.rows.some(r => r.kind === 'header')) {
        throw new Error('[paginator] table() cannot combine colSpan/rowSpan with a manually-authored `kind: "header"` row in the same table.');
    }
    // `cells` on a header row is only ever produced by TableGroupLevel.header() returning
    // TableCell[] (applyGroupingRows() resolves it there) — a hand-authored banner row always uses
    // `content`, so this can only fire on a row the caller wrote directly.
    if (config.rows.some(r => r.kind === 'header' && r.cells !== undefined)) {
        throw new Error('[paginator] table() a manually-authored `kind: "header"` row must use "content", not "cells" — "cells" is only produced by `TableGroupLevel.header()`.');
    }
    const columnsWithContent = config.columns.filter(c => c.content !== undefined);
    const useAutoHeader = columnsWithContent.length > 0;
    if (useAutoHeader && columnsWithContent.length !== config.columns.length) {
        throw new Error('[paginator] table() either every column defines "content" (for the auto-generated header row) or none do — partial adoption is not allowed.');
    }
    if (useAutoHeader && config.headerRows !== undefined && config.headerRows > 0) {
        throw new Error('[paginator] table() cannot combine per-column "content" (auto header row) with an explicit "headerRows" — use one or the other.');
    }
    const manualHeaderRowCount = useAutoHeader ? 0 : (config.headerRows ?? 0);
    if (manualHeaderRowCount > config.rows.length) {
        throw new Error('[paginator] table() headerRows cannot exceed the number of rows');
    }
    config.rows.forEach((row, i) => {
        if (row.kind === 'header')
            return;
        const isLiteralHeaderRow = !useAutoHeader && i < manualHeaderRowCount;
        if (!isLiteralHeaderRow && hasGroups) {
            const groupCount = config.groups.length;
            if (row.groupValues === undefined || row.groupValues.length !== groupCount) {
                throw new Error(`[paginator] table() row ${i} needs "groupValues" with ${groupCount} entries (one per TableNode.groups level), got ${row.groupValues?.length ?? 'none'}`);
            }
        }
        // Spanning rows are validated by resolveCellSpans() below instead (array position no longer
        // equals column index under implicit-flow authoring) — this strict, positional check only
        // continues to apply to the literal header-row prefix (spanning is never attempted there) and
        // to ordinary body rows in a non-spanning table (byte-for-byte unchanged from before this
        // feature existed).
        if (!isLiteralHeaderRow && hasAnySpan)
            return;
        if (row.cells.length !== config.columns.length) {
            throw new Error(`[paginator] table() row ${i} has ${row.cells.length} cells, expected ${config.columns.length}`);
        }
        row.cells.forEach((cell, c) => {
            if (cell.content === undefined) {
                if (isLiteralHeaderRow) {
                    throw new Error(`[paginator] table() header row ${i}, cell ${c} needs "content"`);
                }
                throw new Error(`[paginator] table() cell at column ${c} needs "content"`);
            }
        });
    });
    if (!hasGroups && !useAutoHeader && !hasAnySpan && !hasStripe) {
        return { type: 'table', ...config }; // unchanged fast path — zero overhead for ordinary tables
    }
    const literalHeaderRows = useAutoHeader
        ? [{ cells: config.columns.map(c => ({ content: c.content })), background: config.headerBackground }]
        : config.rows.slice(0, manualHeaderRowCount);
    const bodyRows = useAutoHeader ? config.rows : config.rows.slice(manualHeaderRowCount);
    if (hasGroups && bodyRows.some(r => r.kind === 'header')) {
        throw new Error('[paginator] table() cannot combine manually-authored `kind: "header"` rows with column grouping (`groups`) in the same table.');
    }
    const spanResolvedBodyRows = hasAnySpan ? resolveCellSpans(bodyRows, config.columns.length) : bodyRows;
    if (hasGroups) {
        validateGroupClusterConstancy(spanResolvedBodyRows, config.groups.length);
    }
    const desugaredBodyRows = hasGroups ? applyGroupingRows(spanResolvedBodyRows, config.groups, config.repeatGroupHeaders ?? true, config.columns.length) : spanResolvedBodyRows;
    const headerRowCount = useAutoHeader ? 1 : manualHeaderRowCount;
    const assembledRows = headerRowCount > 0 ? [...literalHeaderRows, ...desugaredBodyRows] : desugaredBodyRows;
    const finalRows = hasStripe ? applyStripeRows(assembledRows, headerRowCount, config.stripe) : assembledRows;
    return {
        type: 'table',
        ...config,
        rows: finalRows,
        headerRows: headerRowCount,
    };
}
// Desugars `TableNode.stripe` into per-row `background` at build time — table-layout.ts never
// knows striping happened, same architecture `groups` already uses. Skips the literal header-row
// prefix (the first `headerRowCount` rows, whether hand-authored or auto-generated from
// column.content) and any column-grouping header/divider bar (`kind: 'header'`) — `even`/`odd`
// count sequentially through only the ordinary data rows that remain, and never override a row
// that already set its own `background`.
function applyStripeRows(rows, headerRowCount, stripe) {
    let dataIndex = 0;
    return rows.map((row, i) => {
        if (i < headerRowCount || row.kind === 'header')
            return row;
        const background = row.background ?? (dataIndex % 2 === 0 ? stripe.even : stripe.odd);
        dataIndex++;
        return background === row.background ? row : { ...row, background };
    });
}
