// SVG (on-screen) rendering for the 'treemap' chart kind — flat, single-level, squarified layout
// (see chart-geometry.ts's squarifyTreemap for the algorithm itself). Zero axis/domain machinery at
// all — no ticks, gridlines, or axis chrome; the whole plot box IS the treemap. Split out of
// chart-render.ts (see that file's header comment). Mirrored field-for-field by
// src/nodes/chart/pdf-treemap.ts on the PDF side.
import { CHART_FONT_FAMILY, MARK_SURFACE_GAP, SURFACE_COLOR, estimateChartTextWidth, normalizeChartText, resolveColor, squarifyTreemap } from "./chart-geometry.js";
import { svgEl, svgText } from "./chart-render.js";
export function renderTreemapChart(svg, node, plot) {
    const items = node.items;
    const colors = items.map((item, i) => resolveColor(item.color, node.colors, i));
    const itemGap = node.itemGap ?? MARK_SURFACE_GAP;
    const labelFontSize = node.labelFontSize ?? 12;
    const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY;
    const rects = squarifyTreemap(items, plot);
    items.forEach((item, i) => {
        const r = rects[i];
        // Every rectangle's OWN edges get inset by half the gap (see TreemapChartNode.itemGap's header
        // comment for why this differs from a stacked bar's flush-outer-edge exception).
        const x = r.x + itemGap / 2;
        const y = r.y + itemGap / 2;
        const width = Math.max(0, r.width - itemGap);
        const height = Math.max(0, r.height - itemGap);
        if (width <= 0 || height <= 0)
            return;
        svg.appendChild(svgEl('rect', { x, y, width, height, fill: colors[i] }));
        // Fit-check against the general ChartText line-splitting mechanism (see ChartTextRun in
        // nodes.ts): an empty/all-blank result (formatLabel returning '' to hide small items, same as
        // ever) or a block too wide/tall for this rectangle simply omits the label — svgText() itself
        // now handles the actual multi-run/multi-line DRAWING in one call, so this file only needs the
        // fit decision, not its own line-splitting/positioning.
        const label = node.formatLabel?.(item) ?? item.label;
        const lines = normalizeChartText(label, { fontSize: labelFontSize, color: '' });
        const hasContent = lines.some(line => line.length > 0);
        const lineHeight = Math.round(labelFontSize * 1.2);
        const totalHeight = lines.length * lineHeight;
        const widestLineWidth = estimateChartTextWidth(label, labelFontSize);
        if (hasContent && widestLineWidth + 8 <= width && totalHeight + 6 <= height) {
            // White label text on a colored fill — every other chart here only ever puts text on the
            // plain white plot surface, so this is a genuinely new situation; white reads acceptably
            // against this palette's mid-to-dark saturated swatches without a full contrast computation
            // this codebase has no other precedent for.
            svg.appendChild(svgText(label, x + 4, y + labelFontSize + 2, { fontSize: labelFontSize, fontFamily, fill: SURFACE_COLOR, 'text-anchor': 'start' }));
        }
    });
}
