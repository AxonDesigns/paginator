// SVG (on-screen) rendering for the merged bar+line 'categorical' chart kind — split out of
// chart-render.ts (see that file's header comment for why chart-kind rendering lives in its own
// per-family file). Mirrored field-for-field by src/nodes/chart/pdf-categorical.ts on the PDF side.
import { AXIS_COLOR, BAR_CORNER_RADIUS, BAR_MAX_THICKNESS, CHART_FONT_FAMILY, GRIDLINE_COLOR, INK_MUTED, LINE_STROKE_WIDTH, MARK_SURFACE_GAP, SURFACE_COLOR, areaFillGradientVector, areaPath, barPath, estimateChartTextWidth, linePath, niceTickValues, resolveChartDomain, resolveColor, resolveLineFill, resolveMarkerRadii, stackedBarSegments, stackedSegmentPixelRange, textBaselineOffset, } from "./chart-geometry.js";
import { appendAreaFillGradient, svgEl, svgText } from "./chart-render.js";
// A series' effective kind, defaulted the same way everywhere (chart(), domain resolution, and both
// renderers all need this exact same default, so it's not repeated ad hoc at each call site).
function seriesKind(s) {
    return s.kind ?? 'bar';
}
// `series` in original author order, paired with that original index — needed everywhere a
// bar-only subset is drawn, since `colors[]` (and any per-series identity) is indexed by the
// ORIGINAL series array, not by position within the bar-only subset.
function barSeriesWithIndex(series) {
    return series.map((s, i) => ({ s, i })).filter(({ s }) => seriesKind(s) === 'bar');
}
// Vertical/horizontal are handled as two dedicated code paths rather than one generic axis-agnostic
// function — same reasoning group-layout.ts gives for layoutRow/layoutColumn: forcing both through
// one path would obscure which concrete axis carries which kind of label (ticks vs. categories,
// each with a different margin/anchor/offset), and the two are similar enough to keep side by side
// but different enough that a forced abstraction would cost more clarity than it saves.
export function renderCategoricalChart(svg, node, plot) {
    const categories = node.categories;
    const series = node.series;
    const colors = series.map((s, i) => resolveColor(s.color, node.colors, i));
    const stacked = (node.barMode ?? 'grouped') === 'stacked';
    const { dataMin, dataMax } = resolveChartDomain(categories, series, stacked, node.view ?? {});
    const axis = node.axis ?? {};
    // Bars conventionally grow from zero, but if the visible domain doesn't include it (e.g. a
    // zoomed-in view.domain like {min: 50, max: 80}, or an 'auto' domain over all-positive data),
    // there's nothing sensible to grow from except the domain's own nearer edge — same visual effect
    // as a value bar simply getting clipped at the plot boundary.
    const barBaselineValue = Math.max(dataMin, Math.min(dataMax, 0));
    const axisShow = axis.show !== false;
    const gridlinesShow = axisShow && axis.gridlines !== false;
    const tickCount = axis.tickCount ?? 5;
    const formatTick = axis.formatTick ?? ((v) => Math.round(v).toLocaleString());
    const ticks = niceTickValues(dataMin, dataMax, tickCount);
    const tickFontSize = axis.tickFontSize ?? 11;
    const categoryFontSize = axis.categoryFontSize ?? 11;
    const tickBaselineOffset = textBaselineOffset(tickFontSize);
    const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY;
    const axisColor = axis.color ?? AXIS_COLOR;
    const gridlineColor = axis.gridlineColor ?? GRIDLINE_COLOR;
    const tickColor = axis.tickColor ?? INK_MUTED;
    if ((node.orientation ?? 'vertical') === 'horizontal') {
        renderHorizontalCategoricalChart(svg, node, plot, {
            categories,
            series,
            colors,
            stacked,
            dataMin,
            dataMax,
            barBaselineValue,
            axisShow,
            gridlinesShow,
            ticks,
            formatTick,
            tickFontSize,
            categoryFontSize,
            tickBaselineOffset,
            fontFamily,
            axisColor,
            gridlineColor,
            tickColor,
        });
        return;
    }
    // Distance from the plot's bottom axis line down to the category label's text baseline — scales
    // with categoryFontSize so a bigger label doesn't collide with the axis line above it.
    const categoryLabelOffset = categoryFontSize + 8;
    const leftMargin = axisShow ? Math.max(30, Math.max(...ticks.map(t => estimateChartTextWidth(formatTick(t), tickFontSize))) + 20) : 4;
    const bottomMargin = axisShow ? categoryLabelOffset + 6 : 4;
    const plotLeft = plot.x + leftMargin;
    const plotRight = plot.x + plot.width - 8;
    const plotTop = plot.y + 8;
    const plotBottom = plot.y + plot.height - bottomMargin;
    const plotWidth = Math.max(0, plotRight - plotLeft);
    const plotHeight = Math.max(0, plotBottom - plotTop);
    const yScale = (value) => plotBottom - ((value - dataMin) / (dataMax - dataMin)) * plotHeight;
    if (gridlinesShow) {
        for (const tick of ticks) {
            const y = yScale(tick);
            svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: y, y2: y, stroke: gridlineColor, 'stroke-width': 1 }));
        }
    }
    if (axisShow) {
        for (const tick of ticks) {
            const y = yScale(tick);
            svg.appendChild(svgText(formatTick(tick), plotLeft - 8, y + tickBaselineOffset, { fontSize: tickFontSize, fontFamily, fill: tickColor, 'text-anchor': 'end' }));
        }
        svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: plotBottom, y2: plotBottom, stroke: axisColor, 'stroke-width': 1 }));
    }
    const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth;
    const labelEstWidth = Math.max(...categories.map(c => estimateChartTextWidth(c, categoryFontSize)), 1);
    const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Infinity;
    if (axisShow) {
        categories.forEach((category, ci) => {
            if (ci % labelStep !== 0)
                return;
            const x = plotLeft + bandWidth * (ci + 0.5);
            svg.appendChild(svgText(category, x, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, fontFamily, fill: tickColor, 'text-anchor': 'middle' }));
        });
    }
    // Bar-kind series pass — drawn first so any line/points series layers visually on top of them,
    // matching normal chart-reading order (see chart-render.ts's header comment on the two-pass split).
    const barSeries = barSeriesWithIndex(series);
    if (stacked && barSeries.length > 0) {
        const segmentGap = node.barSegmentGap ?? 0;
        const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandWidth - MARK_SURFACE_GAP * 2));
        const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS;
        categories.forEach((_, ci) => {
            const bandX = plotLeft + bandWidth * ci;
            const barX = bandX + (bandWidth - barThickness) / 2;
            const values = barSeries.map(({ s }) => s.data[ci]);
            for (const seg of stackedBarSegments(values)) {
                const range = stackedSegmentPixelRange(seg, yScale, segmentGap);
                if (range === null)
                    continue;
                const originalIndex = barSeries[seg.seriesIndex].i;
                svg.appendChild(svgEl('path', { d: barPath(barX, range.coordStart, barThickness, range.length, seg.round, cornerRadius), fill: colors[originalIndex] }));
            }
        });
    }
    else if (barSeries.length > 0) {
        const rawThickness = (bandWidth - MARK_SURFACE_GAP * (barSeries.length + 1)) / barSeries.length;
        const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness));
        const groupWidth = barThickness * barSeries.length + MARK_SURFACE_GAP * Math.max(barSeries.length - 1, 0);
        const zeroY = yScale(barBaselineValue);
        const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS;
        categories.forEach((_, ci) => {
            const bandX = plotLeft + bandWidth * ci;
            const groupStart = bandX + (bandWidth - groupWidth) / 2;
            barSeries.forEach(({ s, i }, vi) => {
                const value = s.data[ci];
                const barX = groupStart + vi * (barThickness + MARK_SURFACE_GAP);
                const valueY = yScale(value);
                const barY = Math.min(zeroY, valueY);
                const barH = Math.abs(valueY - zeroY);
                if (barH <= 0)
                    return;
                svg.appendChild(svgEl('path', { d: barPath(barX, barY, barThickness, barH, value >= barBaselineValue ? 'top' : 'bottom', cornerRadius), fill: colors[i] }));
            });
        });
    }
    // Line/points pass — every non-'bar' series, in original order, each resolving its own
    // curve/strokeWidth/markerRadius with a chart-level fallback (ChartSeries's per-series override
    // fields — see nodes.ts).
    series.forEach((s, si) => {
        const kind = seriesKind(s);
        if (kind === 'bar')
            return;
        const points = categories.map((_, ci) => [plotLeft + bandWidth * (ci + 0.5), yScale(s.data[ci])]);
        const curve = s.curve ?? node.lineCurve ?? 'linear';
        const { radius: markerRadius, ringRadius: markerRingRadius } = resolveMarkerRadii(s.markerRadius ?? node.markerRadius);
        if (kind === 'line') {
            const lineStrokeWidth = s.strokeWidth ?? node.lineStrokeWidth ?? LINE_STROKE_WIDTH;
            const fill = resolveLineFill(s, colors[si]);
            if (fill !== null) {
                const baselineY = yScale(barBaselineValue);
                const { from, to } = areaFillGradientVector(points, 'x', baselineY);
                const gradientId = appendAreaFillGradient(svg, 'x', from, to, fill.color, fill.opacity);
                svg.appendChild(svgEl('path', { d: areaPath(points, curve, 'x', baselineY), fill: `url(#${gradientId})` }));
            }
            svg.appendChild(svgEl('path', {
                d: linePath(points, curve, 'x'),
                fill: 'none',
                stroke: colors[si],
                'stroke-width': lineStrokeWidth,
                'stroke-linejoin': 'round',
                'stroke-linecap': 'round',
            }));
        }
        // 'line' and 'points' both draw markers — 'points' is exactly this marker pass alone.
        for (const [x, y] of points) {
            svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRingRadius, fill: SURFACE_COLOR }));
            svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRadius, fill: colors[si] }));
        }
    });
}
// Categories run top-to-bottom along the y-axis; values run left-to-right along the x-axis (bars
// grow rightward, or leftward below the baseline). Mirrors the vertical path above field-for-field
// with the two axes' roles swapped — see that function's header comment for why this is a separate
// path rather than a shared abstraction.
function renderHorizontalCategoricalChart(svg, node, plot, ctx) {
    const { categories, series, colors, stacked, dataMin, dataMax, barBaselineValue, axisShow, gridlinesShow, ticks, formatTick, tickFontSize, categoryFontSize, tickBaselineOffset, fontFamily, axisColor, gridlineColor, tickColor } = ctx;
    const leftMargin = axisShow ? Math.max(30, Math.max(...categories.map(c => estimateChartTextWidth(c, categoryFontSize))) + 16) : 4;
    const bottomMargin = axisShow ? tickFontSize + 20 : 4;
    const plotLeft = plot.x + leftMargin;
    const plotRight = plot.x + plot.width - 8;
    const plotTop = plot.y + 8;
    const plotBottom = plot.y + plot.height - bottomMargin;
    const plotWidth = Math.max(0, plotRight - plotLeft);
    const plotHeight = Math.max(0, plotBottom - plotTop);
    const xScale = (value) => plotLeft + ((value - dataMin) / (dataMax - dataMin)) * plotWidth;
    if (gridlinesShow) {
        for (const tick of ticks) {
            const x = xScale(tick);
            svg.appendChild(svgEl('line', { x1: x, x2: x, y1: plotTop, y2: plotBottom, stroke: gridlineColor, 'stroke-width': 1 }));
        }
    }
    if (axisShow) {
        for (const tick of ticks) {
            const x = xScale(tick);
            svg.appendChild(svgText(formatTick(tick), x, plotBottom + tickFontSize + 4, { fontSize: tickFontSize, fontFamily, fill: tickColor, 'text-anchor': 'middle' }));
        }
        svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotLeft, y1: plotTop, y2: plotBottom, stroke: axisColor, 'stroke-width': 1 }));
    }
    const bandHeight = categories.length > 0 ? plotHeight / categories.length : plotHeight;
    const labelEstHeight = categoryFontSize + 4;
    const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstHeight / Math.max(bandHeight, 1))) : Infinity;
    if (axisShow) {
        categories.forEach((category, ci) => {
            if (ci % labelStep !== 0)
                return;
            const y = plotTop + bandHeight * (ci + 0.5);
            svg.appendChild(svgText(category, plotLeft - 8, y + tickBaselineOffset, { fontSize: categoryFontSize, fontFamily, fill: tickColor, 'text-anchor': 'end' }));
        });
    }
    const barSeries = barSeriesWithIndex(series);
    if (stacked && barSeries.length > 0) {
        const segmentGap = node.barSegmentGap ?? 0;
        const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandHeight - MARK_SURFACE_GAP * 2));
        const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS;
        categories.forEach((_, ci) => {
            const bandY = plotTop + bandHeight * ci;
            const barY = bandY + (bandHeight - barThickness) / 2;
            const values = barSeries.map(({ s }) => s.data[ci]);
            for (const seg of stackedBarSegments(values)) {
                const range = stackedSegmentPixelRange(seg, xScale, segmentGap);
                if (range === null)
                    continue;
                const round = seg.round === 'top' ? 'right' : seg.round === 'bottom' ? 'left' : 'none';
                const originalIndex = barSeries[seg.seriesIndex].i;
                svg.appendChild(svgEl('path', { d: barPath(range.coordStart, barY, range.length, barThickness, round, cornerRadius), fill: colors[originalIndex] }));
            }
        });
    }
    else if (barSeries.length > 0) {
        const rawThickness = (bandHeight - MARK_SURFACE_GAP * (barSeries.length + 1)) / barSeries.length;
        const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness));
        const groupHeight = barThickness * barSeries.length + MARK_SURFACE_GAP * Math.max(barSeries.length - 1, 0);
        const zeroX = xScale(barBaselineValue);
        const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS;
        categories.forEach((_, ci) => {
            const bandY = plotTop + bandHeight * ci;
            const groupStart = bandY + (bandHeight - groupHeight) / 2;
            barSeries.forEach(({ s, i }, vi) => {
                const value = s.data[ci];
                const barY = groupStart + vi * (barThickness + MARK_SURFACE_GAP);
                const valueX = xScale(value);
                const barX = Math.min(zeroX, valueX);
                const barW = Math.abs(valueX - zeroX);
                if (barW <= 0)
                    return;
                svg.appendChild(svgEl('path', { d: barPath(barX, barY, barW, barThickness, value >= barBaselineValue ? 'right' : 'left', cornerRadius), fill: colors[i] }));
            });
        });
    }
    // Line/points pass — see the vertical path above for the full rationale (per-series style
    // resolution, 'points' as a bare marker pass).
    series.forEach((s, si) => {
        const kind = seriesKind(s);
        if (kind === 'bar')
            return;
        const points = categories.map((_, ci) => [xScale(s.data[ci]), plotTop + bandHeight * (ci + 0.5)]);
        const curve = s.curve ?? node.lineCurve ?? 'linear';
        const { radius: markerRadius, ringRadius: markerRingRadius } = resolveMarkerRadii(s.markerRadius ?? node.markerRadius);
        if (kind === 'line') {
            const lineStrokeWidth = s.strokeWidth ?? node.lineStrokeWidth ?? LINE_STROKE_WIDTH;
            const fill = resolveLineFill(s, colors[si]);
            if (fill !== null) {
                const baselineX = xScale(barBaselineValue);
                const { from, to } = areaFillGradientVector(points, 'y', baselineX);
                const gradientId = appendAreaFillGradient(svg, 'y', from, to, fill.color, fill.opacity);
                svg.appendChild(svgEl('path', { d: areaPath(points, curve, 'y', baselineX), fill: `url(#${gradientId})` }));
            }
            svg.appendChild(svgEl('path', {
                d: linePath(points, curve, 'y'),
                fill: 'none',
                stroke: colors[si],
                'stroke-width': lineStrokeWidth,
                'stroke-linejoin': 'round',
                'stroke-linecap': 'round',
            }));
        }
        for (const [x, y] of points) {
            svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRingRadius, fill: SURFACE_COLOR }));
            svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRadius, fill: colors[si] }));
        }
    });
}
