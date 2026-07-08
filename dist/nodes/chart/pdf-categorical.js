// PDF drawing for the merged bar+line 'categorical' chart kind — split out of pdf.ts (see that
// file's header comment). Mirrors src/render/chart-render-categorical.ts field-for-field on the SVG
// side.
import { resolvePdfColor } from "../../render/pdf-render.js";
import { AXIS_COLOR, BAR_CORNER_RADIUS, BAR_MAX_THICKNESS, CHART_FONT_FAMILY, GRIDLINE_COLOR, INK_MUTED, LINE_STROKE_WIDTH, MARK_SURFACE_GAP, SURFACE_COLOR, areaFillGradientVector, areaPath, barPath, estimateChartTextWidth, linePath, niceTickValues, resolveChartDomain, resolveColor, resolveLineFill, resolveMarkerRadii, stackedBarSegments, stackedSegmentPixelRange, textBaselineOffset, } from "../../render/chart-geometry.js";
import { drawChartAreaFill, drawChartCircle, drawChartLine, drawChartPath, drawChartPathStroke, drawChartText } from "./pdf.js";
function seriesKind(s) {
    return s.kind ?? 'bar';
}
function barSeriesWithIndex(series) {
    return series.map((s, i) => ({ s, i })).filter(({ s }) => seriesKind(s) === 'bar');
}
// Vertical/horizontal are two dedicated paths, not one axis-agnostic function — see
// chart-render-categorical.ts's renderCategoricalChart for the full rationale (mirrors
// group.ts's layoutRow/layoutColumn split).
export function drawCategoricalChart(ctx, node, plot, originX, originY) {
    const categories = node.categories;
    const series = node.series;
    const colors = series.map((s, i) => resolvePdfColor(resolveColor(s.color, node.colors, i)));
    const stacked = (node.barMode ?? 'grouped') === 'stacked';
    const { dataMin, dataMax } = resolveChartDomain(categories, series, stacked, node.view ?? {});
    const axis = node.axis ?? {};
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
    const axisColor = resolvePdfColor(axis.color ?? AXIS_COLOR);
    const gridlineColor = resolvePdfColor(axis.gridlineColor ?? GRIDLINE_COLOR);
    const tickColor = resolvePdfColor(axis.tickColor ?? INK_MUTED);
    if ((node.orientation ?? 'vertical') === 'horizontal') {
        drawHorizontalCategoricalChart(ctx, node, plot, originX, originY, {
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
            const gy = yScale(tick);
            drawChartLine(ctx, plotLeft, gy, plotRight, gy, gridlineColor, 1, originX, originY);
        }
    }
    if (axisShow) {
        for (const tick of ticks) {
            const ty = yScale(tick);
            drawChartText(ctx, formatTick(tick), plotLeft - 8, ty + tickBaselineOffset, { fontSize: tickFontSize, color: tickColor, anchor: 'end', bold: false, fontFamily }, originX, originY);
        }
        drawChartLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, axisColor, 1, originX, originY);
    }
    const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth;
    const labelEstWidth = Math.max(...categories.map(c => estimateChartTextWidth(c, categoryFontSize)), 1);
    const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Number.POSITIVE_INFINITY;
    if (axisShow) {
        categories.forEach((category, ci) => {
            if (ci % labelStep !== 0)
                return;
            const cx = plotLeft + bandWidth * (ci + 0.5);
            drawChartText(ctx, category, cx, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, color: tickColor, anchor: 'middle', bold: false, fontFamily }, originX, originY);
        });
    }
    // Bar-kind series pass — drawn first so any line/points series layers visually on top of them,
    // matching normal chart-reading order.
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
                drawChartPath(ctx, barPath(barX, range.coordStart, barThickness, range.length, seg.round, cornerRadius), colors[originalIndex], originX, originY);
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
                drawChartPath(ctx, barPath(barX, barY, barThickness, barH, value >= barBaselineValue ? 'top' : 'bottom', cornerRadius), colors[i], originX, originY);
            });
        });
    }
    // Line/points pass — every non-'bar' series, in original order, each resolving its own
    // curve/strokeWidth/markerRadius with a chart-level fallback.
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
                drawChartAreaFill(ctx, areaPath(points, curve, 'x', baselineY), 0, from, 0, to, resolvePdfColor(fill.color), fill.opacity, originX, originY);
            }
            drawChartPathStroke(ctx, linePath(points, curve, 'x'), colors[si], lineStrokeWidth, originX, originY);
        }
        for (const [px, py] of points) {
            drawChartCircle(ctx, px, py, markerRingRadius, resolvePdfColor(SURFACE_COLOR), originX, originY);
            drawChartCircle(ctx, px, py, markerRadius, colors[si], originX, originY);
        }
    });
}
// Mirrors chart-render-categorical.ts's renderHorizontalCategoricalChart field-for-field —
// categories run top-to-bottom, values run left-to-right, bars grow rightward (or leftward below
// the baseline).
function drawHorizontalCategoricalChart(ctx, node, plot, originX, originY, chartCtx) {
    const { categories, series, colors, stacked, dataMin, dataMax, barBaselineValue, axisShow, gridlinesShow, ticks, formatTick, tickFontSize, categoryFontSize, tickBaselineOffset, fontFamily, axisColor, gridlineColor, tickColor } = chartCtx;
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
            drawChartLine(ctx, x, plotTop, x, plotBottom, gridlineColor, 1, originX, originY);
        }
    }
    if (axisShow) {
        for (const tick of ticks) {
            const x = xScale(tick);
            drawChartText(ctx, formatTick(tick), x, plotBottom + tickFontSize + 4, { fontSize: tickFontSize, color: tickColor, anchor: 'middle', bold: false, fontFamily }, originX, originY);
        }
        drawChartLine(ctx, plotLeft, plotTop, plotLeft, plotBottom, axisColor, 1, originX, originY);
    }
    const bandHeight = categories.length > 0 ? plotHeight / categories.length : plotHeight;
    const labelEstHeight = categoryFontSize + 4;
    const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstHeight / Math.max(bandHeight, 1))) : Number.POSITIVE_INFINITY;
    if (axisShow) {
        categories.forEach((category, ci) => {
            if (ci % labelStep !== 0)
                return;
            const y = plotTop + bandHeight * (ci + 0.5);
            drawChartText(ctx, category, plotLeft - 8, y + tickBaselineOffset, { fontSize: categoryFontSize, color: tickColor, anchor: 'end', bold: false, fontFamily }, originX, originY);
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
                drawChartPath(ctx, barPath(range.coordStart, barY, range.length, barThickness, round, cornerRadius), colors[originalIndex], originX, originY);
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
                drawChartPath(ctx, barPath(barX, barY, barW, barThickness, value >= barBaselineValue ? 'right' : 'left', cornerRadius), colors[i], originX, originY);
            });
        });
    }
    // Line/points pass — see drawCategoricalChart above for the full rationale.
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
                drawChartAreaFill(ctx, areaPath(points, curve, 'y', baselineX), from, 0, to, 0, resolvePdfColor(fill.color), fill.opacity, originX, originY);
            }
            drawChartPathStroke(ctx, linePath(points, curve, 'y'), colors[si], lineStrokeWidth, originX, originY);
        }
        for (const [px, py] of points) {
            drawChartCircle(ctx, px, py, markerRingRadius, resolvePdfColor(SURFACE_COLOR), originX, originY);
            drawChartCircle(ctx, px, py, markerRadius, colors[si], originX, originY);
        }
    });
}
