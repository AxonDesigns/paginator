export type Margins = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};
export type PageSize = 'A4' | 'Letter' | {
    width: number;
    height: number;
};
export type HeaderFooterContext = {
    pageNumber: number;
    totalPages: number;
};
export type HeaderFooterContent = Node | ((ctx: HeaderFooterContext) => Node);
export type WatermarkBase = {
    /** 0-1. Default 0.15. */
    opacity?: number;
    /** Degrees, clockwise. Default -45 (classic diagonal stamp). */
    rotation?: number;
    /** Repeat in a grid across the whole page instead of a single centered instance. Default false. */
    tile?: boolean;
    /** px gap between tiled repeats. Only meaningful when `tile` is true. */
    tileGapX?: number;
    tileGapY?: number;
};
export type TextWatermark = WatermarkBase & {
    kind: 'text';
    text: string;
    /** Falls back to a built-in bold Helvetica when omitted — no registerFont() warning, since no
     *  family was ever requested. */
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    /** px. Default 72. */
    fontSize?: number;
    /** Default '#000000'. */
    color?: string;
    /** Default false: generatePdf() rasterizes the text to a transparent PNG and draws it as an image,
     *  so it can't be selected/copied out of the PDF (pdfkit's `.text()` otherwise embeds real,
     *  selectable/searchable glyphs like any other text in the document — rarely desired for a
     *  decorative stamp like "CONFIDENTIAL" sitting over real body content). Set `true` to keep it as
     *  live vector text instead. Only affects generatePdf() — the on-screen preview's watermark is
     *  always `pointer-events: none` regardless of this flag, since it's decorative-only and never a
     *  hit-test/interaction target. */
    selectable?: boolean;
};
export type ImageWatermark = WatermarkBase & {
    kind: 'image';
    src: string;
    width: number;
    height: number;
};
export type Watermark = TextWatermark | ImageWatermark;
export type WatermarkContent = Watermark | ((ctx: HeaderFooterContext) => Watermark | undefined | null);
export type PageBackgroundContent = string | ((ctx: HeaderFooterContext) => string | undefined | null);
export type PageBorderContent = ContainerBorder | ((ctx: HeaderFooterContext) => ContainerBorder | undefined | null);
export type PageDef = {
    size: PageSize;
    margins: Margins;
    header?: HeaderFooterContent;
    footer?: HeaderFooterContent;
    /** Explicit override in px. If omitted, computed once from the header/footer content
     *  rendered with a placeholder {pageNumber:1,totalPages:1} context. */
    headerHeight?: number;
    footerHeight?: number;
    headerGap?: number;
    footerGap?: number;
    /** Solid page background color. Default white. */
    background?: PageBackgroundContent;
    /** Border drawn around the page's own edge. No `borderRadius` (a page is never clipped/cropped). */
    border?: PageBorderContent;
    /** Decorative overlay drawn on top of every page's content (e.g. a "DRAFT" stamp or logo). */
    watermark?: WatermarkContent;
    body: Node;
};
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type MainAlign = 'start' | 'center' | 'end' | 'space-between' | 'space-around';
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch';
export type TextAlign = 'left' | 'center' | 'right';
export type SelfAlignable = {
    alignSelf?: CrossAlign;
};
export type FlexSize = number | `${number}px`;
export type Interactive = {
    interactive?: boolean;
    /**
     * Only takes effect when `interactive: true` is ALSO set — a node needs both to become a drag
     * source; `interactive` alone still gives hover/click but never starts a drag. Off by default.
     * Text rendered under a draggable node (itself or any descendant, regardless of that
     * descendant's own flags) gets `user-select: none` so a drag gesture can't also trigger native
     * text selection.
     */
    draggable?: boolean;
    /**
     * Marks this node as a valid drop landing zone, independent of `interactive`/`draggable` — a
     * node can be droppable without being interactive itself (e.g. a plain container that exists
     * only to receive drops). Checked via `dropTarget` in `drop` events, resolved the same
     * bubble-up way `interactive` is for hover/click: dropping on a non-droppable descendant still
     * resolves to the nearest droppable ancestor-or-self. Off by default.
     */
    droppable?: boolean;
    /**
     * Only meaningful when `draggable: true`. The type(s) this dragged item carries — checked
     * against a droppable node's `accepts` list to decide which drop zones are valid for it. A
     * single string is shorthand for a one-element list. Left unset, the drag is untyped and treated
     * as a wildcard: it matches every droppable node regardless of that node's `accepts` list
     * (including one that declares an `accepts` list — an untyped drag never gets filtered out).
     */
    dragType?: string | string[];
    /**
     * Only meaningful when `droppable: true`. Restricts which drag types this zone accepts — a drag
     * is valid here if ANY of its `dragType`(s) appear in this list (not "every type must match").
     * Left unset, this zone accepts anything, including untyped drags — purely additive to
     * `droppable` alone, so existing droppable nodes are unaffected until you opt in.
     */
    accepts?: string[];
};
type GroupCommon = Interactive & SelfAlignable & {
    type: 'group';
    mainAlign?: MainAlign;
    crossAlign?: CrossAlign;
    gap?: number;
    /** Only meaningful when this node is itself a ROW child; ignored for column children. */
    flex?: FlexSize;
    children: Node[];
};
export type RowGroupNode = GroupCommon & {
    direction: 'row';
    /**
     * Opts this row into independent per-column page splitting (newspaper/magazine-style): a
     * column that doesn't fit continues on the next page while its shorter siblings simply stop,
     * rather than the whole row moving as one atomic unit. Off by default so an aligned row (e.g. a
     * label/value line) keeps its atomic guarantee — only turn this on for rows whose columns are
     * independent, unrelated flows of content.
     */
    splitColumns?: boolean;
};
export type ColumnGroupNode = GroupCommon & {
    direction: 'column';
};
export type GroupNode = RowGroupNode | ColumnGroupNode;
export type LayoutCursorLike = {
    segmentIndex: number;
    graphemeIndex: number;
};
export type TextNode = Interactive & SelfAlignable & {
    type: 'text';
    content: string;
    fontFamily: string;
    fontSize: number;
    fontWeight?: number | string;
    fontStyle?: 'normal' | 'italic';
    color?: string;
    align?: TextAlign;
    textDecoration?: 'none' | 'underline' | 'line-through';
    /** px. Required — pretext takes line-height at layout time, not baked into prepare(). */
    lineHeight: number;
    letterSpacing?: number;
    whiteSpace?: 'normal' | 'pre-wrap';
    wordBreak?: 'normal' | 'keep-all';
    /** Only meaningful when this node is itself a ROW child; ignored for column children. */
    flex?: FlexSize;
    /** @internal memoized PreparedTextWithSegments, set lazily by the measure layer */
    __prepared?: unknown;
    /** @internal set on synthetic continuation nodes produced by splitting across a page break */
    __resumeCursor?: LayoutCursorLike;
};
export type RichTextRun = {
    text: string;
    /** Falls back to RichTextNode.fontFamily when omitted. */
    fontFamily?: string;
    /** Falls back to RichTextNode.fontSize when omitted. */
    fontSize?: number;
    fontWeight?: number | string;
    fontStyle?: 'normal' | 'italic';
    color?: string;
    textDecoration?: 'none' | 'underline' | 'line-through';
    letterSpacing?: number;
    /** Presence marks this run as an inline link: rendered as a real `<a href>` in the DOM
     *  output and a real pdfkit `.link()` clickable annotation in the PDF output — deliberately
     *  NOT part of the generic interactive/hit-registry system (see the Node union comment below). */
    href?: string;
};
export type RichInlineCursorLike = {
    itemIndex: number;
    segmentIndex: number;
    graphemeIndex: number;
};
export type RichTextNode = Interactive & SelfAlignable & {
    type: 'richText';
    runs: RichTextRun[];
    /** Paragraph-level defaults — any run above that omits a field falls back to this. */
    fontFamily: string;
    fontSize: number;
    fontWeight?: number | string;
    fontStyle?: 'normal' | 'italic';
    color?: string;
    align?: TextAlign;
    textDecoration?: 'none' | 'underline' | 'line-through';
    /** px. Required — pretext takes line-height at layout time, not baked into prepare(). */
    lineHeight: number;
    letterSpacing?: number;
    /** Only meaningful when this node is itself a ROW child; ignored for column children. */
    flex?: FlexSize;
    /** @internal memoized PreparedRichInline, set lazily by the measure layer */
    __prepared?: unknown;
    /** @internal set on synthetic continuation nodes produced by splitting across a page break */
    __resumeCursor?: RichInlineCursorLike;
};
export type SeparatorNode = Interactive & {
    type: 'separator';
    thickness?: number;
    color?: string;
    /** px reserved on each side along the parent's main axis */
    margin?: number;
};
export type PageBreakNode = Interactive & {
    type: 'page-break';
};
export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
export type ImageNode = Interactive & SelfAlignable & {
    type: 'image';
    src: string;
    alt?: string;
    /**
     * At least one of {width & height}, {width & aspectRatio}, {height & aspectRatio}, or
     * {aspectRatio alone} is required — see image(). Dimensions are never auto-detected from the
     * loaded asset (that would make paginate() asynchronous); `objectFit` reconciles any mismatch
     * between the resolved box and the actual image's shape, exactly like the CSS property it maps
     * to on the rendered <img>.
     */
    width?: number;
    height?: number;
    /** width / height. Used to derive whichever of width/height is missing. */
    aspectRatio?: number;
    objectFit?: ObjectFit;
    /** Rounds the image's own painted content (not just a wrapping box) — clips the actual pixels,
     *  unlike wrapping the image in a `container`'s `borderRadius`, which would only decorate around
     *  a still-rectangular image. */
    borderRadius?: number;
    /** 0-1. */
    opacity?: number;
    /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
     *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
     *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
    flex?: FlexSize;
};
export type SvgNode = Interactive & SelfAlignable & {
    type: 'svg';
    /** Raw SVG markup (a full <svg>...</svg> string) — parsed at RENDER time (once per renderer: the
     *  DOM preview inserts it directly, generatePdf() feeds it through svg-to-pdfkit), never at
     *  construction, same "never auto-detected/parsed eagerly" contract ImageNode/ChartNode already
     *  have (see image()). */
    markup: string;
    /**
     * At least one of {width & height}, {width & aspectRatio}, {height & aspectRatio}, or
     * {aspectRatio alone} is required — see svg(), same rule as ImageNode.
     */
    width?: number;
    height?: number;
    /** width / height. Used to derive whichever of width/height is missing. */
    aspectRatio?: number;
    /** 0-1. */
    opacity?: number;
    /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
     *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
     *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
    flex?: FlexSize;
};
export type ContainerBorder = {
    thickness?: number;
    color?: string;
};
export type ContainerNode = Interactive & SelfAlignable & {
    type: 'container';
    child: Node;
    /** Natural/shrink-wrap width in a non-stretch context — same mechanism as ImageNode.width (see
     *  childCrossWidthInColumn in group-layout.ts). Overridden by an ancestor's crossAlign: 'stretch'
     *  or this node's own `alignSelf: 'stretch'`, same known limitation image/chart already have. Also
     *  doubles as the row-slot size when this node is a ROW child and `flex` is left unset. */
    width?: number;
    /** MINIMUM content-box height, NOT exact/clipped — box height is
     *  Math.max(height ?? 0, childNaturalHeight + padding.top + padding.bottom). Not enforced on a
     *  fragment produced by splitting across a page boundary (see container-layout.ts). */
    height?: number;
    /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
     *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
     *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
    flex?: FlexSize;
    padding?: number | Margins;
    background?: string;
    border?: ContainerBorder;
    borderRadius?: number;
};
export type ChartTextRun = {
    /** May contain `'\n'` — forces a line break after this run, continuing the next run on a new
     *  line (rather than needing a separate array entry per line). */
    text: string;
    /** Falls back to the ambient default font size for that text role (e.g. the title's own
     *  `fontSize`, `ChartAxisConfig.tickFontSize`) when this run omits it. */
    fontSize?: number;
    /** Falls back to the ambient default color for that text role when this run omits it. */
    color?: string;
    /** `0-1`. Default 1. */
    opacity?: number;
    fontWeight?: number | string;
    fontStyle?: 'normal' | 'italic';
};
/** A plain `string` means "one run, one line, ambient style" — every existing plain-string caller
 *  keeps working unchanged. A `ChartTextRun[]` opts into per-run styling and/or explicit multi-line
 *  (via `\n` inside any run's `text`). **Throws** if an empty array is given where a label is
 *  required. */
