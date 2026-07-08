// Builds the inline <svg> content for a ChartNode. Pure DOM/SVG API usage (createElementNS +
// setAttribute) — no charting library, consistent with this project having none in package.json.
//
// The chart's own width×height box is already fixed by the time this runs (resolved synchronously
// in chart/layout.ts, before any SVG text exists to measure) — see that file's header comment. So
// every internal band (title, legend, axis margins) here is sized by a FIXED heuristic, never by
// measuring rendered text, even though this code technically runs late enough (inside mount(), not
// inside paginate()) that DOM text measurement would be technically possible. Keeping the two
// consistent avoids a chart whose internal proportions silently depend on which pass produced them.
//
// This file itself is now just the entry point (`renderChartSvg`, dispatching by `chartKind`) plus
// the handful of low-level SVG-DOM primitives every chart-kind family needs (`svgEl`/`svgText`,
// the area-fill-gradient `<defs>` helpers, `renderLegend`) — every pure, DOM-agnostic geometry/
// color/text helper lives in `chart-geometry.ts` instead, and each chart-kind family's own
// rendering logic lives in its own `chart-render-<kind>.ts` (see e.g. `chart-render-categorical.ts`,
// `chart-render-radial.ts`), which import the DOM primitives back from here. This is a two-way
// (circular) module relationship, but a safe one: every cross-file reference here is only ever
// invoked from inside a function body (never read at module-top-level), so it's immaterial which of
// the two modules' top-level code happens to finish executing first.
import { renderCategoricalChart } from "./chart-render-categorical.js";
import { renderRadialChart } from "./chart-render-radial.js";
import { renderScatterChart } from "./chart-render-scatter.js";
import { renderGanttChart } from "./chart-render-gantt.js";
import { renderRadarChart } from "./chart-render-radar.js";
import { renderCandlestickChart } from "./chart-render-candlestick.js";
import { renderTreemapChart } from "./chart-render-treemap.js";
import { CHART_FONT_FAMILY, INK_PRIMARY, INK_SECONDARY, estimateChartTextWidth, legendEntriesFor, normalizeChartText, resolveShowLegend, resolveTitle, textBaselineOffset, truncateToWidth, wrapChartTextToWidth, } from "./chart-geometry.js";
const SVG_NS = 'http://www.w3.org/2000/svg';
export function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs))
        el.setAttribute(key, String(value));
    return el;
}
// SVG presentation attributes are kebab-case ("font-size", "font-family"), unlike the camelCase
// `fontSize` every call site passes in — setAttribute('fontSize', …) sets a nonstandard attribute
// name the renderer silently ignores, so this is the one place that translates the ergonomic
// camelCase call-site shape into the attribute names the SVG spec actually recognizes.
//
// `content` is `ChartText` — every chart text role accepts rich per-run styling and/or explicit
// multi-line content (see `ChartTextRun` in nodes.ts and `normalizeChartText` in chart-geometry.ts).
// The outer <text> element still carries `attrs`' own fontSize/fontFamily/fill/text-anchor/etc as
// the AMBIENT default (unchanged from before this existed) — one <tspan> per LINE (`x` repeated on
// every line so `text-anchor` centers/right-aligns each line independently around the same x, `dy`
// advancing by the PREVIOUS line's own tallest run for standard leading-follows-the-line-above
// behavior), containing one nested <tspan> per RUN carrying that run's own resolved font-size/fill/
// opacity (always explicit — redundant with the ambient default is harmless) and font-weight/
// font-style (only when that run set one, so an unset one still inherits the ambient default from
// the outer <text> via normal SVG/CSS inheritance). Returns the same single <text> element as
// always, so every existing `svg.appendChild(svgText(...))` call site needs no changes at all.
export function svgText(content, x, y, attrs) {
    const { fontSize, fontFamily, fill, ...rest } = attrs;
    const el = svgEl('text', {
        x,
        y,
        'font-family': fontFamily ?? CHART_FONT_FAMILY,
        ...(fontSize !== undefined ? { 'font-size': fontSize } : {}),
        ...(fill !== undefined ? { fill } : {}),
        ...rest,
    });
    const ambientFontSize = fontSize ?? 11;
    const ambientColor = fill ?? INK_PRIMARY;
    const lines = normalizeChartText(content, { fontSize: ambientFontSize, color: ambientColor });
    const lineHeights = lines.map(line => Math.round(1.2 * Math.max(ambientFontSize, ...line.map(run => run.fontSize))));
    lines.forEach((line, li) => {
        const lineTspan = svgEl('tspan', { x, dy: li === 0 ? 0 : lineHeights[li - 1] });
        for (const run of line) {
            const runTspan = svgEl('tspan', {
                'font-size': run.fontSize,
                fill: run.color,
                opacity: run.opacity,
                ...(run.fontWeight !== undefined ? { 'font-weight': run.fontWeight } : {}),
                ...(run.fontStyle !== undefined ? { 'font-style': run.fontStyle } : {}),
            });
            runTspan.textContent = run.text;
            lineTspan.appendChild(runTspan);
        }
        el.appendChild(lineTspan);
    });
    return el;
}
// Unique per gradient, not per chart/svg — `renderChartSvg` runs once per ChartNode, but every
// mounted page lives in the SAME shadow root (see shadow-dom.ts's mount()), so two charts sharing an
// unqualified id like "area-fill-0" would collide and make the second chart's fill reference the
// first's gradient. A monotonically increasing module-level counter sidesteps that cheaply.
let areaFillGradientCounter = 0;
function ensureDefs(svg) {
    const existing = svg.querySelector('defs');
    if (existing !== null)
        return existing;
    const defs = svgEl('defs', {});
    svg.appendChild(defs);
    return defs;
}
// `axis` matches areaFillGradientVector's own — the gradient vector runs along whichever axis is
// PERPENDICULAR to the line's progression axis (vertical, x1===x2, for a vertical line chart;
// horizontal, y1===y2, for a horizontal one). `userSpaceOnUse` (rather than the default
// objectBoundingBox) so `from`/`to` can be passed as the exact same local chart-px numbers
// areaPath() itself drew the fill shape in, with no bounding-box-relative reinterpretation.
export function appendAreaFillGradient(svg, axis, from, to, color, opacity) {
    const id = `paginator-chart-area-fill-${++areaFillGradientCounter}`;
    const gradient = svgEl('linearGradient', {
        id,
        gradientUnits: 'userSpaceOnUse',
        x1: axis === 'x' ? 0 : from,
        y1: axis === 'x' ? from : 0,
        x2: axis === 'x' ? 0 : to,
        y2: axis === 'x' ? to : 0,
    });
    const opaqueStop = svgEl('stop', { offset: '0', 'stop-color': color, 'stop-opacity': opacity });
    const transparentStop = svgEl('stop', { offset: '1', 'stop-color': color, 'stop-opacity': 0 });
    gradient.appendChild(opaqueStop);
    gradient.appendChild(transparentStop);
    ensureDefs(svg).appendChild(gradient);
    return id;
}
function renderLegend(svg, entries, box, orientation, fontSize, fontFamily, color) {
    const swatch = 10;
    const baselineOffset = textBaselineOffset(fontSize);
    if (orientation === 'vertical') {
        const rowHeight = Math.max(swatch + 4, fontSize + 9);
        const maxRows = Math.max(0, Math.floor(box.height / rowHeight));
        entries.slice(0, maxRows).forEach((entry, i) => {
            const rowCenterY = box.y + i * rowHeight + rowHeight / 2;
            svg.appendChild(svgEl('rect', { x: box.x, y: rowCenterY - swatch / 2, width: swatch, height: swatch, rx: 2, fill: entry.color }));
            const label = truncateToWidth(entry.label, box.width - swatch - 6, fontSize);
            svg.appendChild(svgText(label, box.x + swatch + 6, rowCenterY + baselineOffset, { fontSize, fontFamily, fill: color }));
        });
        return;
    }
    let x = box.x;
    const centerY = box.y + box.height / 2;
    for (const entry of entries) {
        const labelMaxWidth = 90;
        const label = truncateToWidth(entry.label, labelMaxWidth, fontSize);
        const labelWidth = Math.min(labelMaxWidth, estimateChartTextWidth(label, fontSize));
        const entryWidth = swatch + 6 + labelWidth;
        if (x + entryWidth > box.x + box.width)
            break; // remaining entries dropped rather than overflowing the box
        svg.appendChild(svgEl('rect', { x, y: centerY - swatch / 2, width: swatch, height: swatch, rx: 2, fill: entry.color }));
        svg.appendChild(svgText(label, x + swatch + 6, centerY + baselineOffset, { fontSize, fontFamily, fill: color }));
        x += entryWidth + 14;
    }
}
export function renderChartSvg(node, width, height) {
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
    const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY;
    let top = 0;
    let bottom = height;
    let left = 0;
    let right = width;
    const title = resolveTitle(node);
    if (title !== null) {
        // Word-wrapped to the chart's own width (minus a small side margin) rather than the old fixed
        // single-line band — a long title used to simply overflow the chart's left/right edges with no
        // width check at all. Legitimate to size this band from wrapped content: title/legend/axis
        // chrome sizing has never been part of paginate()'s synchronous layout (only the chart's OUTER
        // box, from height/aspectRatio, is — see chart/layout.ts's header comment), so it's already
        // recomputed on every render from the same heuristic in both this renderer and pdf.ts.
        const wrappedLines = wrapChartTextToWidth(title.text, width - 16, title.fontSize, title.color);
        const lineHeight = Math.round(title.fontSize * 1.2);
        const band = wrappedLines.length * lineHeight + 10;
        wrappedLines.forEach((line, li) => {
            svg.appendChild(svgText(line, width / 2, top + title.fontSize + 4 + li * lineHeight, { fontSize: title.fontSize, fontFamily, fill: title.color, 'text-anchor': 'middle' }));
        });
        top += band;
    }
    const entries = legendEntriesFor(node);
    if (resolveShowLegend(node, entries.length) && entries.length > 0) {
        const legendFontSize = node.legend?.fontSize ?? 11;
        const legendColor = node.legend?.color ?? INK_SECONDARY;
        const position = node.legend?.position ?? 'right';
        if (position === 'right') {
            const legendWidth = Math.min(140, width * 0.28);
            right -= legendWidth;
            renderLegend(svg, entries, { x: right + 12, y: top, width: legendWidth - 12, height: bottom - top }, 'vertical', legendFontSize, fontFamily, legendColor);
        }
        else {
            const legendHeight = Math.max(24, legendFontSize + 14);
            bottom -= legendHeight;
            renderLegend(svg, entries, { x: left, y: bottom, width: right - left, height: legendHeight }, 'horizontal', legendFontSize, fontFamily, legendColor);
        }
    }
    const plot = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    if (node.chartKind === 'categorical') {
        renderCategoricalChart(svg, node, plot);
    }
    else if (node.chartKind === 'radial') {
        renderRadialChart(svg, node, plot);
    }
    else if (node.chartKind === 'scatter') {
        renderScatterChart(svg, node, plot);
    }
    else if (node.chartKind === 'gantt') {
        renderGanttChart(svg, node, plot);
    }
    else if (node.chartKind === 'radar') {
        renderRadarChart(svg, node, plot);
    }
    else if (node.chartKind === 'candlestick') {
        renderCandlestickChart(svg, node, plot);
    }
    else {
        renderTreemapChart(svg, node, plot);
    }
    return svg;
}
