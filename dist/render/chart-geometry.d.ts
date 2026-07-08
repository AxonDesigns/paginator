import type { ChartCandle, ChartGanttGroupStyle, ChartGanttTask, ChartNode, ChartRingSlice, ChartSeries, ChartText, ChartViewConfig } from '../core/nodes.js';
export declare const CHART_FONT_FAMILY = "system-ui, -apple-system, \"Segoe UI\", sans-serif";
export declare const DEFAULT_CHART_PALETTE: string[];
export declare const INK_PRIMARY = "#0b0b0b";
export declare const INK_SECONDARY = "#52514e";
export declare const INK_MUTED = "#898781";
export declare const GRIDLINE_COLOR = "#e1e0d9";
export declare const AXIS_COLOR = "#c3c2b7";
export declare const SURFACE_COLOR = "#ffffff";
export declare const BAR_MAX_THICKNESS = 24;
export declare const BAR_CORNER_RADIUS = 4;
export declare const MARK_SURFACE_GAP = 2;
export declare const LINE_STROKE_WIDTH = 2;
export declare const MARKER_RADIUS = 4;
export declare const MARKER_RING_RADIUS = 6;
export declare function resolveMarkerRadii(radius?: number): {
    radius: number;
    ringRadius: number;
};
export declare function resolveBubbleRadius(size: number, sizeMin: number, sizeMax: number, scaleType: 'sqrt' | 'linear', range: readonly [number, number]): number;
export declare function estimateTextWidth(text: string, fontSize: number): number;
export declare function textBaselineOffset(fontSize: number): number;
export declare function truncateToWidth(text: ChartText, maxWidth: number, fontSize: number): ChartText;
export type ResolvedChartTextRun = {
    text: string;
    fontSize: number;
    color: string;
    opacity: number;
    fontWeight?: number | string;
    fontStyle?: 'normal' | 'italic';
};
export declare function normalizeChartText(content: ChartText, defaults: {
    fontSize: number;
    color: string;
}): ResolvedChartTextRun[][];
export declare function estimateChartTextWidth(content: ChartText, baseFontSize: number): number;
export declare function wrapChartTextToWidth(content: ChartText, maxWidth: number, baseFontSize: number, baseColor: string): ResolvedChartTextRun[][];
export declare function resolveColor(explicit: string | undefined, overridePalette: string[] | undefined, index: number): string;
export declare function ringSliceColor(node: {
    colors?: string[];
}, ring: {
    colors?: string[];
}, slice: {
    color?: string;
}, si: number): string;
export declare function barPath(x: number, y: number, w: number, h: number, round: 'top' | 'bottom' | 'left' | 'right' | 'none', cornerRadius?: number): string;
export declare function roundedRectPath(x: number, y: number, w: number, h: number, radius: number): string;
export declare const DEFAULT_AREA_FILL_OPACITY = 0.25;
export declare function resolveLineFill(series: ChartSeries, resolvedColor: string): {
    color: string;
    opacity: number;
} | null;
export declare function linePath(points: readonly (readonly [number, number])[], curve: 'linear' | 'monotone', axis: 'x' | 'y'): string;
export declare function areaPath(points: readonly (readonly [number, number])[], curve: 'linear' | 'monotone', axis: 'x' | 'y', baselineCoord: number): string;
export declare function areaFillGradientVector(points: readonly (readonly [number, number])[], axis: 'x' | 'y', baselineCoord: number): {
    from: number;
    to: number;
};
export type StackedSegment = {
    seriesIndex: number;
    valueStart: number;
    valueEnd: number;
    round: 'top' | 'bottom' | 'none';
    /** True only for the single segment sitting flush against the TRUE zero baseline — i.e. there's
     *  no segment on the other side of zero for this category. When both positive and negative values
     *  are present, the zero line is an INTERNAL boundary shared by two touching segments (the last
     *  positive one and the first negative one) and gets the same gap inset as any other boundary. */
    startIsBaseline: boolean;
};
export declare function stackedBarSegments(values: number[]): StackedSegment[];
export declare function stackedSegmentPixelRange(seg: StackedSegment, scale: (value: number) => number, gap: number): {
    coordStart: number;
    length: number;
} | null;
export declare function offsetEdgePoint(cx: number, cy: number, angleDeg: number, halfGapPx: number, sign: 1 | -1, radius: number): [number, number];
export declare function offsetApex(cx: number, cy: number, startAngleDeg: number, endAngleDeg: number, halfGapPx: number): [number, number];
export declare function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, halfGapPx?: number): string;
export declare function donutSlicePath(cx: number, cy: number, rInner: number, rOuter: number, startAngle: number, endAngle: number, halfGapPx?: number): string;
export type RingSliceAngle = {
    start: number;
    end: number;
};
export declare function resolveRingSliceAngles(slices: ChartRingSlice[], parentArcs: RingSliceAngle[] | null): RingSliceAngle[];
export type RingRadii = {
    innerR: number;
    outerR: number;
};
export declare function resolveRingRadii(ringCount: number, innerRadiusRatio: number, outerRadius: number): RingRadii[];
export type ChartBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type LegendEntry = {
    label: ChartText;
    color: string;
};
export declare function resolveTitle(node: ChartNode): {
    text: ChartText;
    fontSize: number;
    color: string;
} | null;
export declare function legendEntriesFor(node: ChartNode): LegendEntry[];
export declare function resolveShowLegend(node: ChartNode, entryCount: number): boolean;
export declare function resolveDomainFromExtent(rawMin: number, rawMax: number, view: ChartViewConfig): {
    dataMin: number;
    dataMax: number;
};
export declare function resolveChartDomain(categories: ChartText[], series: ChartSeries[], stacked: boolean, view: ChartViewConfig): {
    dataMin: number;
    dataMax: number;
};
export declare function niceTickValues(min: number, max: number, tickCount: number): number[];
export type GanttRow = {
    kind: 'header';
    label: string;
} | {
    kind: 'task';
    task: ChartGanttTask;
};
export declare function resolveGanttRows(tasks: ChartGanttTask[], showGroupHeaders: boolean): GanttRow[];
export declare const GANTT_GROUP_HEADER_FILL = "#f2f1ec";
export declare function resolveGanttGroupStyle(node: {
    groupHeaderColor?: string;
    groupHeaderBackground?: string;
    groups?: Record<string, ChartGanttGroupStyle>;
}, label: string): {
    color: string;
    background: string;
};
export declare function resolveGanttTaskLabelColor(node: {
    taskLabelColor?: string;
}, task: {
    labelColor?: string;
}): string;
export declare function radarSpokeAngle(i: number, spokeCount: number): number;
export declare function radarPolygonPoints(cx: number, cy: number, values: number[], domainMin: number, domainMax: number, maxRadius: number): [number, number][];
export declare function polygonPath(points: readonly (readonly [number, number])[]): string;
export declare const CANDLESTICK_UP_COLOR = "#1baf7a";
export declare const CANDLESTICK_DOWN_COLOR = "#e34948";
export type CandlestickGeometry = {
    wickX: number;
    wickY1: number;
    wickY2: number;
    bodyX: number;
    bodyY: number;
    bodyWidth: number;
    bodyHeight: number;
    isUp: boolean;
};
export declare function candlestickGeometry(candle: ChartCandle, centerX: number, scale: (value: number) => number, candleWidth: number): CandlestickGeometry;
export declare function squarifyTreemap(items: readonly {
    value: number;
}[], box: ChartBox): ChartBox[];