export type ChartText = string | ChartTextRun[];
export type ChartKind = 'categorical' | 'radial' | 'scatter' | 'gantt' | 'radar' | 'candlestick' | 'treemap';
export type ChartSeriesFillConfig = {
    /** Overrides this series' own resolved color as the gradient's opaque end. */
    color?: string;
    /** Opacity at the line, fading linearly to fully transparent at the baseline. Default 0.25. */
    opacity?: number;
};
export type ChartSeriesKind = 'bar' | 'line' | 'points';
export type ChartSeries = {
    name?: ChartText;
    data: number[];
    color?: string;
    /** How THIS series renders, independent of every other series in the same chart — freely mix
     *  e.g. two `'bar'` series (grouped/stacked together — see `CategoricalChartNode.barMode`;
     *  grouping/stacking only ever happens AMONG `'bar'`-kind series, never across kinds) with a
     *  `'line'` series and a `'points'` series (markers only, no connecting stroke), all sharing the
     *  same category x-axis and y-domain. Default `'bar'`. */
    kind?: ChartSeriesKind;
    /** `kind: 'line'` only — chart() throws if set on a `'bar'`/`'points'` series (a stroke-less
     *  "points" series has no line to fill toward a baseline, and a fill under a bar would duplicate
     *  the bar itself). Off by default. Fills the area between this series' line and the baseline
     *  (the same zero/domain-edge baseline bars grow from) with a linear gradient — opaque at the
     *  line, fading to fully transparent at the baseline, so anything behind the chart stays visible
     *  near the bottom. `true` fills with this series' own resolved color at the default opacity; an
     *  object overrides `color` and/or `opacity`. Purely a per-series toggle — unrelated series in
     *  the same chart can mix filled and unfilled lines. */
    fill?: boolean | ChartSeriesFillConfig;
    /** `kind: 'line'`/`'points'` only — per-series override of `CategoricalChartNode.lineCurve`, e.g.
     *  so one series in a mixed chart draws a monotone curve while another stays linear. Falls back
     *  to the chart-level default when unset. */
    curve?: 'linear' | 'monotone';
    /** `kind: 'line'` only — per-series override of `CategoricalChartNode.lineStrokeWidth`. */
    strokeWidth?: number;
    /** `kind: 'line'`/`'points'` only — per-series override of `CategoricalChartNode.markerRadius`
     *  (points ARE markers, so this sizes them the same way a line's data-point markers are sized). */
    markerRadius?: number;
};
export type ChartSlice = {
    label: ChartText;
    value: number;
    color?: string;
};
export type ChartAxisConfig = {
    /** Master toggle for y-axis ticks/labels AND x-axis category labels (bar/line only). Default true. */
    show?: boolean;
    /** Independent of `show` — lets gridlines be turned off while ticks/labels stay. Default true. */
    gridlines?: boolean;
    tickCount?: number;
    formatTick?: (value: number) => ChartText;
    /** Font size (px) of the y-axis numeric tick labels. Independent of `categoryFontSize` since the
     *  two commonly want different weight (e.g. bigger category names, smaller tick numbers). Default 11. */
    tickFontSize?: number;
    /** Font size (px) of the x-axis category labels. Default 11. */
    categoryFontSize?: number;
    /** Axis baseline color. Default a neutral gray. */
    color?: string;
    /** Gridline color. Independent of `color`/`show` — see `gridlines`. Default a lighter neutral gray. */
    gridlineColor?: string;
    /** Text color of BOTH the y-axis tick numbers and the x-axis category labels. Default a muted ink. */
    tickColor?: string;
};
export type ChartViewConfig = {
    /** Controls the y-axis domain (bar/line only).
     *  - Omitted, or `'zero'` (default): auto-computed, always spanning `[min(0, dataMin), max(0,
     *    dataMax)]` (or the stacked-sum equivalent for `barMode: 'stacked'`) — the domain always
     *    includes zero, same as this library's original behavior.
     *  - `'auto'`: auto-computed but tight to the data's own `[dataMin, dataMax]` — does NOT force
     *    zero into the domain — then widened by `padding` on both ends. Lets a tightly-clustered
     *    series (e.g. a temperature line hovering in the 68-79 range) actually show its shape
     *    instead of reading as a nearly flat line pinned against a zero-based domain.
     *  - `{ min?, max? }`: explicit override, wins outright over either auto mode above. Set either
     *    or both bounds — an unset one stays auto-computed the `'zero'` way. If zero falls outside
     *    the resulting domain, bars draw from the domain's own edge instead of zero (there's nothing
     *    else sensible to grow from). */
    domain?: 'zero' | 'auto' | {
        min?: number;
        max?: number;
    };
    /** `domain: 'auto'` only; ignored otherwise. Fraction of the resolved data range (`dataMax -
     *  dataMin`) added below the min and above the max — e.g. `0.1` adds 10% of the range to each
     *  side, so the single lowest/highest bar isn't flush with the plot's own edge (which would
     *  otherwise draw it at zero height). Default 0.1. **Throws** if negative. */
    padding?: number;
};
export type ChartLegendConfig = {
    /** Default: true for pie/donut, and for bar/line when `series.length > 1`; false otherwise. */
    show?: boolean;
    position?: 'right' | 'bottom';
    /** Font size (px) of legend entry labels. Default 11. */
    fontSize?: number;
    /** Text color of legend entry labels. Default a secondary ink. */
    color?: string;
};
export type ChartTitleConfig = {
    text: ChartText;
    fontSize?: number;
    color?: string;
};
type ChartCommon = Interactive & SelfAlignable & {
    type: 'chart';
    width?: number;
    height?: number;
    /** width / height. Used to derive whichever of width/height is missing, same as ImageNode. */
    aspectRatio?: number;
    title?: ChartText | ChartTitleConfig;
    axis?: ChartAxisConfig;
    legend?: ChartLegendConfig;
    /** Categorical palette override, cycled by index — falls back to a built-in default palette. */
    colors?: string[];
    /** Font family for every text role in the chart (title/axis/legend). Default a system-ui stack.
     *  On the PDF renderer, this is looked up in the SAME font registry `text()` nodes use
     *  (`registerFont()`) — an unregistered family falls back to Helvetica, same warn-once behavior
     *  as a TextNode with a missing font. */
    fontFamily?: string;
    /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
     *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
     *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
    flex?: FlexSize;
};
export type CategoricalChartNode = ChartCommon & {
    chartKind: 'categorical';
    /** x-axis labels, one per data point in every series. */
    categories: ChartText[];
    /** One or more series, each independently `'bar'`/`'line'`/`'points'` via `ChartSeries.kind` —
     *  freely mix e.g. grouped/stacked bars with one or more line/points series sharing the same
     *  category x-axis and y-domain. */
    series: ChartSeries[];
    /** `'vertical'` (default) plots categories left-to-right on the x-axis and values bottom-to-top
     *  on the y-axis — the conventional column/line chart. `'horizontal'` swaps the two axes:
     *  categories run top-to-bottom and values run left-to-right, so bars grow rightward (or
     *  leftward, for a value below the domain's baseline) instead of upward. */
    orientation?: 'vertical' | 'horizontal';
    /** Groups config for how the underlying data maps to the visible plot — currently just the
     *  y-domain; see `ChartViewConfig`. Separate from `axis`, which only ever controls chrome
     *  (ticks/gridlines/labels) drawn on top of whatever domain `view` resolves. */
    view?: ChartViewConfig;
    /** Only meaningful AMONG `'bar'`-kind series (ignored, not thrown, if none exist). `'grouped'`
     *  places each category's bar series side by side; `'stacked'` stacks them into one bar per
     *  category, positive values above the zero baseline and negative values below it, each in
     *  series order. A chart's `'line'`/`'points'` series are entirely unaffected either way — they
     *  always draw as their own pass, never grouped/stacked with the bars. Default `'grouped'`. */
    barMode?: 'grouped' | 'stacked';
    /** `barMode: 'stacked'` only. Gap (px) left between consecutive stacked segments — the true
     *  baseline edge and the outermost tip edge are never inset by this. Default 0 (flush segments). */
    barSegmentGap?: number;
    /** Corner radius (px) of the rounded "data end" of a bar — see the dataviz mark spec. Default 4. */
    barCornerRadius?: number;
    /** Chart-level default for every `'line'`/`'points'`-kind series without its own
     *  `ChartSeries.curve`. `'linear'` (default) connects points with straight segments. `'monotone'`
     *  draws a cubic-Bezier curve through every point using monotone cubic (Fritsch–Carlson)
     *  interpolation — tangents are clamped so the curve never overshoots past a point's own value
     *  between it and its neighbors, unlike a naive Catmull-Rom spline. */
    lineCurve?: 'linear' | 'monotone';
    /** Chart-level default for every `'line'`-kind series without its own `ChartSeries.strokeWidth`.
     *  Stroke width (px) of the line itself. Default 2. */
    lineStrokeWidth?: number;
    /** Chart-level default for every `'line'`/`'points'`-kind series without its own
     *  `ChartSeries.markerRadius`. Radius (px) of each data-point marker. The white "surface ring"
     *  behind it stays 2px larger than this, same relationship as the library's default (4px marker /
     *  6px ring). Default 4. */
    markerRadius?: number;
};
export type ChartRingSlice = ChartSlice & {
    /** Index into the PREVIOUS ring's `slices` array (`rings[ringIndex - 1].slices`) — declares this
     *  slice a sunburst child of that slice, constraining its angular span to a sub-arc of the
     *  parent's own resolved arc, sized proportionally to this slice's value among its SIBLINGS
     *  (other slices in THIS ring sharing the same `parentIndex`). Meaningless on ring 0 (nothing
     *  "immediately inside" it) — chart() throws if set there. Within any other ring, every slice
     *  must either set this or none may — chart() throws on a ring that mixes parented and
     *  unparented slices, so "some slices nested, some not" only ever means different RINGS, never
     *  different slices within the same ring. */
    parentIndex?: number;
};
export type ChartRing = {
    slices: ChartRingSlice[];
    /** Per-ring override of `RadialChartNode.sliceGap`. Falls back to it when unset. */
    sliceGap?: number;
    /** Per-ring palette override — same cycling rule as the chart-level `colors`, scoped to this
     *  ring's own slice indices, so an inner and outer ring can use different palettes. */
    colors?: string[];
};
export type RadialChartNode = ChartCommon & {
    chartKind: 'radial';
    /** Concentric rings, ordered innermost (index 0) to outermost. A plain single-ring pie/donut is
     *  just `rings: [{ slices: [...] }]` — there is no separate flat-`slices` shorthand; every radial
     *  chart, single-ring or multi-ring, is authored the same way. */
    rings: ChartRing[];
    /** Angular gap between slices, in degrees. Default 1.5; 0 removes the gap entirely. Per-ring
     *  `ChartRing.sliceGap` overrides this for that one ring. */
    sliceGap?: number;
    /** Fraction of the outer radius left as a hole at the very center, shared by every ring (each
     *  ring gets an equal-width radial band across whatever radius remains outside that hole).
     *  Replaces the old `donutInnerRadiusRatio` — same meaning, renamed since "donut" is no longer a
     *  distinct chart kind. Default 0 (a solid pie, no hole). Must be in `[0, 1)`. */
    innerRadiusRatio?: number;
};
export type ChartNumericAxisConfig = {
    /** Master toggle for this axis' ticks/labels. Default true. */
    show?: boolean;
    /** Independent of `show` — lets gridlines be turned off while ticks/labels stay. Default true. */
    gridlines?: boolean;
    tickCount?: number;
    formatTick?: (value: number) => ChartText;
    tickFontSize?: number;
    /** Axis baseline color. Default a neutral gray. */
    color?: string;
    /** Gridline color. Default a lighter neutral gray. */
    gridlineColor?: string;
    /** Tick label text color. Default a muted ink. */
    tickColor?: string;
};
export type ChartScatterPoint = {
    x: number;
    y: number;
    /** Bubble-sizing driver — an arbitrary data value (NOT a px radius), mapped through
     *  `ScatterChartNode.sizeScale`. Omitted, or `sizeScale` entirely unset on the chart, means this
     *  point renders at the chart's fixed `pointRadius` instead. **Throws** if negative. */
    size?: number;
    color?: string;
};
export type ChartScatterSeries = {
    name?: ChartText;
    points: ChartScatterPoint[];
    color?: string;
};
export type ChartSizeScaleConfig = {
    /** `'sqrt'` (default): the point's AREA, not its radius, is linearly proportional to `size` — the
     *  standard bubble-chart convention (a value 4x another reads as 4x the area, not 4x the radius /
     *  16x the area, which would visually exaggerate the ratio). `'linear'`: radius directly
     *  proportional to `size`. */
    type?: 'sqrt' | 'linear';
    /** Output radius range (px) that `[min(size), max(size)]` across every point WITH a `size` maps
     *  onto. Default `[4, 24]`. **Throws** if `range[0] >= range[1]` or either bound is negative. */
    range?: [number, number];
};
export type ScatterChartNode = ChartCommon & {
    chartKind: 'scatter';
    series: ChartScatterSeries[];
    xAxis?: ChartNumericAxisConfig;
    yAxis?: ChartNumericAxisConfig;
    /** Independent x/y domains — same `ChartViewConfig` shape as `CategoricalChartNode.view`, but
     *  unlike that y-domain (which defaults to `'zero'`, always including 0), an omitted `xView`/
     *  `yView` here defaults to `'auto'` instead: scatter data routinely sits far from either axis'
     *  zero (e.g. an x/y correlation plot over a 1000-2000 range), where forcing 0 into view would
     *  squash the actual data into a sliver. Set `{ domain: 'zero' }` explicitly to opt back into the
     *  zero-forcing behavior. */
    xView?: ChartViewConfig;
    yView?: ChartViewConfig;
    /** Fixed radius (px) for every point without its own `size`, or when `sizeScale` is entirely
     *  unset. Default 4. */
    pointRadius?: number;
    /** Presence (even `{}`) opts every point WITH a `size` into bubble sizing; omitted means every
     *  point renders at `pointRadius` regardless of whether it sets `size` — an explicit opt-in so
     *  bubble-vs-plain-scatter never silently flips based on incidental data. */
    sizeScale?: ChartSizeScaleConfig;
};
export type ChartGanttTask = {
    label: ChartText;
    /** Plain numeric time offset — never a `Date`; this library does no date math anywhere (no
     *  aggregation, no calendar-aware tick generation). Pre-convert real dates to numeric offsets
     *  (e.g. days since a project start) and use `xAxis.formatTick` to render them back as dates. */
    start: number;
    /** **Throws** if less than `start`. Equal to `start` is allowed (a zero-width "milestone"). */
    end: number;
    /** This task's own bar fill color — independent of its label TEXT color (`labelColor` below);
     *  the two are deliberately not linked, so a task's row label can stay a neutral, readable ink
     *  while its bar carries whatever color scheme the caller wants. */
    color?: string;
    /** Flat, single-level row grouping — NOT `TableNode.groups`' nested/aggregating machinery,
     *  deliberately much simpler: tasks sharing a `group` value in a CONTIGUOUS run (adjacent to each
     *  other in `tasks` array order) are preceded by one header band showing that group name. Tasks
     *  are never reordered to cluster a non-contiguous same-named group together — unlike table
     *  grouping's global regroup-by-value, this only recognizes runs as authored. */
    group?: string;
    /** Overrides `GanttChartNode.taskLabelColor` for THIS task's own row label alone. */
    labelColor?: string;
};
export type ChartGanttGroupStyle = {
    color?: string;
    background?: string;
    /** Overrides the header BAND's own rendered text — independent of the `group` string used as
     *  this record's key (which stays a plain identifier for lookup/contiguous-run comparison and is
     *  never itself rich text). Falls back to rendering the group key string unchanged. */
    label?: ChartText;
};
export type GanttChartNode = ChartCommon & {
    chartKind: 'gantt';
    tasks: ChartGanttTask[];
    xAxis?: ChartNumericAxisConfig;
    /** Same `ChartViewConfig` shape as everywhere else, but defaults to `'auto'` (tight to data)
     *  rather than `'zero'` when entirely omitted — same reasoning as `ScatterChartNode.xView`: a
     *  project's task offsets routinely start well after day 0, where forcing 0 into view would
     *  squash the real schedule into a sliver. */
    xView?: ChartViewConfig;
    /** px height of each row (task or group header). Default: divides the available plot height
     *  evenly across every row, same as every other chart's band-based layout (e.g. a categorical
     *  chart's category bands). An explicit value is used exactly as given instead — size `height`/
     *  `aspectRatio` generously enough to fit `rows.length * rowHeight`, or rows simply overflow the
     *  chart's own box (same visual-overflow consequence any other fixed-size chart layout already
     *  has, e.g. too many bar-chart categories squeezed into too little width). **Throws** if <= 0. */
    rowHeight?: number;
    /** Default: `true` iff any task sets `group`, `false` otherwise. */
    showGroupHeaders?: boolean;
    /** Chart-level default text color for every group header band. Falls back to a neutral ink when
     *  entirely unset. A per-group entry in `groups` overrides this for that one group's own band. */
    groupHeaderColor?: string;
    /** Chart-level default background color for every group header band. Falls back to a neutral
     *  light gray when entirely unset. A per-group entry in `groups` overrides this for that one
     *  group's own band. */
    groupHeaderBackground?: string;
    /** Per-group style override, keyed by the exact `group` string used on `ChartGanttTask`. A group
     *  name with no entry here (or no `groups` object at all) falls back to
     *  `groupHeaderColor`/`groupHeaderBackground` — which themselves fall back to the built-in
     *  defaults. A key that never matches any task's `group` is simply unused, same as an unused
     *  entry in a `colors` palette elsewhere in this library. */
    groups?: Record<string, ChartGanttGroupStyle>;
    /** Chart-level default text color for every task's own row label (the task name drawn left of
     *  its bar) — independent of `groupHeaderColor` (that's the header BAND text) and independent of
     *  each task's own bar `color`. Falls back to a neutral ink when entirely unset. Per-task
     *  `ChartGanttTask.labelColor` overrides this for that one task's label alone. */
    taskLabelColor?: string;
};
export type ChartRadarSeries = {
    name?: ChartText;
    /** One value per category/spoke — same length requirement as `CategoricalChartNode.series[].data`
     *  (one entry per category, in the same order). No special negative-value handling: reuses the
     *  same zero/auto/explicit domain resolution as a categorical chart's y-domain, so a negative
     *  value simply extends the domain like a line chart dipping below its baseline — the domain's
     *  own MINIMUM becomes radius-0 (the center), not a hard-coded literal zero. */
    data: number[];
    color?: string;
    /** Flat solid-color-at-opacity fill of the polygon interior — unlike `ChartSeries.fill` (a
     *  line's gradient-to-baseline fade), a closed radial polygon has no single edge that reads as
     *  "the baseline" to fade toward, so this is deliberately simpler: `true` = this series' own
     *  resolved color at the default opacity (0.25); an object overrides `color`/`opacity`. */
    fill?: boolean | ChartSeriesFillConfig;
};
export type RadarChartNode = ChartCommon & {
    chartKind: 'radar';
    /** Spokes, arranged evenly around the circle — 0°=top, sweeping clockwise, same convention the
     *  radial chart's own slice angles use. */
    categories: ChartText[];
    series: ChartRadarSeries[];
    /** Shared radial domain — every series' polygon is scaled against the SAME domain, same as a
     *  categorical chart's shared y-domain across its series. */
    view?: ChartViewConfig;
    /** Reuses `ChartAxisConfig` (not `ChartNumericAxisConfig`) since radar genuinely has both a
     *  category axis (the spokes/categoryFontSize) AND a value axis (the concentric rings/
     *  tickFontSize) at once, matching what `ChartAxisConfig` already models for a categorical chart. */
    axis?: ChartAxisConfig;
    /** Radius (px) of each vertex marker. `0` draws no markers at all. Default 3. */
    markerRadius?: number;
    /** Stroke width (px) of each series' polygon outline. Default 2. */
    lineStrokeWidth?: number;
};
export type ChartCandle = {
    open: number;
    high: number;
    low: number;
    close: number;
};
export type ChartCandlestickSeries = {
    name?: ChartText;
    /** One candle per category, same length requirement as `CategoricalChartNode.series[].data`. */
    data: ChartCandle[];
    /** Per-series override of `CandlestickChartNode.upColor`/`downColor`. */
    upColor?: string;
    downColor?: string;
};
export type CandlestickChartNode = ChartCommon & {
    chartKind: 'candlestick';
    categories: ChartText[];
    series: ChartCandlestickSeries[];
    /** Same `ChartViewConfig` shape as everywhere else, but defaults to `'auto'` rather than `'zero'`
     *  when entirely omitted — same reasoning as `ScatterChartNode.xView`/`GanttChartNode.xView`: real
     *  price data routinely sits far from 0 (e.g. a stock trading in the 140-180 range), where forcing
     *  0 into view would squash the actual candles into a sliver at the very top of the plot. */
    view?: ChartViewConfig;
    axis?: ChartAxisConfig;
    /** px width of each candle's body. Default: mirrors a single-series bar's own band-fit sizing
     *  (capped at `BAR_MAX_THICKNESS`), divided among series like grouped bars when there's more
     *  than one. */
    candleWidth?: number;
    /** px width of the high-low wick line. Default 1. */
    wickWidth?: number;
    /** Chart-level default fill color for a candle whose `close >= open`. Default a green. Per-series
     *  `ChartCandlestickSeries.upColor` overrides this for that series alone. */
    upColor?: string;
    /** Chart-level default fill color for a candle whose `close < open`. Default a red. */
    downColor?: string;
};
export type ChartTreemapItem = {
    label: ChartText;
    value: number;
    color?: string;
};
export type TreemapChartNode = ChartCommon & {
    chartKind: 'treemap';
    /** Flat, single-level — no nested/hierarchical drill-down (a hierarchical treemap was considered
     *  and deliberately scoped out, matching the complexity level of every other new chart kind
     *  here). Laid out via the standard squarified algorithm (Bruls/Huizing/van Wijk): rectangle area
     *  is proportional to `value`, packed to keep aspect ratios close to 1:1 rather than the thin
     *  slivers a naive slice-and-dice layout produces. **Throws** if any `value` is negative or
     *  non-finite (a zero value is allowed — it degenerates to a zero-area rectangle the layout
     *  simply skips, same "contributes no visible mark" pattern a zero data value already has
     *  elsewhere, e.g. `stackedBarSegments`). */
    items: ChartTreemapItem[];
    /** px gap between adjacent rectangles — same "surface gap separates touching marks" convention
     *  as `MARK_SURFACE_GAP` elsewhere, applied uniformly to every rectangle's own edges (a treemap
     *  has no shared "baseline" edge the way a stacked bar does, so there's no flush-outer-edge
     *  exception to make). Default 2. **Throws** if negative. */
    itemGap?: number;
    /** px font size for each rectangle's own inline label WHEN a run doesn't set its own `fontSize`.
     *  A rectangle too small to fit its label at this size simply omits it — never overflows past the
     *  rectangle's own edge, never wraps. Default 12. */
    labelFontSize?: number;
    /** Formats the text drawn inside each rectangle — same "caller-supplied formatting hook" pattern
     *  as `ChartAxisConfig.formatTick`/`ChartNumericAxisConfig.formatTick` elsewhere in this file.
     *  Receives the item itself (not just its `label`), so the formatted content can fold in `value`
     *  too, and — via `ChartTextRun[]` — style the name and the value differently (e.g. a bigger bold
     *  name run, a smaller lower-opacity value run below it via `\n`). The too-small-to-fit check is
     *  measured against the formatted content's own widest line and total block height, not the raw
     *  `label` — an empty result (or only blank lines) omits the label entirely, so returning `''`
     *  to hide small items keeps working unchanged. Default: `item.label` unchanged. */
    formatLabel?: (item: ChartTreemapItem) => ChartText;
};
export type ChartNode = CategoricalChartNode | RadialChartNode | ScatterChartNode | GanttChartNode | RadarChartNode | CandlestickChartNode | TreemapChartNode;
export type TableGroupLevel = {
    /** rows = the ORIGINAL authored rows in this bucket. Defaults to a plain bold text label showing
     *  the value. Return a `Node` for a single full-width bar (the default shape), or `TableCell[]`
     *  for a colSpan-aware, column-grid-aligned header — same implicit-flow tiling as `totals()`
     *  (one cell per column, `colSpan` allowed, `rowSpan` rejected since a header is always exactly
     *  one physical row). Unlike the `Node` form, a `TableCell[]` header is NOT indented by nesting
     *  depth — its cells align with the real column grid, same as a `totals()` row. */
    header?: (value: string, rows: TableRow[]) => Node | TableCell[];
    background?: string;
    /** Opt-in totals row appended at the end of this group. `rows` = ALL rows in this group,
     *  flattened across any nested subgroups beneath it — aggregate over all of them, not just the
     *  ones directly at this level. Must return exactly one cell per column (same shape as an
     *  ordinary row — there's no "non-grouped columns" subset anymore). */
    totals?: (rows: TableRow[]) => TableCell[];
    /** Whether THIS level's header bar re-appears at the top of a continuation page when the
     *  group's rows split across a page boundary. Overrides `TableNode.repeatGroupHeaders` for this
     *  level only; falls back to it when unset (which itself defaults to `true`). */
    repeat?: boolean;
};
export type TableColumn = {
    width?: FlexSize;
    background?: string;
    align?: CrossAlign;
    /** Per-column default cell padding (px, all 4 sides) — overrides `TableNode.cellPadding` for
     *  every cell in this column, unless that cell sets its own `TableCell.padding`. */
    padding?: number;
    /** Per-column default vertical alignment — overrides the table default (`'start'`) for every
     *  cell in this column, unless that cell or its row sets its own `verticalAlign`. Also applies
     *  to the auto-generated header row (from `content`, below), which has no other way to set this. */
    verticalAlign?: 'start' | 'center' | 'end';
    /**
     * Optional header caption for this column. If ANY column defines this, table() auto-builds a
     * single header row from every column's `content` (all of them must then define it — partial
     * adoption is rejected) and sets `headerRows` to 1 automatically. Mutually exclusive with
     * manually setting `headerRows` yourself (table() throws if both are used) — the manual-row
     * mechanism remains available unchanged for anyone who wants more control (e.g. a multi-row
     * header).
     */
    content?: Node;
};
export type TableCell = {
    content?: Node;
    /** Number of columns this cell spans, starting at its resolved column. Default 1. */
    colSpan?: number;
    /** Number of rows this cell spans, starting at its own row. Default 1. A rowSpan > 1 makes the
     *  rows it covers an atomic pagination cluster — see GUIDE.md's "Cell spans" section. */
    rowSpan?: number;
    background?: string;
    align?: CrossAlign;
    verticalAlign?: 'start' | 'center' | 'end';
    /** Overrides `column.padding`/`TableNode.cellPadding` for THIS cell only (px, all 4 sides). */
    padding?: number;
    /** A complete rectangle drawn around this cell's own box — independent of, and always drawn on
     *  top of, the table-wide `TableNode.border` modes. Unlike those (which never double-draw
     *  thickness at a shared edge between two cells), a per-cell border always draws its own full
     *  perimeter, so two adjacent bordered cells show a double-thickness line between them — a
     *  simpler, deliberately different look, not a bug. No `borderRadius` (a rounded corner on one
     *  cell in a shared grid has no well-defined visual meaning next to its square neighbors). */
    border?: ContainerBorder;
    /**
     * Plain comparable value, purely a convenience: `totals()` callbacks receive the original
     * authored rows, so stashing a plain number/string here (alongside `content`) gives them
     * something to read/sum without parsing it back out of a rendered Node. Never required by
     * table() itself — unrelated to column grouping, which reads its bucketing value from
     * `TableRow.groupValues` instead (kept separate from `content` since `content` is an arbitrary
     * Node, not inspectable for aggregation).
     */
    value?: string;
    /** @internal resolved starting column index — set by table() (via resolveCellSpans()) whenever
     *  any cell in the table uses colSpan/rowSpan; table-layout.ts reads this directly instead of
     *  assuming array position === column index, which implicit-flow authoring intentionally
     *  violates. Unset (and unused, falling back to array position) for a table with no spans. */
    __resolvedCol?: number;
};
export type TableRow = {
    kind?: 'cells';
    cells: TableCell[];
    /** One entry per level in `TableNode.groups`, same order — the value this row buckets under
     *  at each grouping level. Required (with the right length) when `TableNode.groups` is set;
     *  entirely independent of `cells`/`columns` — see "Column grouping" in GUIDE.md. */
    groupValues?: string[];
    background?: string;
    verticalAlign?: 'start' | 'center' | 'end';
    /** @internal true if this row cannot be separated from the NEXT row by a page cut — set by
     *  table() (via resolveCellSpans()) when a rowSpan cell starting at or before this row still
     *  has rows left to cover after it. Unset for an ordinary table — every row is its own
     *  single-row "cluster," exactly like before this feature existed. */
    __atomicWithNext?: boolean;
} | {
    /** Full-width bar, no per-column cells by default — sidesteps needing colSpan for this
     *  specific case. Directly authorable by hand too, not just via automatic column grouping —
     *  useful as a manual section-divider banner in any table (but mutually exclusive with
     *  colSpan/rowSpan elsewhere in the same table — see GUIDE.md). Hand-authored banner rows
     *  must use `content`; `cells` is only ever produced by `TableGroupLevel.header()` returning
     *  `TableCell[]` (table() throws if a manually-authored header row sets `cells`). */
    kind: 'header';
    /** Nesting depth (0 = outermost group) — drives the default indent for the `content` form
     *  (irrelevant for `cells`, which aligns to the real column grid instead — see below).
     *  Irrelevant for a hand-authored banner row; leave at 0. */
    depth: number;
    /** Exactly one of `content`/`cells` is set. `content` — a single Node spanning the table's
     *  full width, indented by nesting depth. */
    content?: Node;
    /** `cells` — colSpan-aware, column-grid-aligned cells instead of one full-width Node; see
     *  `TableGroupLevel.header()`. Resolved through the same `resolveCellSpans()` implicit-flow
     *  tiling a `totals()` row gets. */
    cells?: TableCell[];
    background?: string;
    /** Already-resolved: whether this specific header instance re-appears at the top of a
     *  continuation page if the surrounding rows split across a page boundary. table-layout.ts
     *  reads this directly (`row.repeat ?? true`) — it has no awareness of `TableGroupLevel` or
     *  which level produced this row, by design (see the "Column grouping" desugaring note). For
     *  an automatically-grouped level this is baked in by `applyGroupingRows()` from
     *  `TableGroupLevel.repeat`/`TableNode.repeatGroupHeaders`; for a manually-authored banner
     *  row, set it directly (defaults to `true`, same as everywhere else). */
    repeat?: boolean;
};
export type TableBorderMode = 'none' | 'all' | 'outer' | 'horizontal' | 'vertical';
export type TableNode = Interactive & {
    type: 'table';
    columns: TableColumn[];
    rows: TableRow[];
    /** Report-style row grouping levels, ordered outermost -> innermost — entirely independent of
     *  `columns`; see "Column grouping" in GUIDE.md. Each row supplies its bucketing value(s) via
     *  `TableRow.groupValues`, one entry per level, in this same order. */
    groups?: TableGroupLevel[];
    /** Leading row count repeated at the top of every continuation page this table spans. Can be
     *  freely combined with column grouping (`groups`) — see GUIDE.md's "Column grouping" section —
     *  but mutually exclusive with per-column `content` captions (table() throws if both are set). */
    headerRows?: number;
    /** Background for the single auto-generated header row (from per-column `content` captions —
     *  see `TableColumn.content`). Ignored if no column defines `content`, or if you author your own
     *  header row(s) manually via `headerRows` instead (give that row its own `background` there). */
    headerBackground?: string;
    /** Whether the table's own header (the `headerRows` prefix, whether hand-authored or
     *  auto-generated via `column.content`) repeats at the top of every continuation page, or
     *  appears only once at the very top of the table. Default `true` — the existing, always-repeat
     *  behavior. */
    repeatHeaderRow?: boolean;
    /** Table-wide default for `TableGroupLevel.repeat` on every grouping level that doesn't set its
     *  own — default `true` (every group level's header bar repeats on a continuation page unless
     *  that level, or this, opts out). */
    repeatGroupHeaders?: boolean;
    /** Omitted entirely = no borders (same as `{mode: 'none'}`). `mode` defaults to 'all' when the
     *  object is present but `mode` isn't specified. */
    border?: {
        mode?: TableBorderMode;
        thickness?: number;
        color?: string;
    };
    cellPadding?: number;
    /** Alternating row background, desugared entirely at table() build time into per-row
     *  `background` (table-layout.ts never knows striping happened, same architecture as `groups`).
     *  Applies only to ordinary data rows — never the table's own literal header-row prefix, nor a
     *  column-grouping header/divider bar — and never overrides a row that already sets its own
     *  `background`. `even`/`odd` count sequentially through those data rows starting at 0 (even). */
    stripe?: {
        even?: string;
        odd?: string;
    };
    /** Only meaningful when this node is itself a ROW child; ignored for column children. */
    flex?: FlexSize;
};
export type Node = GroupNode | TextNode | RichTextNode | SeparatorNode | PageBreakNode | ImageNode | TableNode | ChartNode | ContainerNode | SvgNode;
export declare function definePage(config: Omit<PageDef, 'body'>, body: Node): PageDef;
export declare function group(config: DistributiveOmit<GroupNode, 'type' | 'children'>, children: Node[]): GroupNode;
export declare function text(config: Omit<TextNode, 'type' | 'lineHeight'> & {
    lineHeight?: number;
}): TextNode;
export declare function richText(config: Omit<RichTextNode, 'type' | 'lineHeight'> & {
    lineHeight?: number;
}): RichTextNode;
export declare function separator(config?: Omit<SeparatorNode, 'type'>): SeparatorNode;
/**
 * Forces a page break at this point in the document flow. Redundant/leading breaks (nothing has
 * been placed on the current page yet) are silently no-ops rather than producing a blank page —
 * only meaningful inside COLUMN-direction structure; has no effect as a row's column.
 */
export declare function pageBreak(): PageBreakNode;
export declare function image(config: Omit<ImageNode, 'type'>): ImageNode;
export declare function svg(config: Omit<SvgNode, 'type'>): SvgNode;
export declare function container(config: Omit<ContainerNode, 'type' | 'child'>, child: Node): ContainerNode;
export declare function chart(config: DistributiveOmit<ChartNode, 'type'>): ChartNode;
/**
 * Convenience for a rowSpan cluster's physical rows that all belong to the same group bucket: they
 * must share identical `groupValues` (see "Column grouping" in GUIDE.md's cluster-constancy rule),
 * so instead of repeating the same array by hand on every row, spread it once here. Purely an
 * authoring shortcut — it doesn't change what `table()` validates; the cluster-constancy check
 * still runs on the result exactly as if you'd set `groupValues` on each row yourself.
 */
export declare function rowGroup(groupValues: string[], rows: Extract<TableRow, {
    kind?: 'cells';
}>[]): TableRow[];
export declare function table(config: Omit<TableNode, 'type'>): TableNode;
export {};
