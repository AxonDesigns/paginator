// SVG (on-screen) rendering for the 'radar'/spider chart kind — one closed polygon per series,
// vertices at evenly-spaced spokes around a shared radial domain. Split out of chart-render.ts
// (see that file's header comment). Mirrored field-for-field by src/nodes/chart/pdf-radar.ts on
// the PDF side.
import { AXIS_COLOR, CHART_FONT_FAMILY, GRIDLINE_COLOR, INK_MUTED, LINE_STROKE_WIDTH, MARKER_RADIUS, SURFACE_COLOR, niceTickValues, polygonPath, radarPolygonPoints, radarSpokeAngle, resolveChartDomain, resolveColor, resolveLineFill, resolveMarkerRadii, textBaselineOffset, } from "./chart-geometry.js";
import { svgEl, svgText } from "./chart-render.js";
export function renderRadarChart(svg, node, plot) {
    const categories = node.categories;
    const series = node.series;
    const colors = series.map((s, i) => resolveColor(s.color, node.colors, i));
    const spokeCount = categories.length;
    // Reuses the categorical (non-stacked) domain path — every series just contributes its own raw
    // values, exactly like a multi-line chart's shared y-domain.
    const { dataMin, dataMax } = resolveChartDomain(categories, series, false, node.view ?? {});
    const axis = node.axis ?? {};
    const axisShow = axis.show !== false;
    const gridlinesShow = axisShow && axis.gridlines !== false;
    const tickFontSize = axis.tickFontSize ?? 11;
    const categoryFontSize = axis.categoryFontSize ?? 11;
    const formatTick = axis.formatTick ?? ((v) => Math.round(v).toLocaleString());
    const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY;
    const gridlineColor = axis.gridlineColor ?? GRIDLINE_COLOR;
    const axisColor = axis.color ?? AXIS_COLOR;
    const tickColor = axis.tickColor ?? INK_MUTED;
    const ticks = niceTickValues(dataMin, dataMax, axis.tickCount ?? 5);
    const cx = plot.x + plot.width / 2;
    const cy = plot.y + plot.height / 2;
    const labelMargin = axisShow ? 28 : 8;
    const outerRadius = Math.max(0, Math.min(plot.width, plot.height) / 2 - labelMargin);
    if (gridlinesShow) {
        for (const tick of ticks) {
            const r = Math.max(0, ((tick - dataMin) / (dataMax - dataMin || 1)) * outerRadius);
            svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: gridlineColor, 'stroke-width': 1 }));
        }
        for (let i = 0; i < spokeCount; i++) {
            const angle = (radarSpokeAngle(i, spokeCount) * Math.PI) / 180;
            svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: cx + outerRadius * Math.cos(angle), y2: cy + outerRadius * Math.sin(angle), stroke: axisColor, 'stroke-width': 1 }));
        }
    }
    if (axisShow) {
        // Radius VALUE labels drawn along the top spoke only (a standard radar-chart convention — one
        // labeled axis is enough to read the scale, labeling every spoke would be redundant clutter).
        const tickBaselineOffset = textBaselineOffset(tickFontSize);
        for (const tick of ticks) {
            const r = Math.max(0, ((tick - dataMin) / (dataMax - dataMin || 1)) * outerRadius);
            svg.appendChild(svgText(formatTick(tick), cx + 4, cy - r + tickBaselineOffset, { fontSize: tickFontSize, fontFamily, fill: tickColor, 'text-anchor': 'start' }));
        }
        // Category labels just beyond the outer ring — anchor flips by which side of the circle the
        // spoke falls on, so labels read outward from the shape instead of overlapping it.
        const categoryBaselineOffset = textBaselineOffset(categoryFontSize);
        categories.forEach((category, i) => {
            const angleDeg = radarSpokeAngle(i, spokeCount);
            const angle = (angleDeg * Math.PI) / 180;
            const cosA = Math.cos(angle);
            const anchor = cosA > 0.3 ? 'start' : cosA < -0.3 ? 'end' : 'middle';
            const labelR = outerRadius + 10;
            svg.appendChild(svgText(category, cx + labelR * cosA, cy + labelR * Math.sin(angle) + categoryBaselineOffset, { fontSize: categoryFontSize, fontFamily, fill: tickColor, 'text-anchor': anchor }));
        });
    }
    const lineStrokeWidth = node.lineStrokeWidth ?? LINE_STROKE_WIDTH;
    const markerRadius = node.markerRadius ?? MARKER_RADIUS;
    series.forEach((s, si) => {
        const points = radarPolygonPoints(cx, cy, s.data, dataMin, dataMax, outerRadius);
        const fill = resolveLineFill(s, colors[si]);
        if (fill !== null) {
            svg.appendChild(svgEl('path', { d: polygonPath(points), fill: fill.color, 'fill-opacity': fill.opacity }));
        }
        svg.appendChild(svgEl('path', { d: polygonPath(points), fill: 'none', stroke: colors[si], 'stroke-width': lineStrokeWidth, 'stroke-linejoin': 'round' }));
        if (markerRadius > 0) {
            const { radius: r, ringRadius } = resolveMarkerRadii(markerRadius);
            for (const [x, y] of points) {
                svg.appendChild(svgEl('circle', { cx: x, cy: y, r: ringRadius, fill: SURFACE_COLOR }));
                svg.appendChild(svgEl('circle', { cx: x, cy: y, r, fill: colors[si] }));
            }
        }
    });
}
