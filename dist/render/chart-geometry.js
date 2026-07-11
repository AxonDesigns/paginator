// Every pure, DOM/pdfkit-agnostic geometry/color/text-estimate helper + constant shared verbatim
// between the on-screen SVG renderer (chart-render.ts + chart-render-*.ts) and the PDF renderer
// (src/nodes/chart/pdf.ts + pdf-*.ts). None of this module touches `document`/`SVGElement`/pdfkit —
// every function here takes plain numbers/strings in and returns plain numbers/strings/path-data
// out, which is exactly what lets both renderers stay pixel-identical: they call the SAME function,
// not two hand-synced copies of the same math.
//
// Palette, ink roles, and mark specs (bar thickness cap, line width, marker size, gridline weight,
// legend-presence rule) come from this repo's `dataviz` skill reference palette + mark spec — see
// palette.md / marks-and-anatomy.md. The categorical palette below was run through the skill's
// validate_palette.js (light mode): CVD-safe (worst adjacent ΔE 24.2), three slots (aqua/yellow/
// magenta) fall under 3:1 contrast on a white surface — the "relief" mitigation for that is applied
// throughout the renderers by never coloring TEXT with a series color (labels/ticks/legend text
// always use an ink role; only swatches/marks/fills carry the series hue).
import { DEFAULT_FONT_FAMILY } from "./font-registry.js";
export const CHART_FONT_FAMILY = DEFAULT_FONT_FAMILY;
// dataviz skill reference palette, categorical theme, light mode — fixed order, never cycled per
// the skill's "assign categorical hues in fixed order" rule; wraps via modulo only past 8 series/
// slices, which is an explicit MVP simplification (the skill's own guidance is to fold a 9th series
// into "Other" instead — not attempted here since chart() accepts arbitrary-length series/slices).
export const DEFAULT_CHART_PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
export const INK_PRIMARY = '#0b0b0b';
export const INK_SECONDARY = '#52514e';
export const INK_MUTED = '#898781';
export const GRIDLINE_COLOR = '#e1e0d9';
export const AXIS_COLOR = '#c3c2b7';
// Matches the white page background mount() paints pages with (shadow-dom.ts) — used for the
// "surface gap"/"surface ring" separators between touching marks, per the mark spec.
export const SURFACE_COLOR = '#ffffff';
export const BAR_MAX_THICKNESS = 24;
export const BAR_CORNER_RADIUS = 4;
export const MARK_SURFACE_GAP = 2;
export const LINE_STROKE_WIDTH = 2;
export const MARKER_RADIUS = 4;
export const MARKER_RING_RADIUS = 6;
// The white "surface ring" behind a marker stays exactly this many px larger than the marker
// itself, matching the library's default (4px marker / 6px ring) — so an overridden markerRadius
// keeps the same visual relationship rather than needing its own separate ring-radius config.
const MARKER_RING_GAP = MARKER_RING_RADIUS - MARKER_RADIUS;
// Takes an already-resolved effective radius (the caller has already chained
// `series.markerRadius ?? chart.markerRadius`) rather than a node, since a categorical chart's
// per-series markerRadius override means there's no single node-level value to read anymore.
export function resolveMarkerRadii(radius = MARKER_RADIUS) {
    return { radius, ringRadius: radius + MARKER_RING_GAP };
}
// Maps a scatter point's arbitrary `size` value to a px radius. `sizeMin`/`sizeMax` are the literal
// min/max of every `size` actually present across the chart's points (no zero-forcing, no padding —
// unlike a position-axis domain, a size scale has no meaningful "baseline" to force into view).
// `'sqrt'` (the bubble-chart convention) keeps AREA linearly proportional to `size` rather than
// radius — computed by interpolating r^2 (proportional to area) linearly, then taking the square
// root, rather than interpolating r directly the way `'linear'` does.
export function resolveBubbleRadius(size, sizeMin, sizeMax, scaleType, range) {
    const [rMin, rMax] = range;
    if (sizeMax <= sizeMin)
        return rMin;
    const t = Math.min(1, Math.max(0, (size - sizeMin) / (sizeMax - sizeMin)));
    if (scaleType === 'linear')
        return rMin + t * (rMax - rMin);
    const areaMin = rMin * rMin;
    const areaMax = rMax * rMax;
    return Math.sqrt(areaMin + t * (areaMax - areaMin));
}
// Rough single-line width heuristic (no text measurement available at this layer by design — chart
// sizing is resolved before any SVG/text exists, see chart/layout.ts's header comment) — used only
// to decide margins/truncation, never to derive final pixel-exact box sizes for the chart itself.
export function estimateTextWidth(text, fontSize) {
    return text.length * fontSize * 0.58;
}
// Approximate baseline offset to vertically center a text element against a target y-coordinate —
// used everywhere a configurable font size replaces what used to be a fixed `fontSize / 2 - 1`
// constant (tick labels, legend entries), so centering stays correct as the size changes.
export function textBaselineOffset(fontSize) {
    return fontSize * 0.35;
}
// Rich (array-form) `ChartText` is returned unchanged — truncating a run-array to fit a legend
// swatch row would need to decide which run to cut mid-way and which run's style the ellipsis
// inherits, a real edge case with disproportionate complexity for the value it adds. Only the
// plain-`string` case (the common one) actually truncates.
export function truncateToWidth(text, maxWidth, fontSize) {
    if (typeof text !== 'string')
        return text;
    if (estimateTextWidth(text, fontSize) <= maxWidth)
        return text;
    const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.58)) - 1);
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}
// Splits `content` into lines (a '\n' inside any run's `text` forces a break, continuing the next
// part of that run — and every subsequent run — on a new line) and resolves every run's style
// against the caller's ambient defaults (e.g. the title's own fontSize/color, or
// `ChartAxisConfig.tickFontSize`/`tickColor`). The ONE place both renderers share for "what are the
// lines, what does each run look like" — `svgText()`/`drawChartText()` each still do their OWN final
// positioning (SVG via native `<tspan>` layout, PDF via pdfkit's real `widthOfString`), but can't
// drift on the line/run breakdown feeding that positioning since they call this same function.
// A run whose `text` is the empty string contributes nothing (not even a zero-width run) — this is
// what lets e.g. `TreemapChartNode.formatLabel` return `''` to omit small items' labels entirely,
// the same as it always could.
export function normalizeChartText(content, defaults) {
    const runs = typeof content === 'string' ? [{ text: content }] : content;
    const lines = [[]];
    for (const run of runs) {
        const style = {
            fontSize: run.fontSize ?? defaults.fontSize,
            color: run.color ?? defaults.color,
            opacity: run.opacity ?? 1,
            fontWeight: run.fontWeight,
            fontStyle: run.fontStyle,
        };
        const parts = run.text.split('\n');
        parts.forEach((part, pi) => {
            if (pi > 0)
                lines.push([]);
            if (part.length > 0)
                lines[lines.length - 1].push({ ...style, text: part });
        });
    }
    return lines;
}
// Layout-sizing heuristic (margins, legend column width, category-label thinning) for a value
// that's now potentially `ChartText` rather than a guaranteed plain string — same
// `estimateTextWidth` heuristic as ever, applied per run and summed per line, widest line wins.
// `baseFontSize` only matters as the fallback for runs that don't set their own `fontSize`.
export function estimateChartTextWidth(content, baseFontSize) {
    const lines = normalizeChartText(content, { fontSize: baseFontSize, color: '' });
    return Math.max(0, ...lines.map(line => line.reduce((sum, run) => sum + estimateTextWidth(run.text, run.fontSize), 0)));
}
// Word-wraps `content` to fit within `maxWidth`, used for the chart title (see
// `TreemapChartNode`-style too-small-to-fit checks elsewhere for a DIFFERENT, box-fit-driven use of
// `normalizeChartText`/`estimateChartTextWidth` — this one actively reflows text instead of just
// measuring it). Explicit line breaks (`\n` inside a run's text) are resolved first via
// `normalizeChartText`; any resulting line whose estimated width still exceeds `maxWidth` is
// greedily word-wrapped — each run's text split on spaces into style-tagged "words," packed onto a
// line until the next word wouldn't fit, matching a standard greedy word-wrap. Built entirely on the
// existing `estimateTextWidth` heuristic (never real measurement), so the SVG and PDF renderers —
// which both call this — wrap at EXACTLY the same word; a single word wider than `maxWidth` on its
// own still gets its own line rather than being split mid-word (no hyphenation).
export function wrapChartTextToWidth(content, maxWidth, baseFontSize, baseColor) {
    // Unlike `estimateChartTextWidth` (which only ever returns a number, so a dummy color inside its
    // own internal `normalizeChartText` call never escapes it), this function's OUTPUT is later drawn
    // — so it must resolve every run against the REAL ambient color here. If it baked a placeholder
    // instead, that placeholder would already be a definite (non-`undefined`) value by the time a
    // renderer's own `normalizeChartText` call tried to apply ITS ambient default, silently
    // overriding the real color with the placeholder instead of falling back to it.
    const explicitLines = normalizeChartText(content, { fontSize: baseFontSize, color: baseColor });
    const wrapped = [];
    for (const line of explicitLines) {
        const lineWidth = line.reduce((sum, run) => sum + estimateTextWidth(run.text, run.fontSize), 0);
        if (lineWidth <= maxWidth) {
            wrapped.push(line);
            continue;
        }
        const words = [];
        for (const run of line) {
            for (const word of run.text.split(' ').filter(w => w.length > 0)) {
                words.push({ ...run, text: word });
            }
        }
        let current = [];
        let currentWidth = 0;
        for (const word of words) {
            const wordWidth = estimateTextWidth(word.text, word.fontSize);
            const spaceWidth = current.length > 0 ? estimateTextWidth(' ', word.fontSize) : 0;
            if (current.length > 0 && currentWidth + spaceWidth + wordWidth > maxWidth) {
                wrapped.push(current);
                current = [];
                currentWidth = 0;
            }
            const leadingSpace = current.length > 0 ? ' ' : '';
            current.push({ ...word, text: leadingSpace + word.text });
            currentWidth += (current.length > 1 ? spaceWidth : 0) + wordWidth;
        }
        if (current.length > 0)
            wrapped.push(current);
    }
    return wrapped.length > 0 ? wrapped : [[]];
}
export function resolveColor(explicit, overridePalette, index) {
    if (explicit !== undefined)
        return explicit;
    if (overridePalette !== undefined && overridePalette.length > 0)
        return overridePalette[index % overridePalette.length];
    return DEFAULT_CHART_PALETTE[index % DEFAULT_CHART_PALETTE.length];
}
// A ring slice's resolved color: its own explicit `color` wins outright; otherwise the palette
// cycles by this slice's position WITHIN ITS OWN RING (`si`), using that ring's own `colors`
// override if it has one, falling back to the chart-level `colors`/default palette otherwise —
// "scoped to this ring's own slice indices" per ChartRing.colors's header comment. Shared by the
// legend (legendEntriesFor) and every radial render/draw path so a given ring's Nth slice always
// gets the exact same color wherever it's drawn.
export function ringSliceColor(node, ring, slice, si) {
    return resolveColor(slice.color, ring.colors ?? node.colors, si);
}
// Rounded corner on the end AWAY from the baseline, square where it meets the baseline — per the
// mark spec ("4px rounded data-end, square at the baseline"). `round: 'top'` is a bar growing
// upward from the baseline (the common non-negative case); `'bottom'` one growing downward;
// `'none'` a fully square rect — used for every interior segment of a stacked bar, where only the
// outermost segment (furthest from the zero baseline) gets the rounded "data-end" treatment.
// `'left'`/`'right'` are the horizontal-orientation equivalent of `'top'`/`'bottom'` — the caller
// (renderCategoricalChart) is the one that knows whether a given chart is vertical or horizontal;
// this function only knows which literal corners to round.
export function barPath(x, y, w, h, round, cornerRadius = BAR_CORNER_RADIUS) {
    if (round === 'none')
        return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    if (round === 'top' || round === 'bottom') {
        const r = Math.min(cornerRadius, w / 2, h);
        if (r <= 0)
            return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
        if (round === 'top') {
            return `M ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h} H ${x} Z`;
        }
        const bottom = y + h;
        return `M ${x} ${y} H ${x + w} V ${bottom - r} A ${r} ${r} 0 0 1 ${x + w - r} ${bottom} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${bottom - r} Z`;
    }
    const r = Math.min(cornerRadius, h / 2, w);
    if (r <= 0)
        return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    if (round === 'right') {
        return `M ${x} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x} Z`;
    }
    const right = x + w;
    return `M ${x + r} ${y} H ${right} V ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
// All 4 corners rounded equally — a genuinely different shape from barPath's single-rounded-"data
// end" rect (a bar always has a baseline edge that stays square; a Gantt task bar has no such
// edge — both ends are "data ends"). Clamped to a stadium/pill shape (r capped at h/2) when
// `radius` would otherwise exceed the bar's own half-height.
export function roundedRectPath(x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (r <= 0)
        return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    return (`M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} ` +
        `H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`);
}
// Default peak opacity (at the line, fading linearly to 0 at the baseline) for an unfilled-in
// `series.fill: true` — see ChartSeriesFillConfig in nodes.ts.
export const DEFAULT_AREA_FILL_OPACITY = 0.25;
export function resolveLineFill(series, resolvedColor) {
    if (!series.fill)
        return null;
    if (series.fill === true)
        return { color: resolvedColor, opacity: DEFAULT_AREA_FILL_OPACITY };
    return { color: series.fill.color ?? resolvedColor, opacity: series.fill.opacity ?? DEFAULT_AREA_FILL_OPACITY };
}
// Fritsch–Carlson monotone cubic Hermite tangents for a sequence of (coord, value) pairs whose
// `coords` are strictly increasing — the same technique behind d3's curveMonotoneX/Y. Producing a
// per-point tangent this way (rather than, say, a naive Catmull-Rom average of neighboring secants)
// guarantees the resulting curve never overshoots past either endpoint's own value on the segment
// between it and a neighbor — important here since chart data has no "smooth by construction"
// guarantee a hand-drawn curve would.
function monotoneTangents(coords, values) {
    const n = coords.length;
    const tangents = new Array(n).fill(0);
    if (n < 2)
        return tangents;
    const secants = [];
    for (let i = 0; i < n - 1; i++) {
        const dx = coords[i + 1] - coords[i];
        secants.push(dx === 0 ? 0 : (values[i + 1] - values[i]) / dx);
    }
    tangents[0] = secants[0];
    tangents[n - 1] = secants[n - 2];
    for (let i = 1; i < n - 1; i++) {
        const s0 = secants[i - 1];
        const s1 = secants[i];
        tangents[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
    }
    // Fritsch-Carlson monotonicity clamp: rescales a segment's two tangents together, toward the
    // segment's own secant, whenever they'd otherwise pull the curve past a flat/reversing neighbor.
    for (let i = 0; i < n - 1; i++) {
        const s = secants[i];
        if (s === 0) {
            tangents[i] = 0;
            tangents[i + 1] = 0;
            continue;
        }
        let alpha = tangents[i] / s;
        let beta = tangents[i + 1] / s;
        if (alpha < 0)
            tangents[i] = 0;
        if (beta < 0)
            tangents[i + 1] = 0;
        alpha = tangents[i] / s;
        beta = tangents[i + 1] / s;
        const mag = alpha * alpha + beta * beta;
        if (mag > 9) {
            const tau = 3 / Math.sqrt(mag);
            tangents[i] = tau * alpha * s;
            tangents[i + 1] = tau * beta * s;
        }
    }
    return tangents;
}
// `axis` names which of the point's two coordinates is the strictly-increasing "progression" one —
// categories along x for a vertical line chart, categories along y for a horizontal one — so this
// one function serves both orientations instead of a duplicated axis-specific copy, unlike the
// categorical renderer's own vertical/horizontal split (there, margins/anchors/labels differ per
// axis; here only which coordinate plays which role differs, so a single parameterized function
// stays clear).
export function linePath(points, curve, axis) {
    if (points.length === 0)
        return '';
    if (points.length === 1 || curve === 'linear') {
        return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
    }
    const coords = points.map(p => (axis === 'x' ? p[0] : p[1]));
    const values = points.map(p => (axis === 'x' ? p[1] : p[0]));
    const tangents = monotoneTangents(coords, values);
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
        const c0 = coords[i];
        const v0 = values[i];
        const c1 = coords[i + 1];
        const v1 = values[i + 1];
        const dc = (c1 - c0) / 3;
        const cp1v = v0 + tangents[i] * dc;
        const cp2v = v1 - tangents[i + 1] * dc;
        const cp1 = axis === 'x' ? [c0 + dc, cp1v] : [cp1v, c0 + dc];
        const cp2 = axis === 'x' ? [c1 - dc, cp2v] : [cp2v, c1 - dc];
        const end = axis === 'x' ? [c1, v1] : [v1, c1];
        d += ` C ${cp1[0]} ${cp1[1]} ${cp2[0]} ${cp2[1]} ${end[0]} ${end[1]}`;
    }
    return d;
}
// Same line, closed down to the baseline (a straight edge, never curved) to form a fillable area —
// `baselineCoord` is a single fixed pixel coordinate on the axis PERPENDICULAR to `axis` (the
// y-coordinate of the value baseline for a vertical chart, or its x-coordinate for a horizontal
// one), matching the same baseline bars grow from so a fill and a bar chart of the same data would
// bound the same area.
export function areaPath(points, curve, axis, baselineCoord) {
    if (points.length === 0)
        return '';
    const line = linePath(points, curve, axis);
    const first = points[0];
    const last = points[points.length - 1];
    if (axis === 'x')
        return `${line} L ${last[0]} ${baselineCoord} L ${first[0]} ${baselineCoord} Z`;
    return `${line} L ${baselineCoord} ${last[1]} L ${baselineCoord} ${first[1]} Z`;
}
// The two endpoints (in local chart px, along the axis perpendicular to `axis`) of the gradient
// vector an area fill fades along: opaque at `from` — the series' own extreme point, on whichever
// side of the baseline its data actually sits — transparent at `to`, always the baseline itself.
// Comparing the AVERAGE perpendicular coordinate against the baseline (rather than assuming
// "values are always positive, baseline is always at the bottom/right") is what makes this work
// for an all-negative series too, where the baseline sits at the near edge instead of the far one.
export function areaFillGradientVector(points, axis, baselineCoord) {
    const perp = points.map(p => (axis === 'x' ? p[1] : p[0]));
    const avgPerp = perp.reduce((a, b) => a + b, 0) / perp.length;
    const from = avgPerp <= baselineCoord ? Math.min(...perp) : Math.max(...perp);
    return { from, to: baselineCoord };
}
// Splits one category's per-series values into stacked segments: positive values stack upward from
// zero, negative values stack downward, each in original series order (zero values contribute no
// segment). Pure value-space geometry — shared unchanged between the SVG and PDF renderers, same as
// barPath/pieSlicePath/donutSlicePath below.
export function stackedBarSegments(values) {
    const segments = [];
    const positive = values.map((v, i) => [v, i]).filter(([v]) => v > 0);
    const negative = values.map((v, i) => [v, i]).filter(([v]) => v < 0);
    // Only a true, ungapped baseline when nothing occupies the other side of zero — otherwise
    // "touching" positive and negative stacks share that boundary just like any two segments.
    const zeroIsTrueBaseline = positive.length === 0 || negative.length === 0;
    let cum = 0;
    positive.forEach(([v, i], j) => {
        const valueStart = cum;
        cum += v;
        segments.push({ seriesIndex: i, valueStart, valueEnd: cum, round: j === positive.length - 1 ? 'top' : 'none', startIsBaseline: j === 0 && zeroIsTrueBaseline });
    });
    cum = 0;
    negative.forEach(([v, i], j) => {
        const valueStart = cum;
        cum += v;
        segments.push({ seriesIndex: i, valueStart, valueEnd: cum, round: j === negative.length - 1 ? 'bottom' : 'none', startIsBaseline: j === 0 && zeroIsTrueBaseline });
    });
    return segments;
}
// Converts one stacked segment's value-space range to a pixel (coordStart, length) span along
// whichever axis `scale` maps values onto — the y-axis for a vertical chart (where larger values
// produce SMALLER pixel coordinates) or the x-axis for a horizontal one (larger values produce
// LARGER coordinates). Direction-agnostic by construction: it insets each edge toward the OTHER
// edge (`dir`, derived from the actual pixel-space relationship, not assumed from value-space) by
// `gap` at every INTERNAL boundary (shared with a neighboring segment), while leaving the true
// zero-baseline edge and the outermost tip edge flush — the "surface gap separates touching marks"
// rule applied to a stack instead of to adjacent bars. Returns null when the inset leaves nothing
// visible (a segment small enough that the gap consumes its whole span).
export function stackedSegmentPixelRange(seg, scale, gap) {
    let pBaselineEdge = scale(seg.valueStart);
    let pTipEdge = scale(seg.valueEnd);
    const dir = pTipEdge >= pBaselineEdge ? 1 : -1; // pixel-space direction from the baseline edge toward the tip edge
    if (!seg.startIsBaseline)
        pBaselineEdge += dir * (gap / 2);
    if (seg.round === 'none')
        pTipEdge -= dir * (gap / 2);
    const coordMin = Math.min(pBaselineEdge, pTipEdge);
    const coordMax = Math.max(pBaselineEdge, pTipEdge);
    const length = coordMax - coordMin;
    return length > 0 ? { coordStart: coordMin, length } : null;
}
// Unit vector along the radial line at angleDeg, and the unit vector perpendicular to it that
// points toward INCREASING angle (verified by construction: nudging a point on the radial line by
// an infinitesimal +perpDir lands at angleDeg+ε, matching the small-angle addition formulas for
// sin/cos) — the two building blocks every offset-edge computation below is expressed in terms of.
function radialDir(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return [Math.cos(rad), Math.sin(rad)];
}
function perpDir(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return [-Math.sin(rad), Math.cos(rad)];
}
// The point at `radius` from center on the line that runs PARALLEL to (not through) the true
// radial line at `angleDeg`, offset perpendicular to it by `halfGapPx` toward increasing angle
// (sign=1) or decreasing angle (sign=-1). Because perpDir/radialDir are orthonormal, the offset
// point at parameter t is center + halfGapPx*perp + t*radial, and |halfGapPx*perp + t*radial| = R
// reduces to halfGapPx^2 + t^2 = R^2 by Pythagoras — no general line/circle intersection needed.
export function offsetEdgePoint(cx, cy, angleDeg, halfGapPx, sign, radius) {
    const perp = perpDir(angleDeg);
    const radial = radialDir(angleDeg);
    const d = sign * Math.min(halfGapPx, radius * 0.999); // keeps t real or a hair above zero, however large the configured gap
    const t = Math.sqrt(Math.max(radius * radius - d * d, 0));
    return [cx + d * perp[0] + t * radial[0], cy + d * perp[1] + t * radial[1]];
}
// Intersection of this slice's two offset edge lines (its start boundary, offset toward increasing
// angle, and its end boundary, offset toward decreasing angle) — the slice's true apex once a gap
// pulls it back from the circle's exact center, per the geometry: a constant-width gap channel
// (rather than an angular wedge that tapers to nothing at r=0) requires the inner vertex to move
// off-center by an amount that grows as the slice narrows or the gap widens. Falls back to the
// circle's own center if the two edges are parallel (a slice of exactly 180°, i.e. det≈0) — the
// only configuration where they never meet.
export function offsetApex(cx, cy, startAngleDeg, endAngleDeg, halfGapPx) {
    const p1 = perpDir(startAngleDeg);
    const u1 = radialDir(startAngleDeg);
    const u2 = radialDir(endAngleDeg);
    const q1 = [cx + halfGapPx * p1[0], cy + halfGapPx * p1[1]];
    const p2 = perpDir(endAngleDeg);
    const q2 = [cx - halfGapPx * p2[0], cy - halfGapPx * p2[1]];
    const det = u2[0] * u1[1] - u1[0] * u2[1];
    if (Math.abs(det) < 1e-9)
        return [cx, cy];
    const rx = q2[0] - q1[0];
    const ry = q2[1] - q1[1];
    const t1 = (-rx * u2[1] + u2[0] * ry) / det;
    return [q1[0] + t1 * u1[0], q1[1] + t1 * u1[1]];
}
// `startAngle`/`endAngle` are this slice's TRUE, un-trimmed boundary angles (shared with its
// neighbors) — nothing here shrinks the angular range; the gap comes entirely from offsetting the
// edges perpendicular to those true boundaries, so it stays a constant `halfGapPx*2` wide from the
// apex all the way to the rim instead of tapering to zero at the center. `halfGapPx: 0` degenerates
// exactly to the no-gap case (apex = true center).
export function pieSlicePath(cx, cy, r, startAngle, endAngle, halfGapPx = 0) {
    const apex = offsetApex(cx, cy, startAngle, endAngle, halfGapPx);
    const p0 = offsetEdgePoint(cx, cy, startAngle, halfGapPx, 1, r);
    const p1 = offsetEdgePoint(cx, cy, endAngle, halfGapPx, -1, r);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${apex[0]} ${apex[1]} L ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${largeArc} 1 ${p1[0]} ${p1[1]} Z`;
}
// Same constant-width-gap construction as pieSlicePath, applied to BOTH the outer and inner rim —
// the inner straight edges are offset exactly like the outer ones (same halfGapPx, same true
// boundary angles), so the channel is the same width at the inner rim as the outer one instead of
// narrowing (an angle-trim gap would subtend a smaller arc, hence a visually thinner gap, at the
// smaller inner radius).
export function donutSlicePath(cx, cy, rInner, rOuter, startAngle, endAngle, halfGapPx = 0) {
    const o0 = offsetEdgePoint(cx, cy, startAngle, halfGapPx, 1, rOuter);
    const o1 = offsetEdgePoint(cx, cy, endAngle, halfGapPx, -1, rOuter);
    const i1 = offsetEdgePoint(cx, cy, endAngle, halfGapPx, -1, rInner);
    const i0 = offsetEdgePoint(cx, cy, startAngle, halfGapPx, 1, rInner);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${o0[0]} ${o0[1]} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o1[0]} ${o1[1]} L ${i1[0]} ${i1[1]} A ${rInner} ${rInner} 0 ${largeArc} 0 ${i0[0]} ${i0[1]} Z`;
}
// Replaces the old flat pie's inline `angle` accumulator (a single running variable, sequentially
// updated as the old renderPieChart walked its one flat `slices` array) — a multi-ring radial chart
// needs each ring's own resolved angle array computed up front, since an outer ring's PARENTED
// slices need to read the arc their parent already resolved to, not compute their own from scratch.
// `parentArcs` is the previous ring's own resolved angle array (one entry per slice, same order) —
// `null` for ring 0, which has no ring inside it to nest under and always divides the full 360°
// independently. chart() has already validated that a ring's slices are either ALL parented or NONE
// (never mixed), so checking whether ANY slice sets `parentIndex` is enough to know which of the two
// modes this ring is in.
export function resolveRingSliceAngles(slices, parentArcs) {
    const isParented = parentArcs !== null && slices.some(s => s.parentIndex !== undefined);
    if (!isParented) {
        // Flat: divides the full 360° independently, exactly like a classic single-ring pie — 0°=top
        // (-90 in this coordinate convention), sweeping clockwise. Same math as the pre-rings flat pie.
        const total = slices.reduce((acc, s) => acc + s.value, 0) || 1;
        let angle = -90;
        return slices.map(s => {
            const sweep = (s.value / total) * 360;
            const arc = { start: angle, end: angle + sweep };
            angle += sweep;
            return arc;
        });
    }
    // Parented: each slice's arc is a sub-arc of its OWN parent's already-resolved arc, sized
    // proportionally to this slice's value among its SIBLINGS (other slices in `slices` sharing the
    // same parentIndex). Tracked as a running cursor PER parentIndex (not one global cursor) so
    // interleaved authoring order — children of different parents mixed together in the array — still
    // lays out correctly without requiring same-parent slices to sit contiguously in the array.
    const totalByParent = new Map();
    for (const s of slices)
        totalByParent.set(s.parentIndex, (totalByParent.get(s.parentIndex) ?? 0) + s.value);
    const cursorByParent = new Map();
    return slices.map(s => {
        const p = s.parentIndex;
        const parentArc = parentArcs[p];
        const total = totalByParent.get(p) || 1;
        const cursor = cursorByParent.get(p) ?? parentArc.start;
        const sweep = (s.value / total) * (parentArc.end - parentArc.start);
        cursorByParent.set(p, cursor + sweep);
        return { start: cursor, end: cursor + sweep };
    });
}
// Splits [holeR, outerRadius] into `ringCount` equal-width radial bands, innermost (index 0) to
// outermost — generalizing the old chart-level `isDonut` boolean (a single ring either has a hole
// or doesn't) into "each ring gets an equal-width band across whatever radius remains outside the
// shared center hole." A small fixed radial gap (MARK_SURFACE_GAP) separates ADJACENT rings from
// each other, same "surface gap separates touching marks" rule the rest of this file already
// applies elsewhere (stackedSegmentPixelRange, MARK_SURFACE_GAP itself) — inset only at INTERNAL
// boundaries (between two rings), never at the innermost ring's inner edge (nothing sits between it
// and the hole/center) or the outermost ring's outer edge (nothing sits beyond it).
export function resolveRingRadii(ringCount, innerRadiusRatio, outerRadius) {
    const holeR = outerRadius * innerRadiusRatio;
    const bandWidth = (outerRadius - holeR) / ringCount;
    return Array.from({ length: ringCount }, (_, i) => {
        const naiveInner = holeR + i * bandWidth;
        const naiveOuter = holeR + (i + 1) * bandWidth;
        return {
            innerR: naiveInner + (i > 0 ? MARK_SURFACE_GAP / 2 : 0),
            outerR: naiveOuter - (i < ringCount - 1 ? MARK_SURFACE_GAP / 2 : 0),
        };
    });
}
export function resolveTitle(node) {
    if (node.title === undefined)
        return null;
    // A bare `ChartText` (string OR a raw run array — the array form is itself valid `ChartText`,
    // not `ChartTitleConfig`) is the shorthand; anything else is the `{ text, fontSize?, color? }` form.
    if (typeof node.title === 'string' || Array.isArray(node.title))
        return { text: node.title, fontSize: 14, color: INK_PRIMARY };
    return { text: node.title.text, fontSize: node.title.fontSize ?? 14, color: node.title.color ?? INK_PRIMARY };
}
export function legendEntriesFor(node) {
    if (node.chartKind === 'radial') {
        // Flattened in ring order (ring 0 first), each ring's own slices in their own array order —
        // a multi-ring chart's legend simply lists every slice across every ring, same 1:1
        // slice-to-entry mapping a flat single-ring pie always had. The color-cycling index resets
        // PER RING (si, not a running counter) — see ChartRing.colors's header comment — so the
        // render path (ringSliceColor below) and this legend always agree on which color a given
        // ring's Nth slice gets.
        const entries = [];
        for (const ring of node.rings) {
            ring.slices.forEach((s, si) => {
                entries.push({ label: s.label, color: ringSliceColor(node, ring, s, si) });
            });
        }
        return entries;
    }
    // A Gantt chart has no `series` at all (per-task color is too granular for a series-style
    // swatch legend, and grouping is a row-layout concern, not a color-identity one) — no entries,
    // same as any other kind that has nothing meaningful to put in a legend.
    if (node.chartKind === 'gantt')
        return [];
    // A candlestick series has no single `color` (its up/down colors are per-CANDLE, not a series
    // identity) — the legend swatch instead just cycles the default categorical palette by series
    // index, same as any other kind, but reading `undefined` as the explicit-color slot since there
    // is no `s.color` field to read.
    if (node.chartKind === 'candlestick') {
        return node.series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, color: resolveColor(undefined, node.colors, i) }));
    }
    // A treemap labels every rectangle inline (see chart-render-treemap.ts) — a separate swatch
    // legend would be pure redundancy, same "nothing meaningful to add" reasoning as Gantt above.
    if (node.chartKind === 'treemap')
        return [];
    return node.series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, color: resolveColor(s.color, node.colors, i) }));
}
// Default legend visibility per the dataviz skill's rule: always present for >=2 series/slices
// (color is the only identity channel), never a lone single-swatch box for one series.
export function resolveShowLegend(node, entryCount) {
    if (node.legend?.show !== undefined)
        return node.legend.show;
    if (node.chartKind === 'radial')
        return true;
    if (node.chartKind === 'gantt')
        return false;
    return entryCount > 1;
}
// The zero/auto/explicit domain-widening POLICY, factored out of resolveChartDomain below so every
// other chart kind needing its own numeric-domain resolution (scatter's x/y, gantt's time axis,
// radar's shared radial domain, ...) can reuse this exact tail instead of re-deriving it — only the
// EXTENT computation feeding it (what counts as "the data's raw min/max") differs per chart kind.
export function resolveDomainFromExtent(rawMin, rawMax, view) {
    const domain = view.domain;
    let dataMin;
    let dataMaxRaw;
    if (domain === 'auto') {
        // Tight to the data's own extent — deliberately NOT forced through zero — then widened by a
        // fraction of that extent on each side so the single lowest/highest mark isn't drawn flush
        // against the plot's own edge (a bar there would render at zero height).
        const padding = view.padding ?? 0.1;
        const pad = (rawMax - rawMin) * padding;
        dataMin = rawMin - pad;
        dataMaxRaw = rawMax + pad;
    }
    else {
        // `'zero'` (default), and also the base that an explicit `{min, max}` override's UNSET bound
        // falls back to — see ChartViewConfig.domain's header comment.
        dataMin = Math.min(0, rawMin);
        dataMaxRaw = Math.max(0, rawMax);
    }
    // An explicit object wins outright over whichever auto mode ran above — chart() already
    // validated min < max when both are set.
    if (typeof domain === 'object') {
        if (domain.min !== undefined)
            dataMin = domain.min;
        if (domain.max !== undefined)
            dataMaxRaw = domain.max;
    }
    const dataMax = dataMaxRaw > dataMin ? dataMaxRaw : dataMin + 1; // avoid a zero-height domain (flat/all-zero data, or a zero-width auto-padded range)
    return { dataMin, dataMax };
}
// Shared by the SVG and PDF renderers, same as the other pure per-chart-kind geometry above
// (stackedBarSegments, barPath, ...) — keeps the domain math itself in exactly one place rather
// than duplicated field-for-field between the two renderers.
export function resolveChartDomain(categories, series, stacked, view) {
    let rawMin;
    let rawMax;
    if (stacked) {
        // Stacking only ever applies AMONG 'bar'-kind series (see CategoricalChartNode.barMode) — a
        // 'line'/'points' series drawn alongside a stacked bar group is never folded into the stack
        // itself, so it contributes its own raw values here exactly like the non-stacked branch below,
        // while only the bar subset feeds the summed-stack extent.
        const barSeries = series.filter(s => (s.kind ?? 'bar') === 'bar');
        const otherValues = series.filter(s => (s.kind ?? 'bar') !== 'bar').flatMap(s => s.data);
        // The tallest POSITIVE stack and the deepest NEGATIVE stack per category, not the single
        // largest raw value — a stacked bar's visual extent is the sum of its segments. Each sum is
        // already <=0/>=0 by construction (reduce starts at 0 and only adds same-signed values), so it
        // already carries an implicit zero bound with no separate Math.min(0, ...)/Math.max(0, ...) —
        // unlike the non-stacked branch below, where the raw data can sit entirely off to one side of 0.
        const positiveSums = categories.map((_, ci) => barSeries.reduce((acc, s) => acc + Math.max(0, s.data[ci]), 0));
        const negativeSums = categories.map((_, ci) => barSeries.reduce((acc, s) => acc + Math.min(0, s.data[ci]), 0));
        rawMin = Math.min(...negativeSums, ...otherValues);
        rawMax = Math.max(...positiveSums, ...otherValues);
    }
    else {
        // Grouped bars, and every 'line'/'points' series regardless of barMode, all just contribute
        // their own raw values directly — the same "one shared value axis across every series" domain
        // a multi-series line chart has always used.
        const allValues = series.flatMap(s => s.data);
        rawMin = Math.min(...allValues);
        rawMax = Math.max(...allValues);
    }
    return resolveDomainFromExtent(rawMin, rawMax, view);
}
export function niceTickValues(min, max, tickCount) {
    if (max <= min)
        return [min];
    const ticks = [];
    for (let i = 0; i <= tickCount; i++)
        ticks.push(min + ((max - min) * i) / tickCount);
    return ticks;
}
// Expands `tasks` into the actual row sequence to draw, inserting one header row at the START of
// each CONTIGUOUS run of same-`group` tasks — see ChartGanttTask.group's header comment for why
// this is a contiguous-run rule, not a global regroup-by-value the way TableNode.groups works.
// `showGroupHeaders: false` (or no task ever setting `group`) degenerates to one row per task, no
// headers at all.
export function resolveGanttRows(tasks, showGroupHeaders) {
    if (!showGroupHeaders)
        return tasks.map(task => ({ kind: 'task', task }));
    const rows = [];
    let currentGroup;
    let inGroup = false;
    for (const task of tasks) {
        if (task.group !== undefined && (!inGroup || task.group !== currentGroup)) {
            rows.push({ kind: 'header', label: task.group });
            currentGroup = task.group;
            inGroup = true;
        }
        else if (task.group === undefined) {
            // Leaving group context — a LATER task reusing a previously-seen group name starts a fresh
            // contiguous run (and its own new header), rather than being silently treated as "still in"
            // that group from before this ungrouped gap.
            inGroup = false;
            currentGroup = undefined;
        }
        rows.push({ kind: 'task', task });
    }
    return rows;
}
// Light neutral fill for a group header band — distinct from the plot's white surface without
// competing with task-bar colors, same "never color text/chrome with a series hue" rule the rest
// of the chart mark spec already follows. The chart-level DEFAULT when neither
// `GanttChartNode.groupHeaderBackground` nor a per-group override in `groups` is set.
export const GANTT_GROUP_HEADER_FILL = '#f2f1ec';
// Resolves one group header band's text/background color: a per-group entry in `node.groups`
// (keyed by the exact group label) wins outright, then the chart-level `groupHeaderColor`/
// `groupHeaderBackground` default, then this file's own built-in fallback — see
// GanttChartNode.groups's header comment for the full precedence rule. Shared by both renderers so
// they never drift on which color a given group's band gets.
export function resolveGanttGroupStyle(node, label) {
    const override = node.groups?.[label];
    return {
        color: override?.color ?? node.groupHeaderColor ?? INK_SECONDARY,
        background: override?.background ?? node.groupHeaderBackground ?? GANTT_GROUP_HEADER_FILL,
    };
}
// A task's OWN row-label text color: its own `labelColor` wins outright, then the chart-level
// `taskLabelColor` default, then this file's own built-in ink fallback — deliberately independent
// of the task's bar `color` (see ChartGanttTask.color's header comment for why the two aren't
// linked) and independent of `resolveGanttGroupStyle` above (that's the header BAND's own text).
export function resolveGanttTaskLabelColor(node, task) {
    return task.labelColor ?? node.taskLabelColor ?? INK_SECONDARY;
}
// Spoke angle for category index `i` of `spokeCount` total — 0°=top, sweeping clockwise, same
// convention `pieSlicePath`'s `-90` start angle already establishes for this codebase's charts.
export function radarSpokeAngle(i, spokeCount) {
    return -90 + i * (360 / spokeCount);
}
// One vertex per category, at that category's spoke angle and a radius proportional to its value
// within [domainMin, domainMax] — the domain's own MINIMUM maps to radius 0 (the center), not a
// hard-coded literal zero, so a series with negative values still produces a well-defined polygon
// (see ChartRadarSeries.data's header comment).
export function radarPolygonPoints(cx, cy, values, domainMin, domainMax, maxRadius) {
    const span = domainMax - domainMin || 1;
    return values.map((v, i) => {
        const r = Math.max(0, ((v - domainMin) / span) * maxRadius);
        const angle = (radarSpokeAngle(i, values.length) * Math.PI) / 180;
        return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    });
}
// A closed polygon through every point — no curve/monotone option (unlike linePath): a radar
// series is always straight-edged between spokes, there's no established "smoothed radar" look
// this codebase needs to support.
export function polygonPath(points) {
    if (points.length === 0)
        return '';
    return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`;
}
// Matches the green/red slots already present in DEFAULT_CHART_PALETTE (indices 1 and 5) — reused
// literally rather than re-derived, so a candlestick chart's up/down colors read as "the same green
// and red this library already uses," not an unrelated new pair.
export const CANDLESTICK_UP_COLOR = '#1baf7a';
export const CANDLESTICK_DOWN_COLOR = '#e34948';
// Plain coordinates (wick line + body rect), not an SVG path string — same "discrete primitives"
// pattern legend swatches and marker circles already use, since a candle isn't a single continuous
// shape the way a bar or slice is. `scale` maps a price value to a local chart-px y-coordinate
// (larger values → smaller y, same convention every other vertical value-axis in this codebase
// uses); `centerX` is the already-computed horizontal center of this candle's own slot within its
// category band (grouped alongside sibling series exactly like grouped bars are).
export function candlestickGeometry(candle, centerX, scale, candleWidth) {
    const isUp = candle.close >= candle.open;
    const yOpen = scale(candle.open);
    const yClose = scale(candle.close);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    return {
        wickX: centerX,
        wickY1: scale(candle.high),
        wickY2: scale(candle.low),
        bodyX: centerX - candleWidth / 2,
        bodyY: bodyTop,
        bodyWidth: candleWidth,
        // A doji (open === close) still gets a visible sliver rather than a zero-height invisible body.
        bodyHeight: Math.max(1, bodyBottom - bodyTop),
        isUp,
    };
}
// Worst (largest) aspect-ratio deviation from a square across every rectangle in a candidate row —
// the metric the squarified algorithm minimizes at each step. `w` is the FIXED side length the row
// is being built along (the shorter side of whatever container rect remains); each area's other
// dimension is `area/w`, so its aspect ratio is `max(w/(area/w), (area/w)/w)` — algebraically
// simplified to the two terms below (still `max(w²·area, ...)`-shaped, just avoiding a division by
// `area` for a zero-area edge case).
function worstAspectRatio(areas, w) {
    const sum = areas.reduce((a, b) => a + b, 0);
    if (sum <= 0)
        return Infinity;
    const maxArea = Math.max(...areas);
    const minArea = Math.min(...areas);
    const w2 = w * w;
    return Math.max((w2 * maxArea) / (sum * sum), (sum * sum) / (w2 * minArea));
}
// Bruls/Huizing/van Wijk's "squarify" algorithm — packs `areas` (already-scaled to physical px²,
// summing to `box.width * box.height`) into `box` as a sequence of rows, each row filled along the
// container's current SHORTER side, greedily growing a row only while doing so doesn't worsen the
// row's own worst aspect ratio. Areas MUST already be sorted descending for the standard algorithm
// to produce its characteristic near-square rectangles (an unsorted input still terminates and
// tiles the box exactly, just with less square-ish results). Returns rects in the SAME order as
// `areas`, not sorted order — callers needing the sort do it themselves (see squarifyTreemap below,
// which is the actual public entry point items.ts consumers use).
function squarifyRows(areas, box) {
    const rects = [];
    let remaining = box;
    let items = areas;
    while (items.length > 0) {
        const w = Math.min(remaining.width, remaining.height);
        let row = [items[0]];
        let i = 1;
        while (i < items.length) {
            const candidate = [...row, items[i]];
            if (worstAspectRatio(candidate, w) <= worstAspectRatio(row, w)) {
                row = candidate;
                i++;
            }
            else {
                break;
            }
        }
        const rowSum = row.reduce((a, b) => a + b, 0);
        if (remaining.width >= remaining.height) {
            // Shorter side is height — lay the row out as a vertical strip on the left, one item stacked
            // above the next, each getting a height proportional to its own share of the row.
            const stripWidth = remaining.height > 0 ? rowSum / remaining.height : 0;
            let cy = remaining.y;
            for (const a of row) {
                const h = rowSum > 0 ? (a / rowSum) * remaining.height : 0;
                rects.push({ x: remaining.x, y: cy, width: stripWidth, height: h });
                cy += h;
            }
            remaining = { x: remaining.x + stripWidth, y: remaining.y, width: remaining.width - stripWidth, height: remaining.height };
        }
        else {
            // Shorter side is width — lay the row out as a horizontal strip along the top instead.
            const stripHeight = remaining.width > 0 ? rowSum / remaining.width : 0;
            let cx = remaining.x;
            for (const a of row) {
                const wid = rowSum > 0 ? (a / rowSum) * remaining.width : 0;
                rects.push({ x: cx, y: remaining.y, width: wid, height: stripHeight });
                cx += wid;
            }
            remaining = { x: remaining.x, y: remaining.y + stripHeight, width: remaining.width, height: remaining.height - stripHeight };
        }
        items = items.slice(row.length);
    }
    return rects;
}
// Public entry point: maps `items` (arbitrary order, arbitrary value scale) onto physical rects
// inside `box`, area-proportional to `value`. Internally sorts by value descending (required for
// squarifyRows' near-square guarantee) and un-sorts the result back to the CALLER's original
// `items` order, so `result[i]` is always item `i`'s own rect regardless of internal sort order — a
// zero-value item gets a degenerate zero-size rect (filtered out of the packing entirely, same
// "contributes no visible mark" pattern a zero data value already has elsewhere in this file).
export function squarifyTreemap(items, box) {
    const zeroRect = { x: box.x, y: box.y, width: 0, height: 0 };
    if (items.length === 0)
        return [];
    const totalValue = items.reduce((acc, it) => acc + it.value, 0);
    if (totalValue <= 0)
        return items.map(() => zeroRect);
    const totalArea = box.width * box.height;
    const withIndex = items
        .map((item, index) => ({ index, area: (item.value / totalValue) * totalArea }))
        .filter(entry => entry.area > 0)
        .sort((a, b) => b.area - a.area);
    const rects = squarifyRows(withIndex.map(entry => entry.area), box);
    const result = items.map(() => zeroRect);
    withIndex.forEach((entry, i) => {
        result[entry.index] = rects[i];
    });
    return result;
}
