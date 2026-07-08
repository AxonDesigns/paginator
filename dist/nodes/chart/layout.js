// Chart sizing is pure arithmetic from declared width/height/aspectRatio, same as image.ts and for
// the same reason: paginate() must stay synchronous, so nothing here can depend on measuring
// rendered SVG text (axis tick labels, legend entries, etc.) — that measurement-dependent layout
// happens later, in chart/dom.ts (chart-render.ts) and chart/pdf.ts, using fixed heuristic margins
// instead.
// chart()'s constructor already guarantees at least one of height/aspectRatio is present, so the
// fallback branch here is unreachable in practice — kept as a defensive error rather than a silent
// NaN if a node is ever hand-built bypassing the chart() builder.
function resolveHeight(node, width) {
    if (node.height !== undefined)
        return node.height;
    if (node.aspectRatio !== undefined)
        return width / node.aspectRatio;
    throw new Error('[paginator] chart node has neither "height" nor "aspectRatio" — use the chart() builder, which validates this upfront.');
}
// The width this chart would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing, mirroring imageNaturalWidth.
export function chartNaturalWidth(node, availableWidth) {
    if (node.width !== undefined)
        return node.width;
    if (node.height !== undefined && node.aspectRatio !== undefined)
        return node.height * node.aspectRatio;
    return availableWidth;
}
export function measureChartHeight(node, width) {
    return resolveHeight(node, width);
}
export function layoutChart(node, width) {
    return { type: 'chart', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node };
}
