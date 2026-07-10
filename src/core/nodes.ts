// Public document-tree node types and builder functions.

export type Margins = { top: number; right: number; bottom: number; left: number }

export type PageSize = 'A4' | 'Letter' | { width: number; height: number }

export type HeaderFooterContext = { pageNumber: number; totalPages: number }
export type HeaderFooterContent = Node | ((ctx: HeaderFooterContext) => Node)

// A watermark is deliberately NOT a Node: it never participates in pagination/flow (doesn't
// consume content-box height, isn't registered in behavior.ts's measure/layout/split dispatch). It's
// a page-absolute decorative overlay, resolved once per page in paginate() exactly like header/footer
// content is, then painted directly by each renderer LAST — on top of header/body/footer/background/
// border — so an opaque table stripe, container background, or chart's white surface elsewhere on
// the page can never fully hide it. `pointerEvents`/hit-testing never apply to it for the same reason
// it isn't a Node: it can't be an attachInteractions() target since it isn't part of the authored tree.
export type WatermarkBase = {
  /** 0-1. Default 0.15. */
  opacity?: number
  /** Degrees, clockwise. Default -45 (classic diagonal stamp). */
  rotation?: number
  /** Repeat in a grid across the whole page instead of a single centered instance. Default false. */
  tile?: boolean
  /** px gap between tiled repeats. Only meaningful when `tile` is true. */
  tileGapX?: number
  tileGapY?: number
}

export type TextWatermark = WatermarkBase & {
  kind: 'text'
  text: string
  /** Falls back to a built-in bold Helvetica when omitted — no registerFont() warning, since no
   *  family was ever requested. */
  fontFamily?: string
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  /** px. Default 72. */
  fontSize?: number
  /** Default '#000000'. */
  color?: string
  /** Default false: generatePdf() rasterizes the text to a transparent PNG and draws it as an image,
   *  so it can't be selected/copied out of the PDF (pdfkit's `.text()` otherwise embeds real,
   *  selectable/searchable glyphs like any other text in the document — rarely desired for a
   *  decorative stamp like "CONFIDENTIAL" sitting over real body content). Set `true` to keep it as
   *  live vector text instead. Only affects generatePdf() — the on-screen preview's watermark is
   *  always `pointer-events: none` regardless of this flag, since it's decorative-only and never a
   *  hit-test/interaction target. */
  selectable?: boolean
}

export type ImageWatermark = WatermarkBase & {
  kind: 'image'
  src: string
  width: number
  height: number
}

export type Watermark = TextWatermark | ImageWatermark
// The callback form may return undefined/null to skip the watermark entirely on a given page (e.g.
// only page 1 gets one) — the non-callback form has no such escape hatch since omitting `watermark`
// outright already means "none," so there'd be nothing for a static null/undefined to add.
export type WatermarkContent = Watermark | ((ctx: HeaderFooterContext) => Watermark | undefined | null)

// Same per-page-aware shape as HeaderFooterContent/WatermarkContent: a plain value, resolved once
// per page in paginate() with a `{pageNumber, totalPages}` callback when a page-varying decoration
// is needed (e.g. a colored background only on the cover page, or a heavier border on the last page).
// Like WatermarkContent, the callback may return undefined/null to opt a specific page out entirely.
export type PageBackgroundContent = string | ((ctx: HeaderFooterContext) => string | undefined | null)
export type PageBorderContent = ContainerBorder | ((ctx: HeaderFooterContext) => ContainerBorder | undefined | null)

export type PageDef = {
  size: PageSize
  margins: Margins
  header?: HeaderFooterContent
  footer?: HeaderFooterContent
  /** Explicit override in px. If omitted, computed once from the header/footer content
   *  rendered with a placeholder {pageNumber:1,totalPages:1} context. */
  headerHeight?: number
  footerHeight?: number
  headerGap?: number
  footerGap?: number
  /** Solid page background color. Default white. */
  background?: PageBackgroundContent
  /** Border drawn around the page's own edge. No `borderRadius` (a page is never clipped/cropped). */
  border?: PageBorderContent
  /** Decorative overlay drawn on top of every page's content (e.g. a "DRAFT" stamp or logo). */
  watermark?: WatermarkContent
  body: Node
}

// Omit<T,K> collapses a union T to the intersection of its members' keys — useless for a
// discriminated union's builder-config type, where each member needs its own keys omitted while
// staying a separate union member. This distributes Omit over each member instead.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type MainAlign = 'start' | 'center' | 'end' | 'space-between' | 'space-around'
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch'
export type TextAlign = 'left' | 'center' | 'right'

// Overrides the parent group's `crossAlign` for this child alone, without affecting siblings —
// mirrors CSS `align-self`. In a COLUMN parent: `'stretch'` claims the column's full width for this
// child (bypassing its own shrink-wrap sizing — e.g. a Group's mainAlign-driven layout, or
// Container/Image/Svg/Chart's own `width`) even though the column itself isn't stretching every
// child. When neither `alignSelf` nor the column's own `crossAlign` is set, the default itself
// depends on the child's type: a nested GROUP defaults to `'stretch'` (a layout container fills the
// width it's given, like a block-level flex box), while every other node type defaults to `'start'`
// (hugs its own natural width, like inline/replaced content) — see `layoutColumn()` in
// `src/nodes/group.ts`. In a ROW parent: `alignSelf` only affects this child's vertical position
// among mismatched-height siblings (start/center/end) — `'stretch'` has no effect there (falls back
// to `'start'`), since a row child's height is always intrinsic. Not given to Separator/PageBreak/
// Table: those already always claim full width unconditionally in childCrossWidthInColumn, so
// there's nothing to override.
export type SelfAlignable = { alignSelf?: CrossAlign }

// Main-axis sizing hint for a ROW group's direct children (row width division only — column
// children keep intrinsic/content-driven height always, since pagination depends on that). A plain
// number is a flex-grow-style weight; a `"Npx"` string is a fixed size that opts out of flexing
// entirely; `'shrink'` is also a fixed size, but computed from the child's own natural/shrink-wrap
// width (same mechanism as column shrink-wrap sizing) instead of an authored pixel value — see "Row
// flex sizing" in GUIDE.md. When `flex` is left unset, the default itself depends on the child's
// type: a nested GROUP defaults to weight `1` (a layout container fills its share of the row, like a
// block-level flex box), while every other node type defaults to `'shrink'` (hugs its own natural
// width instead of being squeezed into an equal share that might force it to wrap) — mirroring CSS's
// actual flex-item default (`flex-grow: 0`, content-sized), not an equal-share weight.
export type FlexSize = number | `${number}px` | 'shrink'

// Off by default — no node responds to hover/click/drag unless explicitly opted in. Not inherited:
// a group being interactive does not make its children interactive, and vice versa. attachInteractions()
// (src/interaction/) resolves a hit by walking from the deepest geometric match back up toward the
// root and returning the first node with `interactive: true`, so marking only an outer group lets a
// click anywhere inside it (including on its non-interactive children) "bubble up" to that group.
export type Interactive = {
  interactive?: boolean
  /**
   * Only takes effect when `interactive: true` is ALSO set — a node needs both to become a drag
   * source; `interactive` alone still gives hover/click but never starts a drag. Off by default.
   * Text rendered under a draggable node (itself or any descendant, regardless of that
   * descendant's own flags) gets `user-select: none` so a drag gesture can't also trigger native
   * text selection.
   */
  draggable?: boolean
  /**
   * Marks this node as a valid drop landing zone, independent of `interactive`/`draggable` — a
   * node can be droppable without being interactive itself (e.g. a plain container that exists
   * only to receive drops). Checked via `dropTarget` in `drop` events, resolved the same
   * bubble-up way `interactive` is for hover/click: dropping on a non-droppable descendant still
   * resolves to the nearest droppable ancestor-or-self. Off by default.
   */
  droppable?: boolean
  /**
   * Only meaningful when `draggable: true`. The type(s) this dragged item carries — checked
   * against a droppable node's `accepts` list to decide which drop zones are valid for it. A
   * single string is shorthand for a one-element list. Left unset, the drag is untyped and treated
   * as a wildcard: it matches every droppable node regardless of that node's `accepts` list
   * (including one that declares an `accepts` list — an untyped drag never gets filtered out).
   */
  dragType?: string | string[]
  /**
   * Only meaningful when `droppable: true`. Restricts which drag types this zone accepts — a drag
   * is valid here if ANY of its `dragType`(s) appear in this list (not "every type must match").
   * Left unset, this zone accepts anything, including untyped drags — purely additive to
   * `droppable` alone, so existing droppable nodes are unaffected until you opt in.
   */
  accepts?: string[]
  /**
   * Arbitrary caller-defined data — never read or interpreted by paginator itself. Round-trips
   * unchanged through layout/split/pagination (available on `InteractionTarget.node`), so an
   * interaction handler (hover/click/drag/drop) can recover app-specific context (e.g. a record
   * id) for whichever node it's handed, without maintaining a side-table keyed by node identity.
   */
  metadata?: Record<string, unknown>
  /**
   * Stable caller-defined identifier for this node — never validated or interpreted by paginator
   * itself (no uniqueness enforced; that's the caller's responsibility, same as `metadata`).
   * Round-trips through layout/split/pagination the same way `metadata` does. Look it up after
   * pagination via `Paginator.findById(registry, id)`. Because splitting clones a node's
   * continuation onto each new page, and because callers may reuse an id on purpose, `findById`
   * always returns an array — one entry per matching page/fragment, in page order.
   */
  id?: string
}

type GroupCommon = Interactive & SelfAlignable & {
  type: 'group'
  mainAlign?: MainAlign
  crossAlign?: CrossAlign
  gap?: number
  /** Only meaningful when this node is itself a ROW child; ignored for column children. */
  flex?: FlexSize
  children: Node[]
}

export type RowGroupNode = GroupCommon & {
  direction: 'row'
  /**
   * Opts this row into independent per-column page splitting (newspaper/magazine-style): a
   * column that doesn't fit continues on the next page while its shorter siblings simply stop,
   * rather than the whole row moving as one atomic unit. Off by default so an aligned row (e.g. a
   * label/value line) keeps its atomic guarantee — only turn this on for rows whose columns are
   * independent, unrelated flows of content.
   */
  splitColumns?: boolean
}

export type ColumnGroupNode = GroupCommon & { direction: 'column' }

export type GroupNode = RowGroupNode | ColumnGroupNode

export type LayoutCursorLike = { segmentIndex: number; graphemeIndex: number }

export type TextNode = Interactive & SelfAlignable & {
  type: 'text'
  content: string
  fontFamily: string
  fontSize: number
  fontWeight?: number | string
  fontStyle?: 'normal' | 'italic'
  color?: string
  align?: TextAlign
  textDecoration?: 'none' | 'underline' | 'line-through'
  /** px. Required — pretext takes line-height at layout time, not baked into prepare(). */
  lineHeight: number
  letterSpacing?: number
  whiteSpace?: 'normal' | 'pre-wrap'
  wordBreak?: 'normal' | 'keep-all'
  /** Only meaningful when this node is itself a ROW child; ignored for column children. */
  flex?: FlexSize
  /** @internal memoized PreparedTextWithSegments, set lazily by the measure layer */
  __prepared?: unknown
  /** @internal set on synthetic continuation nodes produced by splitting across a page break */
  __resumeCursor?: LayoutCursorLike
}

export type RichTextRun = {
  text: string
  /** Falls back to RichTextNode.fontFamily when omitted. */
  fontFamily?: string
  /** Falls back to RichTextNode.fontSize when omitted. */
  fontSize?: number
  fontWeight?: number | string
  fontStyle?: 'normal' | 'italic'
  color?: string
  textDecoration?: 'none' | 'underline' | 'line-through'
  letterSpacing?: number
  /** Presence marks this run as an inline link: rendered as a real `<a href>` in the DOM
   *  output and a real pdfkit `.link()` clickable annotation in the PDF output — deliberately
   *  NOT part of the generic interactive/hit-registry system (see the Node union comment below). */
  href?: string
}

export type RichInlineCursorLike = { itemIndex: number; segmentIndex: number; graphemeIndex: number }

// Mixed-style inline runs (bold one word mid-sentence, colored spans, inline links) within a
// single paragraph — a separate node type from TextNode (which stays one uniform run), per the
// Node union's own "Phase 2" comment below. No `whiteSpace`/`wordBreak` fields: pretext's
// rich-inline module (@chenglou/pretext/rich-inline) is documented as inline-only and
// `white-space: normal`-only on purpose, so those TextNode options don't apply here.
export type RichTextNode = Interactive & SelfAlignable & {
  type: 'richText'
  runs: RichTextRun[]
  /** Paragraph-level defaults — any run above that omits a field falls back to this. */
  fontFamily: string
  fontSize: number
  fontWeight?: number | string
  fontStyle?: 'normal' | 'italic'
  color?: string
  align?: TextAlign
  textDecoration?: 'none' | 'underline' | 'line-through'
  /** px. Required — pretext takes line-height at layout time, not baked into prepare(). */
  lineHeight: number
  letterSpacing?: number
  /** Only meaningful when this node is itself a ROW child; ignored for column children. */
  flex?: FlexSize
  /** @internal memoized PreparedRichInline, set lazily by the measure layer */
  __prepared?: unknown
  /** @internal set on synthetic continuation nodes produced by splitting across a page break */
  __resumeCursor?: RichInlineCursorLike
}

export type SeparatorNode = Interactive & {
  type: 'separator'
  thickness?: number
  color?: string
  /** px reserved on each side along the parent's main axis */
  margin?: number
  /** Line style. Default 'solid' */
  style?: LineStyle
}

// A flow-control marker, not visible content: forces the pagination cursor to the top of the next
// page wherever it's encountered while walking a COLUMN-direction structure. Has no effect inside
// a row's columns (a row's atomic/independent-column splitting has no notion of "cursor position"
// to force a break at) — it renders as an inert zero-size box there instead of doing nothing
// silently-but-unexpectedly, treated the same as any other unsupported context.
export type PageBreakNode = Interactive & { type: 'page-break' }

export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down'

export type ImageNode = Interactive & SelfAlignable & {
  type: 'image'
  src: string
  alt?: string
  /**
   * At least one of {width & height}, {width & aspectRatio}, {height & aspectRatio}, or
   * {aspectRatio alone} is required — see image(). Dimensions are never auto-detected from the
   * loaded asset (that would make paginate() asynchronous); `objectFit` reconciles any mismatch
   * between the resolved box and the actual image's shape, exactly like the CSS property it maps
   * to on the rendered <img>.
   */
  width?: number
  height?: number
  /** width / height. Used to derive whichever of width/height is missing. */
  aspectRatio?: number
  objectFit?: ObjectFit // default 'fill', matching the CSS initial value
  /** Rounds the image's own painted content (not just a wrapping box) — clips the actual pixels,
   *  unlike wrapping the image in a `container`'s `borderRadius`, which would only decorate around
   *  a still-rectangular image. */
  borderRadius?: number
  /** 0-1. */
  opacity?: number
  /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
   *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
   *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
  flex?: FlexSize
}

export type SvgNode = Interactive & SelfAlignable & {
  type: 'svg'
  /** Raw SVG markup (a full <svg>...</svg> string) — parsed at RENDER time (once per renderer: the
   *  DOM preview inserts it directly, generatePdf() feeds it through svg-to-pdfkit), never at
   *  construction, same "never auto-detected/parsed eagerly" contract ImageNode/ChartNode already
   *  have (see image()). */
  markup: string
  /**
   * At least one of {width & height}, {width & aspectRatio}, {height & aspectRatio}, or
   * {aspectRatio alone} is required — see svg(), same rule as ImageNode.
   */
  width?: number
  height?: number
  /** width / height. Used to derive whichever of width/height is missing. */
  aspectRatio?: number
  /** 0-1. */
  opacity?: number
  /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
   *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
   *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
  flex?: FlexSize
}

/** Shared by every line/border-drawing field in this file (SeparatorNode.style, ContainerBorder,
 *  TableNode.border) — one line-style vocabulary so a document author never has to remember a
 *  different set of keywords per node type. */
export type LineStyle = 'solid' | 'dashed' | 'dotted'

export type ContainerBorder = { thickness?: number; color?: string; style?: LineStyle }

// A single-child decorative wrapper (Flutter's Container) — the paint group deliberately never
// has: background/border/borderRadius/padding. Unlike group, it never lays out multiple children;
// it exists purely to decorate one child, plus width/flex/height sizing whose mechanism is
// identical to ImageNode's (see container-layout.ts's header comment for the full sizing contract).
export type ContainerNode = Interactive & SelfAlignable & {
  type: 'container'
  child: Node
  /** Natural/shrink-wrap width in a non-stretch context — same mechanism as ImageNode.width (see
   *  childCrossWidthInColumn in group-layout.ts). Overridden by an ancestor's crossAlign: 'stretch'
   *  or this node's own `alignSelf: 'stretch'`, same known limitation image/chart already have. Also
   *  doubles as the row-slot size when this node is a ROW child and `flex` is left unset. */
  width?: number
  /** MINIMUM content-box height, NOT exact/clipped — box height is
   *  Math.max(height ?? 0, childNaturalHeight + padding.top + padding.bottom). Not enforced on a
   *  fragment produced by splitting across a page boundary (see container-layout.ts). */
  height?: number
  /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
   *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
   *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
  flex?: FlexSize
  padding?: number | Margins
  background?: string
  border?: ContainerBorder
  borderRadius?: number
}

// Per-run styling for chart text — every chart text role (title, series/slice/task/item labels,
// categories, axis tick-label formatters, legend entries) accepts this. Mirrors `RichTextRun`'s
// shape (mixed-style inline runs within a paragraph), but is a DELIBERATELY SEPARATE type: a
// RichTextNode gets its inline run positioning from pretext's real text-shaping engine, while chart
// text has always used a rough, unmeasured heuristic (`estimateTextWidth` in chart-geometry.ts)
// precisely because chart layout must stay synchronous and pixel-identical between the on-screen
// SVG renderer and the PDF exporter — reusing pretext's real measurement here isn't an option, so
// this can't just be `RichTextRun`. Adds `opacity` (which `RichTextRun` doesn't have) since a
// "smaller, lower-opacity subtext" run is the primary motivating case.
export type ChartTextRun = {
  /** May contain `'\n'` — forces a line break after this run, continuing the next run on a new
   *  line (rather than needing a separate array entry per line). */
  text: string
  /** Falls back to the ambient default font size for that text role (e.g. the title's own
   *  `fontSize`, `ChartAxisConfig.tickFontSize`) when this run omits it. */
  fontSize?: number
  /** Falls back to the ambient default color for that text role when this run omits it. */
  color?: string
  /** `0-1`. Default 1. */
  opacity?: number
  fontWeight?: number | string
  fontStyle?: 'normal' | 'italic'
}

/** A plain `string` means "one run, one line, ambient style" — every existing plain-string caller
 *  keeps working unchanged. A `ChartTextRun[]` opts into per-run styling and/or explicit multi-line
 *  (via `\n` inside any run's `text`). **Throws** if an empty array is given where a label is
 *  required. */
export type ChartText = string | ChartTextRun[]

export type ChartKind = 'categorical' | 'radial' | 'scatter' | 'gantt' | 'radar' | 'candlestick' | 'treemap'

export type ChartSeriesFillConfig = {
  /** Overrides this series' own resolved color as the gradient's opaque end. */
  color?: string
  /** Opacity at the line, fading linearly to fully transparent at the baseline. Default 0.25. */
  opacity?: number
}

export type ChartSeriesKind = 'bar' | 'line' | 'points'

export type ChartSeries = {
  name?: ChartText
  data: number[]
  color?: string
  /** How THIS series renders, independent of every other series in the same chart — freely mix
   *  e.g. two `'bar'` series (grouped/stacked together — see `CategoricalChartNode.barMode`;
   *  grouping/stacking only ever happens AMONG `'bar'`-kind series, never across kinds) with a
   *  `'line'` series and a `'points'` series (markers only, no connecting stroke), all sharing the
   *  same category x-axis and y-domain. Default `'bar'`. */
  kind?: ChartSeriesKind
  /** `kind: 'line'` only — chart() throws if set on a `'bar'`/`'points'` series (a stroke-less
   *  "points" series has no line to fill toward a baseline, and a fill under a bar would duplicate
   *  the bar itself). Off by default. Fills the area between this series' line and the baseline
   *  (the same zero/domain-edge baseline bars grow from) with a linear gradient — opaque at the
   *  line, fading to fully transparent at the baseline, so anything behind the chart stays visible
   *  near the bottom. `true` fills with this series' own resolved color at the default opacity; an
   *  object overrides `color` and/or `opacity`. Purely a per-series toggle — unrelated series in
   *  the same chart can mix filled and unfilled lines. */
  fill?: boolean | ChartSeriesFillConfig
  /** `kind: 'line'`/`'points'` only — per-series override of `CategoricalChartNode.lineCurve`, e.g.
   *  so one series in a mixed chart draws a monotone curve while another stays linear. Falls back
   *  to the chart-level default when unset. */
  curve?: 'linear' | 'monotone'
  /** `kind: 'line'` only — per-series override of `CategoricalChartNode.lineStrokeWidth`. */
  strokeWidth?: number
  /** `kind: 'line'`/`'points'` only — per-series override of `CategoricalChartNode.markerRadius`
   *  (points ARE markers, so this sizes them the same way a line's data-point markers are sized). */
  markerRadius?: number
}
export type ChartSlice = { label: ChartText; value: number; color?: string }

export type ChartAxisConfig = {
  /** Master toggle for y-axis ticks/labels AND x-axis category labels (bar/line only). Default true. */
  show?: boolean
  /** Independent of `show` — lets gridlines be turned off while ticks/labels stay. Default true. */
  gridlines?: boolean
  tickCount?: number // default 5
  formatTick?: (value: number) => ChartText
  /** Font size (px) of the y-axis numeric tick labels. Independent of `categoryFontSize` since the
   *  two commonly want different weight (e.g. bigger category names, smaller tick numbers). Default 11. */
  tickFontSize?: number
  /** Font size (px) of the x-axis category labels. Default 11. */
  categoryFontSize?: number
  /** Axis baseline color. Default a neutral gray. */
  color?: string
  /** Gridline color. Independent of `color`/`show` — see `gridlines`. Default a lighter neutral gray. */
  gridlineColor?: string
  /** Text color of BOTH the y-axis tick numbers and the x-axis category labels. Default a muted ink. */
  tickColor?: string
}

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
  domain?: 'zero' | 'auto' | { min?: number; max?: number }
  /** `domain: 'auto'` only; ignored otherwise. Fraction of the resolved data range (`dataMax -
   *  dataMin`) added below the min and above the max — e.g. `0.1` adds 10% of the range to each
   *  side, so the single lowest/highest bar isn't flush with the plot's own edge (which would
   *  otherwise draw it at zero height). Default 0.1. **Throws** if negative. */
  padding?: number
}

export type ChartLegendConfig = {
  /** Default: true for pie/donut, and for bar/line when `series.length > 1`; false otherwise. */
  show?: boolean
  position?: 'right' | 'bottom' // default 'right'
  /** Font size (px) of legend entry labels. Default 11. */
  fontSize?: number
  /** Text color of legend entry labels. Default a secondary ink. */
  color?: string
}

export type ChartTitleConfig = { text: ChartText; fontSize?: number; color?: string }

type ChartCommon = Interactive & SelfAlignable & {
  type: 'chart'
  width?: number
  height?: number
  /** width / height. Used to derive whichever of width/height is missing, same as ImageNode. */
  aspectRatio?: number
  title?: ChartText | ChartTitleConfig
  axis?: ChartAxisConfig
  legend?: ChartLegendConfig
  /** Categorical palette override, cycled by index — falls back to a built-in default palette. */
  colors?: string[]
  /** Font family for every text role in the chart (title/axis/legend). Default a system-ui stack.
   *  On the PDF renderer, this is looked up in the SAME font registry `text()` nodes use
   *  (`registerFont()`) — an unregistered family falls back to Helvetica, same warn-once behavior
   *  as a TextNode with a missing font. */
  fontFamily?: string
  /** Only meaningful when this node is itself a ROW child; ignored for column children. When unset
   *  and `width` is set, the row-slot size defaults to `width` (fixed) — set `flex` only to give a
   *  different fixed size (`'Npx'`) or to opt into flex-grow weighting (a plain number). */
  flex?: FlexSize
}

export type CategoricalChartNode = ChartCommon & {
  chartKind: 'categorical'
  /** x-axis labels, one per data point in every series. */
  categories: ChartText[]
  /** One or more series, each independently `'bar'`/`'line'`/`'points'` via `ChartSeries.kind` —
   *  freely mix e.g. grouped/stacked bars with one or more line/points series sharing the same
   *  category x-axis and y-domain. */
  series: ChartSeries[]
  /** `'vertical'` (default) plots categories left-to-right on the x-axis and values bottom-to-top
   *  on the y-axis — the conventional column/line chart. `'horizontal'` swaps the two axes:
   *  categories run top-to-bottom and values run left-to-right, so bars grow rightward (or
   *  leftward, for a value below the domain's baseline) instead of upward. */
  orientation?: 'vertical' | 'horizontal'
  /** Groups config for how the underlying data maps to the visible plot — currently just the
   *  y-domain; see `ChartViewConfig`. Separate from `axis`, which only ever controls chrome
   *  (ticks/gridlines/labels) drawn on top of whatever domain `view` resolves. */
  view?: ChartViewConfig
  /** Only meaningful AMONG `'bar'`-kind series (ignored, not thrown, if none exist). `'grouped'`
   *  places each category's bar series side by side; `'stacked'` stacks them into one bar per
   *  category, positive values above the zero baseline and negative values below it, each in
   *  series order. A chart's `'line'`/`'points'` series are entirely unaffected either way — they
   *  always draw as their own pass, never grouped/stacked with the bars. Default `'grouped'`. */
  barMode?: 'grouped' | 'stacked'
  /** `barMode: 'stacked'` only. Gap (px) left between consecutive stacked segments — the true
   *  baseline edge and the outermost tip edge are never inset by this. Default 0 (flush segments). */
  barSegmentGap?: number
  /** Corner radius (px) of the rounded "data end" of a bar — see the dataviz mark spec. Default 4. */
  barCornerRadius?: number
  /** Chart-level default for every `'line'`/`'points'`-kind series without its own
   *  `ChartSeries.curve`. `'linear'` (default) connects points with straight segments. `'monotone'`
   *  draws a cubic-Bezier curve through every point using monotone cubic (Fritsch–Carlson)
   *  interpolation — tangents are clamped so the curve never overshoots past a point's own value
   *  between it and its neighbors, unlike a naive Catmull-Rom spline. */
  lineCurve?: 'linear' | 'monotone'
  /** Chart-level default for every `'line'`-kind series without its own `ChartSeries.strokeWidth`.
   *  Stroke width (px) of the line itself. Default 2. */
  lineStrokeWidth?: number
  /** Chart-level default for every `'line'`/`'points'`-kind series without its own
   *  `ChartSeries.markerRadius`. Radius (px) of each data-point marker. The white "surface ring"
   *  behind it stays 2px larger than this, same relationship as the library's default (4px marker /
   *  6px ring). Default 4. */
  markerRadius?: number
}

export type ChartRingSlice = ChartSlice & {
  /** Index into the PREVIOUS ring's `slices` array (`rings[ringIndex - 1].slices`) — declares this
   *  slice a sunburst child of that slice, constraining its angular span to a sub-arc of the
   *  parent's own resolved arc, sized proportionally to this slice's value among its SIBLINGS
   *  (other slices in THIS ring sharing the same `parentIndex`). Meaningless on ring 0 (nothing
   *  "immediately inside" it) — chart() throws if set there. Within any other ring, every slice
   *  must either set this or none may — chart() throws on a ring that mixes parented and
   *  unparented slices, so "some slices nested, some not" only ever means different RINGS, never
   *  different slices within the same ring. */
  parentIndex?: number
}

export type ChartRing = {
  slices: ChartRingSlice[]
  /** Per-ring override of `RadialChartNode.sliceGap`. Falls back to it when unset. */
  sliceGap?: number
  /** Per-ring palette override — same cycling rule as the chart-level `colors`, scoped to this
   *  ring's own slice indices, so an inner and outer ring can use different palettes. */
  colors?: string[]
}

export type RadialChartNode = ChartCommon & {
  chartKind: 'radial'
  /** Concentric rings, ordered innermost (index 0) to outermost. A plain single-ring pie/donut is
   *  just `rings: [{ slices: [...] }]` — there is no separate flat-`slices` shorthand; every radial
   *  chart, single-ring or multi-ring, is authored the same way. */
  rings: ChartRing[]
  /** Angular gap between slices, in degrees. Default 1.5; 0 removes the gap entirely. Per-ring
   *  `ChartRing.sliceGap` overrides this for that one ring. */
  sliceGap?: number
  /** Fraction of the outer radius left as a hole at the very center, shared by every ring (each
   *  ring gets an equal-width radial band across whatever radius remains outside that hole).
   *  Replaces the old `donutInnerRadiusRatio` — same meaning, renamed since "donut" is no longer a
   *  distinct chart kind. Default 0 (a solid pie, no hole). Must be in `[0, 1)`. */
  innerRadiusRatio?: number
}

// A bare numeric axis — deliberately its OWN type, not a reuse of `ChartAxisConfig`: a purely
// numeric axis has no category-label toggle to share, and a chart with two independent numeric
// axes (scatter's x/y, gantt's time axis) needs to resolve each one separately rather than
// `ChartAxisConfig`'s implicit "there is exactly one axis" assumption.
export type ChartNumericAxisConfig = {
  /** Master toggle for this axis' ticks/labels. Default true. */
  show?: boolean
  /** Independent of `show` — lets gridlines be turned off while ticks/labels stay. Default true. */
  gridlines?: boolean
  tickCount?: number // default 5
  formatTick?: (value: number) => ChartText
  tickFontSize?: number // default 11
  /** Axis baseline color. Default a neutral gray. */
  color?: string
  /** Gridline color. Default a lighter neutral gray. */
  gridlineColor?: string
  /** Tick label text color. Default a muted ink. */
  tickColor?: string
}

export type ChartScatterPoint = {
  x: number
  y: number
  /** Bubble-sizing driver — an arbitrary data value (NOT a px radius), mapped through
   *  `ScatterChartNode.sizeScale`. Omitted, or `sizeScale` entirely unset on the chart, means this
   *  point renders at the chart's fixed `pointRadius` instead. **Throws** if negative. */
  size?: number
  color?: string
}

export type ChartScatterSeries = { name?: ChartText; points: ChartScatterPoint[]; color?: string }

export type ChartSizeScaleConfig = {
  /** `'sqrt'` (default): the point's AREA, not its radius, is linearly proportional to `size` — the
   *  standard bubble-chart convention (a value 4x another reads as 4x the area, not 4x the radius /
   *  16x the area, which would visually exaggerate the ratio). `'linear'`: radius directly
   *  proportional to `size`. */
  type?: 'sqrt' | 'linear'
  /** Output radius range (px) that `[min(size), max(size)]` across every point WITH a `size` maps
   *  onto. Default `[4, 24]`. **Throws** if `range[0] >= range[1]` or either bound is negative. */
  range?: [number, number]
}

export type ScatterChartNode = ChartCommon & {
  chartKind: 'scatter'
  series: ChartScatterSeries[]
  xAxis?: ChartNumericAxisConfig
  yAxis?: ChartNumericAxisConfig
  /** Independent x/y domains — same `ChartViewConfig` shape as `CategoricalChartNode.view`, but
   *  unlike that y-domain (which defaults to `'zero'`, always including 0), an omitted `xView`/
   *  `yView` here defaults to `'auto'` instead: scatter data routinely sits far from either axis'
   *  zero (e.g. an x/y correlation plot over a 1000-2000 range), where forcing 0 into view would
   *  squash the actual data into a sliver. Set `{ domain: 'zero' }` explicitly to opt back into the
   *  zero-forcing behavior. */
  xView?: ChartViewConfig
  yView?: ChartViewConfig
  /** Fixed radius (px) for every point without its own `size`, or when `sizeScale` is entirely
   *  unset. Default 4. */
  pointRadius?: number
  /** Presence (even `{}`) opts every point WITH a `size` into bubble sizing; omitted means every
   *  point renders at `pointRadius` regardless of whether it sets `size` — an explicit opt-in so
   *  bubble-vs-plain-scatter never silently flips based on incidental data. */
  sizeScale?: ChartSizeScaleConfig
}

export type ChartGanttTask = {
  label: ChartText
  /** Plain numeric time offset — never a `Date`; this library does no date math anywhere (no
   *  aggregation, no calendar-aware tick generation). Pre-convert real dates to numeric offsets
   *  (e.g. days since a project start) and use `xAxis.formatTick` to render them back as dates. */
  start: number
  /** **Throws** if less than `start`. Equal to `start` is allowed (a zero-width "milestone"). */
  end: number
  /** This task's own bar fill color — independent of its label TEXT color (`labelColor` below);
   *  the two are deliberately not linked, so a task's row label can stay a neutral, readable ink
   *  while its bar carries whatever color scheme the caller wants. */
  color?: string
  /** Flat, single-level row grouping — NOT `TableNode.groups`' nested/aggregating machinery,
   *  deliberately much simpler: tasks sharing a `group` value in a CONTIGUOUS run (adjacent to each
   *  other in `tasks` array order) are preceded by one header band showing that group name. Tasks
   *  are never reordered to cluster a non-contiguous same-named group together — unlike table
   *  grouping's global regroup-by-value, this only recognizes runs as authored. */
  group?: string
  /** Overrides `GanttChartNode.taskLabelColor` for THIS task's own row label alone. */
  labelColor?: string
}

export type ChartGanttGroupStyle = {
  color?: string
  background?: string
  /** Overrides the header BAND's own rendered text — independent of the `group` string used as
   *  this record's key (which stays a plain identifier for lookup/contiguous-run comparison and is
   *  never itself rich text). Falls back to rendering the group key string unchanged. */
  label?: ChartText
}

export type GanttChartNode = ChartCommon & {
  chartKind: 'gantt'
  tasks: ChartGanttTask[]
  xAxis?: ChartNumericAxisConfig
  /** Same `ChartViewConfig` shape as everywhere else, but defaults to `'auto'` (tight to data)
   *  rather than `'zero'` when entirely omitted — same reasoning as `ScatterChartNode.xView`: a
   *  project's task offsets routinely start well after day 0, where forcing 0 into view would
   *  squash the real schedule into a sliver. */
  xView?: ChartViewConfig
  /** px height of each row (task or group header). Default: divides the available plot height
   *  evenly across every row, same as every other chart's band-based layout (e.g. a categorical
   *  chart's category bands). An explicit value is used exactly as given instead — size `height`/
   *  `aspectRatio` generously enough to fit `rows.length * rowHeight`, or rows simply overflow the
   *  chart's own box (same visual-overflow consequence any other fixed-size chart layout already
   *  has, e.g. too many bar-chart categories squeezed into too little width). **Throws** if <= 0. */
  rowHeight?: number
  /** Default: `true` iff any task sets `group`, `false` otherwise. */
  showGroupHeaders?: boolean
  /** Chart-level default text color for every group header band. Falls back to a neutral ink when
   *  entirely unset. A per-group entry in `groups` overrides this for that one group's own band. */
  groupHeaderColor?: string
  /** Chart-level default background color for every group header band. Falls back to a neutral
   *  light gray when entirely unset. A per-group entry in `groups` overrides this for that one
   *  group's own band. */
  groupHeaderBackground?: string
  /** Per-group style override, keyed by the exact `group` string used on `ChartGanttTask`. A group
   *  name with no entry here (or no `groups` object at all) falls back to
   *  `groupHeaderColor`/`groupHeaderBackground` — which themselves fall back to the built-in
   *  defaults. A key that never matches any task's `group` is simply unused, same as an unused
   *  entry in a `colors` palette elsewhere in this library. */
  groups?: Record<string, ChartGanttGroupStyle>
  /** Chart-level default text color for every task's own row label (the task name drawn left of
   *  its bar) — independent of `groupHeaderColor` (that's the header BAND text) and independent of
   *  each task's own bar `color`. Falls back to a neutral ink when entirely unset. Per-task
   *  `ChartGanttTask.labelColor` overrides this for that one task's label alone. */
  taskLabelColor?: string
}

export type ChartRadarSeries = {
  name?: ChartText
  /** One value per category/spoke — same length requirement as `CategoricalChartNode.series[].data`
   *  (one entry per category, in the same order). No special negative-value handling: reuses the
   *  same zero/auto/explicit domain resolution as a categorical chart's y-domain, so a negative
   *  value simply extends the domain like a line chart dipping below its baseline — the domain's
   *  own MINIMUM becomes radius-0 (the center), not a hard-coded literal zero. */
  data: number[]
  color?: string
  /** Flat solid-color-at-opacity fill of the polygon interior — unlike `ChartSeries.fill` (a
   *  line's gradient-to-baseline fade), a closed radial polygon has no single edge that reads as
   *  "the baseline" to fade toward, so this is deliberately simpler: `true` = this series' own
   *  resolved color at the default opacity (0.25); an object overrides `color`/`opacity`. */
  fill?: boolean | ChartSeriesFillConfig
}

export type RadarChartNode = ChartCommon & {
  chartKind: 'radar'
  /** Spokes, arranged evenly around the circle — 0°=top, sweeping clockwise, same convention the
   *  radial chart's own slice angles use. */
  categories: ChartText[]
  series: ChartRadarSeries[]
  /** Shared radial domain — every series' polygon is scaled against the SAME domain, same as a
   *  categorical chart's shared y-domain across its series. */
  view?: ChartViewConfig
  /** Reuses `ChartAxisConfig` (not `ChartNumericAxisConfig`) since radar genuinely has both a
   *  category axis (the spokes/categoryFontSize) AND a value axis (the concentric rings/
   *  tickFontSize) at once, matching what `ChartAxisConfig` already models for a categorical chart. */
  axis?: ChartAxisConfig
  /** Radius (px) of each vertex marker. `0` draws no markers at all. Default 3. */
  markerRadius?: number
  /** Stroke width (px) of each series' polygon outline. Default 2. */
  lineStrokeWidth?: number
}

export type ChartCandle = {
  open: number
  high: number
  low: number
  close: number
}

export type ChartCandlestickSeries = {
  name?: ChartText
  /** One candle per category, same length requirement as `CategoricalChartNode.series[].data`. */
  data: ChartCandle[]
  /** Per-series override of `CandlestickChartNode.upColor`/`downColor`. */
  upColor?: string
  downColor?: string
}

export type CandlestickChartNode = ChartCommon & {
  chartKind: 'candlestick'
  categories: ChartText[]
  series: ChartCandlestickSeries[]
  /** Same `ChartViewConfig` shape as everywhere else, but defaults to `'auto'` rather than `'zero'`
   *  when entirely omitted — same reasoning as `ScatterChartNode.xView`/`GanttChartNode.xView`: real
   *  price data routinely sits far from 0 (e.g. a stock trading in the 140-180 range), where forcing
   *  0 into view would squash the actual candles into a sliver at the very top of the plot. */
  view?: ChartViewConfig
  axis?: ChartAxisConfig
  /** px width of each candle's body. Default: mirrors a single-series bar's own band-fit sizing
   *  (capped at `BAR_MAX_THICKNESS`), divided among series like grouped bars when there's more
   *  than one. */
  candleWidth?: number
  /** px width of the high-low wick line. Default 1. */
  wickWidth?: number
  /** Chart-level default fill color for a candle whose `close >= open`. Default a green. Per-series
   *  `ChartCandlestickSeries.upColor` overrides this for that series alone. */
  upColor?: string
  /** Chart-level default fill color for a candle whose `close < open`. Default a red. */
  downColor?: string
}

export type ChartTreemapItem = { label: ChartText; value: number; color?: string }

export type TreemapChartNode = ChartCommon & {
  chartKind: 'treemap'
  /** Flat, single-level — no nested/hierarchical drill-down (a hierarchical treemap was considered
   *  and deliberately scoped out, matching the complexity level of every other new chart kind
   *  here). Laid out via the standard squarified algorithm (Bruls/Huizing/van Wijk): rectangle area
   *  is proportional to `value`, packed to keep aspect ratios close to 1:1 rather than the thin
   *  slivers a naive slice-and-dice layout produces. **Throws** if any `value` is negative or
   *  non-finite (a zero value is allowed — it degenerates to a zero-area rectangle the layout
   *  simply skips, same "contributes no visible mark" pattern a zero data value already has
   *  elsewhere, e.g. `stackedBarSegments`). */
  items: ChartTreemapItem[]
  /** px gap between adjacent rectangles — same "surface gap separates touching marks" convention
   *  as `MARK_SURFACE_GAP` elsewhere, applied uniformly to every rectangle's own edges (a treemap
   *  has no shared "baseline" edge the way a stacked bar does, so there's no flush-outer-edge
   *  exception to make). Default 2. **Throws** if negative. */
  itemGap?: number
  /** px font size for each rectangle's own inline label WHEN a run doesn't set its own `fontSize`.
   *  A rectangle too small to fit its label at this size simply omits it — never overflows past the
   *  rectangle's own edge, never wraps. Default 12. */
  labelFontSize?: number
  /** Formats the text drawn inside each rectangle — same "caller-supplied formatting hook" pattern
   *  as `ChartAxisConfig.formatTick`/`ChartNumericAxisConfig.formatTick` elsewhere in this file.
   *  Receives the item itself (not just its `label`), so the formatted content can fold in `value`
   *  too, and — via `ChartTextRun[]` — style the name and the value differently (e.g. a bigger bold
   *  name run, a smaller lower-opacity value run below it via `\n`). The too-small-to-fit check is
   *  measured against the formatted content's own widest line and total block height, not the raw
   *  `label` — an empty result (or only blank lines) omits the label entirely, so returning `''`
   *  to hide small items keeps working unchanged. Default: `item.label` unchanged. */
  formatLabel?: (item: ChartTreemapItem) => ChartText
}

export type ChartNode =
  | CategoricalChartNode
  | RadialChartNode
  | ScatterChartNode
  | GanttChartNode
  | RadarChartNode
  | CandlestickChartNode
  | TreemapChartNode

// Report-style row grouping (see the "Column grouping" section of GUIDE.md). A group level is a
// TABLE-level concept, entirely independent of `columns`/`cells` — it never marks or strips any
// column. Its bucketing value comes from `TableRow.groupValues` (one entry per level), not from any
// cell. table()'s builder desugars `groups` away entirely (see applyGroupingRows() below) before the
// node ever exists at runtime — table-layout.ts, geometry.ts, shadow-dom.ts, and hit-registry.ts
// never know grouping happened.
export type TableGroupLevel = {
  /** rows = the ORIGINAL authored rows in this bucket. Defaults to a plain bold text label showing
   *  the value. Return a `Node` for a single full-width bar (the default shape), or `TableCell[]`
   *  for a colSpan-aware, column-grid-aligned header — same implicit-flow tiling as `totals()`
   *  (one cell per column, `colSpan` allowed, `rowSpan` rejected since a header is always exactly
   *  one physical row). Unlike the `Node` form, a `TableCell[]` header is NOT indented by nesting
   *  depth — its cells align with the real column grid, same as a `totals()` row. */
  header?: (value: string, rows: TableRow[]) => Node | TableCell[]
  background?: string
  /** Opt-in totals row appended at the end of this group. `rows` = ALL rows in this group,
   *  flattened across any nested subgroups beneath it — aggregate over all of them, not just the
   *  ones directly at this level. Must return exactly one cell per column (same shape as an
   *  ordinary row — there's no "non-grouped columns" subset anymore). */
  totals?: (rows: TableRow[]) => TableCell[]
  /** Whether THIS level's header bar re-appears at the top of a continuation page when the
   *  group's rows split across a page boundary. Overrides `TableNode.repeatGroupHeaders` for this
   *  level only; falls back to it when unset (which itself defaults to `true`). */
  repeat?: boolean
  /** Accent line at this level's own header bar's own top/bottom edge — a full-width rule that
   *  OVERRIDES (not adds to) whatever `TableNode.border.inner` horizontal line or
   *  `border.headerSeparator` would otherwise draw at that exact boundary. Baked onto the
   *  synthesized `kind: 'header'` row's own `topBorder`/`bottomBorder` by table()'s
   *  applyGroupingRows() — see those fields on `TableRow` below. */
  headerBorder?: { top?: ContainerBorder; bottom?: ContainerBorder }
  /** Same, for this level's `totals()` row. `table()` throws if set without `totals` — there's no
   *  totals row to attach it to. */
  totalsBorder?: { top?: ContainerBorder; bottom?: ContainerBorder }
}

export type TableColumn = {
  width?: FlexSize
  background?: string
  align?: CrossAlign
  /** Per-column default cell padding (px, all 4 sides) — overrides `TableNode.cellPadding` for
   *  every cell in this column, unless that cell sets its own `TableCell.padding`. */
  padding?: number
  /** Per-column default vertical alignment — overrides the table default (`'start'`) for every
   *  cell in this column, unless that cell or its row sets its own `verticalAlign`. Also applies
   *  to the auto-generated header row (from `content`, below), which has no other way to set this. */
  verticalAlign?: 'start' | 'center' | 'end'
  /**
   * Optional header caption for this column. If ANY column defines this, table() auto-builds a
   * single header row from every column's `content` (all of them must then define it — partial
   * adoption is rejected) and sets `headerRows` to 1 automatically. Mutually exclusive with
   * manually setting `headerRows` yourself (table() throws if both are used) — the manual-row
   * mechanism remains available unchanged for anyone who wants more control (e.g. a multi-row
   * header).
   */
  content?: Node
}

// colSpan/rowSpan use implicit HTML-table-like flow: a row's `cells` array lists only the cells
// that START in that row, left-to-right — table() skips column slots already occupied by an
// earlier row's rowSpan when resolving each cell's actual column position. See GUIDE.md's "Cell
// spans" section. Mutually exclusive with manually-authored `kind: 'header'` rows in the same
// table (table() throws if combined) — freely combinable with column grouping (`TableNode.groups`),
// since grouping has no interaction with `columns`/`cells` at all; see "rowSpan clusters and
// grouping" in GUIDE.md for the one narrow restriction that still applies.
export type TableCell = {
  content?: Node
  /** Number of columns this cell spans, starting at its resolved column. Default 1. */
  colSpan?: number
  /** Number of rows this cell spans, starting at its own row. Default 1. A rowSpan > 1 makes the
   *  rows it covers an atomic pagination cluster — see GUIDE.md's "Cell spans" section. */
  rowSpan?: number
  background?: string
  align?: CrossAlign // overrides the cell's column — for a colSpan cell, resolved against its STARTING column only
  verticalAlign?: 'start' | 'center' | 'end' // overrides the cell's row
  /** Overrides `column.padding`/`TableNode.cellPadding` for THIS cell only (px, all 4 sides). */
  padding?: number
  /** A complete rectangle drawn around this cell's own box — independent of, and always drawn on
   *  top of, the table-wide `TableNode.border` modes. Unlike those (which never double-draw
   *  thickness at a shared edge between two cells), a per-cell border always draws its own full
   *  perimeter, so two adjacent bordered cells show a double-thickness line between them — a
   *  simpler, deliberately different look, not a bug. No `borderRadius` (a rounded corner on one
   *  cell in a shared grid has no well-defined visual meaning next to its square neighbors). */
  border?: ContainerBorder
  /**
   * Plain comparable value, purely a convenience: `totals()` callbacks receive the original
   * authored rows, so stashing a plain number/string here (alongside `content`) gives them
   * something to read/sum without parsing it back out of a rendered Node. Never required by
   * table() itself — unrelated to column grouping, which reads its bucketing value from
   * `TableRow.groupValues` instead (kept separate from `content` since `content` is an arbitrary
   * Node, not inspectable for aggregation).
   */
  value?: string
  /** @internal resolved starting column index — set by table() (via resolveCellSpans()) whenever
   *  any cell in the table uses colSpan/rowSpan; table-layout.ts reads this directly instead of
   *  assuming array position === column index, which implicit-flow authoring intentionally
   *  violates. Unset (and unused, falling back to array position) for a table with no spans. */
  __resolvedCol?: number
}

export type TableRow =
  | {
      kind?: 'cells'
      cells: TableCell[]
      /** One entry per level in `TableNode.groups`, same order — the value this row buckets under
       *  at each grouping level. Required (with the right length) when `TableNode.groups` is set;
       *  entirely independent of `cells`/`columns` — see "Column grouping" in GUIDE.md. */
      groupValues?: string[]
      background?: string
      verticalAlign?: 'start' | 'center' | 'end'
      /** Full-width accent line at this row's own top/bottom edge, overriding whatever
       *  `TableNode.border.inner` horizontal line (or `border.headerSeparator`, at that one
       *  boundary) would otherwise draw there — not additive, an explicit override. Baked in by
       *  table()'s applyGroupingRows() from a `TableGroupLevel.totalsBorder`-configured totals
       *  row; directly authorable by hand on any row too, same as `kind: 'header'`'s `repeat`
       *  field already is. */
      topBorder?: ContainerBorder
      bottomBorder?: ContainerBorder
      /** @internal true if this row cannot be separated from the NEXT row by a page cut — set by
       *  table() (via resolveCellSpans()) when a rowSpan cell starting at or before this row still
       *  has rows left to cover after it. Unset for an ordinary table — every row is its own
       *  single-row "cluster," exactly like before this feature existed. */
      __atomicWithNext?: boolean
    }
  | {
      /** Full-width bar, no per-column cells by default — sidesteps needing colSpan for this
       *  specific case. Directly authorable by hand too, not just via automatic column grouping —
       *  useful as a manual section-divider banner in any table (but mutually exclusive with
       *  colSpan/rowSpan elsewhere in the same table — see GUIDE.md). Hand-authored banner rows
       *  must use `content`; `cells` is only ever produced by `TableGroupLevel.header()` returning
       *  `TableCell[]` (table() throws if a manually-authored header row sets `cells`). */
      kind: 'header'
      /** Nesting depth (0 = outermost group) — drives the default indent for the `content` form
       *  (irrelevant for `cells`, which aligns to the real column grid instead — see below).
       *  Irrelevant for a hand-authored banner row; leave at 0. */
      depth: number
      /** Exactly one of `content`/`cells` is set. `content` — a single Node spanning the table's
       *  full width, indented by nesting depth. */
      content?: Node
      /** `cells` — colSpan-aware, column-grid-aligned cells instead of one full-width Node; see
       *  `TableGroupLevel.header()`. Resolved through the same `resolveCellSpans()` implicit-flow
       *  tiling a `totals()` row gets. */
      cells?: TableCell[]
      background?: string
      /** Full-width accent line at this bar's own top/bottom edge — same field/semantics as the
       *  `kind?: 'cells'` variant's `topBorder`/`bottomBorder` above. Baked in by table()'s
       *  applyGroupingRows() from `TableGroupLevel.headerBorder`, or set directly on a
       *  hand-authored banner row. */
      topBorder?: ContainerBorder
      bottomBorder?: ContainerBorder
      /** Already-resolved: whether this specific header instance re-appears at the top of a
       *  continuation page if the surrounding rows split across a page boundary. table-layout.ts
       *  reads this directly (`row.repeat ?? true`) — it has no awareness of `TableGroupLevel` or
       *  which level produced this row, by design (see the "Column grouping" desugaring note). For
       *  an automatically-grouped level this is baked in by `applyGroupingRows()` from
       *  `TableGroupLevel.repeat`/`TableNode.repeatGroupHeaders`; for a manually-authored banner
       *  row, set it directly (defaults to `true`, same as everywhere else). */
      repeat?: boolean
    }

/** `'horizontal'`/`'vertical'` are scoped to whichever line-group carries this mode: for
 *  `TableNode.border.inner` they mean "only between-row lines"/"only between-column lines"; for
 *  `TableNode.border.outer` they mean "only the top+bottom perimeter edges"/"only the left+right
 *  perimeter edges." `'all'` draws every line in that group; `'none'` (or the group being entirely
 *  absent) draws none. */
export type TableBorderLineMode = 'none' | 'horizontal' | 'vertical' | 'all'

/** One line-drawing config, shared shape for both `TableNode.border.inner` and `.outer`. `mode`
 *  defaults to `'all'` whenever the surrounding line-group object is present (even with `mode`
 *  itself unset) — same "object present = mode defaults to all" rule the old single `border.mode`
 *  used, now applied to `inner`/`outer` independently. `thickness`/`color`/`style` each default
 *  independently too (`1`/`'#000000'`/`'solid'`) — inner and outer no longer have to match. */
export type TableBorderLine = { mode?: TableBorderLineMode; thickness?: number; color?: string; style?: LineStyle }

export type TableNode = Interactive & {
  type: 'table'
  columns: TableColumn[]
  rows: TableRow[]
  /** Report-style row grouping levels, ordered outermost -> innermost — entirely independent of
   *  `columns`; see "Column grouping" in GUIDE.md. Each row supplies its bucketing value(s) via
   *  `TableRow.groupValues`, one entry per level, in this same order. */
  groups?: TableGroupLevel[]
  /** Leading row count repeated at the top of every continuation page this table spans. Can be
   *  freely combined with column grouping (`groups`) — see GUIDE.md's "Column grouping" section —
   *  but mutually exclusive with per-column `content` captions (table() throws if both are set). */
  headerRows?: number
  /** Background for the single auto-generated header row (from per-column `content` captions —
   *  see `TableColumn.content`). Ignored if no column defines `content`, or if you author your own
   *  header row(s) manually via `headerRows` instead (give that row its own `background` there). */
  headerBackground?: string
  /** Whether the table's own header (the `headerRows` prefix, whether hand-authored or
   *  auto-generated via `column.content`) repeats at the top of every continuation page, or
   *  appears only once at the very top of the table. Default `true` — the existing, always-repeat
   *  behavior. */
  repeatHeaderRow?: boolean
  /** Table-wide default for `TableGroupLevel.repeat` on every grouping level that doesn't set its
   *  own — default `true` (every group level's header bar repeats on a continuation page unless
   *  that level, or this, opts out). */
  repeatGroupHeaders?: boolean
  /** Omitted entirely = no borders at all. `inner` (grid lines between rows/columns) and `outer`
   *  (the table's own perimeter) are fully independent — set one without the other, with their own
   *  mode/thickness/color/style each. To reproduce the old single-`mode` shorthand: old `'outer'`
   *  is `{ inner: { mode: 'none' }, outer: {} }`; old `'horizontal'`/`'vertical'`/`'all'`/`'none'`
   *  is the same mode set on BOTH `inner` and `outer`. `headerSeparator` draws one more line at the
   *  boundary between the table's `headerRows` prefix and its body — `true` reuses `inner`'s own
   *  thickness/color/style, an object is fully custom; silently skipped if `headerRows` is 0 (no
   *  boundary exists). An individual cell's own `TableCell.border` (full rect) and a
   *  `TableGroupLevel.headerBorder`/`totalsBorder` accent line (which overrides whatever `inner`/
   *  `headerSeparator` would otherwise draw at that one row boundary) are both independent of, and
   *  drawn on top of, everything here. `generateDocx()`/`generateXlsx()` support independent
   *  inner/outer thickness/color/style but not `headerSeparator` or a row's own `topBorder`/
   *  `bottomBorder` — those are silently skipped there with a one-time console warning, same
   *  precedent as `outer.borderRadius` already has. */
  border?: {
    inner?: TableBorderLine
    outer?: TableBorderLine & {
      /** Rounds the outer perimeter's 4 corners and real-clips cell/row/header backgrounds and
       *  content to match (same clipping `ContainerNode.borderRadius` does) — only meaningful when
       *  `outer.mode` is `'all'` (the only mode that draws a closed rectangle); `table()` throws
       *  otherwise. `generateDocx()`/`generateXlsx()` ignore it (draw square corners) with a
       *  one-time console warning — neither format has a rounded-table-border primitive. */
      borderRadius?: number
    }
    headerSeparator?: ContainerBorder | boolean
  }
  cellPadding?: number // default 0, reserved on all 4 sides inside every cell box
  /** Alternating row background, desugared entirely at table() build time into per-row
   *  `background` (table-layout.ts never knows striping happened, same architecture as `groups`).
   *  Applies only to ordinary data rows — never the table's own literal header-row prefix, nor a
   *  column-grouping header/divider bar — and never overrides a row that already sets its own
   *  `background`. `even`/`odd` count sequentially through those data rows starting at 0 (even). */
  stripe?: { even?: string; odd?: string }
  /** Only meaningful when this node is itself a ROW child; ignored for column children. */
  flex?: FlexSize
}

export type Node = GroupNode | TextNode | RichTextNode | SeparatorNode | PageBreakNode | ImageNode | TableNode | ChartNode | ContainerNode | SvgNode
// Phase 2 (not built here): a generic CustomNode escape hatch — added as a new union member plus a
// new registry entry in behavior.ts, with no change required to paginate.ts or group-layout.ts.

export function definePage(config: Omit<PageDef, 'body'>, body: Node): PageDef {
  return { ...config, body }
}

export function group(config: DistributiveOmit<GroupNode, 'type' | 'children'>, children: Node[]): GroupNode {
  return { type: 'group', ...config, children }
}

export function text(config: Omit<TextNode, 'type' | 'lineHeight'> & { lineHeight?: number }): TextNode {
  const lineHeight = config.lineHeight ?? Math.round(config.fontSize * 1.2)
  return { type: 'text', ...config, lineHeight }
}

export function richText(config: Omit<RichTextNode, 'type' | 'lineHeight'> & { lineHeight?: number }): RichTextNode {
  const lineHeight = config.lineHeight ?? Math.round(config.fontSize * 1.2)
  return { type: 'richText', ...config, lineHeight }
}

export function separator(config?: Omit<SeparatorNode, 'type'>): SeparatorNode {
  return { type: 'separator', ...config }
}

/**
 * Forces a page break at this point in the document flow. Redundant/leading breaks (nothing has
 * been placed on the current page yet) are silently no-ops rather than producing a blank page —
 * only meaningful inside COLUMN-direction structure; has no effect as a row's column.
 */
export function pageBreak(): PageBreakNode {
  return { type: 'page-break' }
}

export function image(config: Omit<ImageNode, 'type'>): ImageNode {
  const hasHeight = config.height !== undefined
  const hasAspectRatio = config.aspectRatio !== undefined
  if (!hasHeight && !hasAspectRatio) {
    throw new Error(
      '[paginator] image() needs "height" or "aspectRatio" to determine its height — image dimensions are never auto-detected from the loaded asset.',
    )
  }
  return { type: 'image', ...config }
}

export function svg(config: Omit<SvgNode, 'type'>): SvgNode {
  if (!config.markup.includes('<svg')) {
    throw new Error('[paginator] svg() "markup" does not look like an SVG document — expected a string containing an "<svg" root element.')
  }
  const hasHeight = config.height !== undefined
  const hasAspectRatio = config.aspectRatio !== undefined
  if (!hasHeight && !hasAspectRatio) {
    throw new Error(
      '[paginator] svg() needs "height" or "aspectRatio" to determine its height — dimensions are never auto-detected from the markup.',
    )
  }
  return { type: 'svg', ...config }
}

export function container(config: Omit<ContainerNode, 'type' | 'child'>, child: Node): ContainerNode {
  return { type: 'container', ...config, child }
}

// A plain-text preview of a `ChartText` value for use ONLY in chart()'s own error messages (never
// for rendering) — a rich `ChartTextRun[]` has no single obvious "the text," so this concatenates
// every run's own text in order, ignoring styling entirely.
function chartTextPreview(content: ChartText | undefined): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content.map(r => r.text).join('')
}

// A `ChartTextRun[]` with zero runs has nothing to render and no single sensible "the text" for
// error messages either — thrown for every REQUIRED label field (optional `name?`/`title?` fields
// simply render nothing when omitted entirely, so an empty array there is comparatively harmless
// and left unvalidated, same leniency this codebase gives other optional cosmetic fields).
function assertNonEmptyChartText(content: ChartText, fieldDescription: string): void {
  if (Array.isArray(content) && content.length === 0) {
    throw new Error(`[paginator] chart() ${fieldDescription} is an empty array — a ChartTextRun[] must have at least one run.`)
  }
}

export function chart(config: DistributiveOmit<ChartNode, 'type'>): ChartNode {
  const hasHeight = config.height !== undefined
  const hasAspectRatio = config.aspectRatio !== undefined
  if (!hasHeight && !hasAspectRatio) {
    throw new Error(
      '[paginator] chart() needs "height" or "aspectRatio" to determine its height — chart dimensions are never auto-detected.',
    )
  }

  // Cast used only for the cross-branch defensive checks below: a plain-JS caller isn't held to
  // the bar/line-vs-pie/donut split the types now enforce, so these still need to inspect fields
  // the narrowed type says shouldn't exist on the other branch.
  const raw = config as Record<string, unknown>

  if (config.chartKind === 'categorical') {
    if (raw.slices !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "categorical" cannot use "slices" — use "categories"/"series" instead.`)
    }
    if (config.categories === undefined || config.categories.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "categorical" needs a non-empty "categories" array.`)
    }
    config.categories.forEach((c, ci) => assertNonEmptyChartText(c, `categories[${ci}]`))
    if (config.series === undefined || config.series.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "categorical" needs a non-empty "series" array.`)
    }
    config.series.forEach((s, i) => {
      const namePreview = chartTextPreview(s.name)
      const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`
      if (s.data.length !== config.categories.length) {
        throw new Error(`[paginator] chart() series ${label} has ${s.data.length} data points, expected ${config.categories.length} (one per category).`)
      }
      const kind = s.kind ?? 'bar'
      if (s.fill !== undefined && kind !== 'line') {
        throw new Error(`[paginator] chart() series ${label} sets "fill", which only applies to a 'line'-kind series (this series is "${kind}").`)
      }
      if (typeof s.fill === 'object' && s.fill.opacity !== undefined && (s.fill.opacity < 0 || s.fill.opacity > 1)) {
        throw new Error(`[paginator] chart() series ${label} "fill.opacity" must be in [0, 1], got ${s.fill.opacity}.`)
      }
      if (s.curve !== undefined && kind !== 'line' && kind !== 'points') {
        throw new Error(`[paginator] chart() series ${label} sets "curve", which only applies to a 'line'/'points'-kind series (this series is "${kind}").`)
      }
      if (s.strokeWidth !== undefined && kind !== 'line') {
        throw new Error(`[paginator] chart() series ${label} sets "strokeWidth", which only applies to a 'line'-kind series (this series is "${kind}").`)
      }
      if (s.markerRadius !== undefined && kind !== 'line' && kind !== 'points') {
        throw new Error(`[paginator] chart() series ${label} sets "markerRadius", which only applies to a 'line'/'points'-kind series (this series is "${kind}").`)
      }
    })
    if (config.barSegmentGap !== undefined && config.barSegmentGap < 0) {
      throw new Error(`[paginator] chart() "barSegmentGap" must be non-negative, got ${config.barSegmentGap}.`)
    }
    const domain = config.view?.domain
    if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
      throw new Error(`[paginator] chart() "view.domain.min" (${domain.min}) must be less than "view.domain.max" (${domain.max}).`)
    }
    if (config.view?.padding !== undefined && config.view.padding < 0) {
      throw new Error(`[paginator] chart() "view.padding" must be non-negative, got ${config.view.padding}.`)
    }
  } else if (config.chartKind === 'radial') {
    if (raw.categories !== undefined || raw.series !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "radial" cannot use "categories"/"series" — use "rings" instead.`)
    }
    if (raw.slices !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "radial" has no top-level "slices" — author a single-ring pie as "rings: [{ slices: [...] }]".`)
    }
    if (config.rings === undefined || config.rings.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "radial" needs a non-empty "rings" array.`)
    }
    config.rings.forEach((ring, ri) => {
      if (ring.slices === undefined || ring.slices.length === 0) {
        throw new Error(`[paginator] chart() ring ${ri} needs a non-empty "slices" array.`)
      }
      ring.slices.forEach((s, si) => {
        assertNonEmptyChartText(s.label, `ring ${ri} slice ${si} "label"`)
        if (!Number.isFinite(s.value) || s.value < 0) {
          throw new Error(`[paginator] chart() ring ${ri} slice ${si} ("${chartTextPreview(s.label)}") needs a non-negative finite "value", got ${s.value}.`)
        }
      })
      if (ri === 0) {
        if (ring.slices.some(s => s.parentIndex !== undefined)) {
          throw new Error(`[paginator] chart() ring 0 slices cannot set "parentIndex" — there is no ring inside the innermost ring.`)
        }
      } else {
        const parentedCount = ring.slices.filter(s => s.parentIndex !== undefined).length
        if (parentedCount > 0 && parentedCount < ring.slices.length) {
          throw new Error(`[paginator] chart() ring ${ri} mixes slices with and without "parentIndex" — a ring must be either fully hierarchical (every slice has a parentIndex) or fully flat (none do).`)
        }
        const previousRingSliceCount = config.rings![ri - 1]!.slices.length
        ring.slices.forEach((s, si) => {
          if (s.parentIndex !== undefined && (s.parentIndex < 0 || s.parentIndex >= previousRingSliceCount || !Number.isInteger(s.parentIndex))) {
            throw new Error(`[paginator] chart() ring ${ri} slice ${si} "parentIndex" (${s.parentIndex}) is out of bounds for ring ${ri - 1}, which has ${previousRingSliceCount} slice(s).`)
          }
        })
      }
      if (ring.sliceGap !== undefined && ring.sliceGap < 0) {
        throw new Error(`[paginator] chart() ring ${ri} "sliceGap" must be non-negative, got ${ring.sliceGap}.`)
      }
    })
    if (config.innerRadiusRatio !== undefined && (config.innerRadiusRatio < 0 || config.innerRadiusRatio >= 1)) {
      throw new Error(`[paginator] chart() "innerRadiusRatio" must be in [0, 1), got ${config.innerRadiusRatio}.`)
    }
    if (config.sliceGap !== undefined && config.sliceGap < 0) {
      throw new Error(`[paginator] chart() "sliceGap" must be non-negative, got ${config.sliceGap}.`)
    }
  } else if (config.chartKind === 'scatter') {
    if (raw.categories !== undefined || raw.slices !== undefined || raw.rings !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "scatter" cannot use "categories"/"slices"/"rings" — use "series" (with per-point x/y) instead.`)
    }
    if (config.series === undefined || config.series.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "scatter" needs a non-empty "series" array.`)
    }
    config.series.forEach((s, i) => {
      const namePreview = chartTextPreview(s.name)
      const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`
      if (s.points === undefined || s.points.length === 0) {
        throw new Error(`[paginator] chart() series ${label} needs a non-empty "points" array.`)
      }
      s.points.forEach((p, pi) => {
        if (p.size !== undefined && p.size < 0) {
          throw new Error(`[paginator] chart() series ${label} point ${pi} "size" must be non-negative, got ${p.size}.`)
        }
      })
    })
    if (config.sizeScale?.range !== undefined) {
      const [rMin, rMax] = config.sizeScale.range
      if (rMin < 0 || rMax < 0 || rMin >= rMax) {
        throw new Error(`[paginator] chart() "sizeScale.range" must be [min, max] with 0 <= min < max, got [${rMin}, ${rMax}].`)
      }
    }
    for (const [key, view] of [['xView', config.xView] as const, ['yView', config.yView] as const]) {
      const domain = view?.domain
      if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
        throw new Error(`[paginator] chart() "${key}.domain.min" (${domain.min}) must be less than "${key}.domain.max" (${domain.max}).`)
      }
      if (view?.padding !== undefined && view.padding < 0) {
        throw new Error(`[paginator] chart() "${key}.padding" must be non-negative, got ${view.padding}.`)
      }
    }
  } else if (config.chartKind === 'gantt') {
    if (raw.categories !== undefined || raw.slices !== undefined || raw.rings !== undefined || raw.series !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "gantt" cannot use "categories"/"slices"/"rings"/"series" — use "tasks" instead.`)
    }
    if (config.tasks === undefined || config.tasks.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "gantt" needs a non-empty "tasks" array.`)
    }
    config.tasks.forEach((t, i) => {
      assertNonEmptyChartText(t.label, `task ${i} "label"`)
      if (t.end < t.start) {
        throw new Error(`[paginator] chart() task ${i} ("${chartTextPreview(t.label)}") has "end" (${t.end}) before "start" (${t.start}).`)
      }
    })
    const domain = config.xView?.domain
    if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
      throw new Error(`[paginator] chart() "xView.domain.min" (${domain.min}) must be less than "xView.domain.max" (${domain.max}).`)
    }
    if (config.xView?.padding !== undefined && config.xView.padding < 0) {
      throw new Error(`[paginator] chart() "xView.padding" must be non-negative, got ${config.xView.padding}.`)
    }
    if (config.rowHeight !== undefined && config.rowHeight <= 0) {
      throw new Error(`[paginator] chart() "rowHeight" must be positive, got ${config.rowHeight}.`)
    }
  } else if (config.chartKind === 'radar') {
    if (raw.slices !== undefined || raw.rings !== undefined || raw.tasks !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "radar" cannot use "slices"/"rings"/"tasks" — use "categories"/"series" instead.`)
    }
    if (config.categories === undefined || config.categories.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "radar" needs a non-empty "categories" array.`)
    }
    config.categories.forEach((c, ci) => assertNonEmptyChartText(c, `categories[${ci}]`))
    if (config.series === undefined || config.series.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "radar" needs a non-empty "series" array.`)
    }
    config.series.forEach((s, i) => {
      const namePreview = chartTextPreview(s.name)
      const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`
      if (s.data.length !== config.categories.length) {
        throw new Error(`[paginator] chart() series ${label} has ${s.data.length} data points, expected ${config.categories.length} (one per category).`)
      }
      if (typeof s.fill === 'object' && s.fill.opacity !== undefined && (s.fill.opacity < 0 || s.fill.opacity > 1)) {
        throw new Error(`[paginator] chart() series ${label} "fill.opacity" must be in [0, 1], got ${s.fill.opacity}.`)
      }
    })
    const domain = config.view?.domain
    if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
      throw new Error(`[paginator] chart() "view.domain.min" (${domain.min}) must be less than "view.domain.max" (${domain.max}).`)
    }
    if (config.view?.padding !== undefined && config.view.padding < 0) {
      throw new Error(`[paginator] chart() "view.padding" must be non-negative, got ${config.view.padding}.`)
    }
    if (config.markerRadius !== undefined && config.markerRadius < 0) {
      throw new Error(`[paginator] chart() "markerRadius" must be non-negative, got ${config.markerRadius}.`)
    }
  } else if (config.chartKind === 'candlestick') {
    if (raw.slices !== undefined || raw.rings !== undefined || raw.tasks !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "candlestick" cannot use "slices"/"rings"/"tasks" — use "categories"/"series" instead.`)
    }
    if (config.categories === undefined || config.categories.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "candlestick" needs a non-empty "categories" array.`)
    }
    config.categories.forEach((c, ci) => assertNonEmptyChartText(c, `categories[${ci}]`))
    if (config.series === undefined || config.series.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "candlestick" needs a non-empty "series" array.`)
    }
    config.series.forEach((s, i) => {
      const namePreview = chartTextPreview(s.name)
      const label = `${i}${namePreview ? ` ("${namePreview}")` : ''}`
      if (s.data.length !== config.categories.length) {
        throw new Error(`[paginator] chart() series ${label} has ${s.data.length} candles, expected ${config.categories.length} (one per category).`)
      }
      s.data.forEach((c, ci) => {
        if (c.low > Math.min(c.open, c.close)) {
          throw new Error(`[paginator] chart() series ${label} candle ${ci} "low" (${c.low}) must be <= min(open, close) (${Math.min(c.open, c.close)}).`)
        }
        if (c.high < Math.max(c.open, c.close)) {
          throw new Error(`[paginator] chart() series ${label} candle ${ci} "high" (${c.high}) must be >= max(open, close) (${Math.max(c.open, c.close)}).`)
        }
      })
    })
    if (config.candleWidth !== undefined && config.candleWidth < 0) {
      throw new Error(`[paginator] chart() "candleWidth" must be non-negative, got ${config.candleWidth}.`)
    }
    if (config.wickWidth !== undefined && config.wickWidth < 0) {
      throw new Error(`[paginator] chart() "wickWidth" must be non-negative, got ${config.wickWidth}.`)
    }
    const domain = config.view?.domain
    if (typeof domain === 'object' && domain.min !== undefined && domain.max !== undefined && domain.min >= domain.max) {
      throw new Error(`[paginator] chart() "view.domain.min" (${domain.min}) must be less than "view.domain.max" (${domain.max}).`)
    }
    if (config.view?.padding !== undefined && config.view.padding < 0) {
      throw new Error(`[paginator] chart() "view.padding" must be non-negative, got ${config.view.padding}.`)
    }
  } else {
    // chartKind === 'treemap'
    if (raw.categories !== undefined || raw.series !== undefined || raw.slices !== undefined || raw.rings !== undefined || raw.tasks !== undefined) {
      throw new Error(`[paginator] chart() with chartKind "treemap" cannot use "categories"/"series"/"slices"/"rings"/"tasks" — use "items" instead.`)
    }
    if (config.items === undefined || config.items.length === 0) {
      throw new Error(`[paginator] chart() with chartKind "treemap" needs a non-empty "items" array.`)
    }
    config.items.forEach((item, i) => {
      assertNonEmptyChartText(item.label, `item ${i} "label"`)
      if (!Number.isFinite(item.value) || item.value < 0) {
        throw new Error(`[paginator] chart() item ${i} ("${chartTextPreview(item.label)}") needs a non-negative finite "value", got ${item.value}.`)
      }
    })
    if (config.itemGap !== undefined && config.itemGap < 0) {
      throw new Error(`[paginator] chart() "itemGap" must be non-negative, got ${config.itemGap}.`)
    }
  }

  return { type: 'chart', ...config } as ChartNode
}

function defaultGroupHeader(value: string): Node {
  return text({ content: value, fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, lineHeight: 15 })
}

// Stable "global regroup by value": every row appends to its value's bucket regardless of its
// position in `rows` (not just adjacent runs), while bucket ORDER follows each distinct value's
// first appearance — see GUIDE.md's "Column grouping" section for why this was chosen over
// contiguous-run grouping.
function stableGroupBy(rows: TableRow[], level: number): { value: string; rows: TableRow[] }[] {
  const order: string[] = []
  const buckets = new Map<string, TableRow[]>()
  for (const row of rows) {
    if (row.kind === 'header') continue // unreachable — applyGroupingRows() rejects header rows upfront when grouping is configured
    const value = row.groupValues?.[level] ?? ''
    if (!buckets.has(value)) {
      buckets.set(value, [])
      order.push(value)
    }
    buckets.get(value)!.push(row)
  }
  return order.map(value => ({ value, rows: buckets.get(value)! }))
}

// A rowSpan cluster's physical rows must agree on every group level's value — otherwise bucketing
// (which only ever FILTERS rows into buckets, never reorders them) would have no choice but to
// interleave a synthesized header/totals row into the middle of an atomic cluster, corrupting the
// contiguous row range resolveRowHeights()/tableMeasurer.split() (table-layout.ts) assume a cluster
// occupies. Checked once, covering every level, before any bucketing begins — sufficient to
// guarantee bucketing never splits a cluster apart at any nesting depth, since a cluster's rows
// (physically contiguous already) can only ever be filtered together into the same bucket if they
// all share that bucket's value.
function validateGroupClusterConstancy(rows: TableRow[], levelCount: number): void {
  let clusterStart = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    if (row.kind === 'header') throw new Error('[paginator] unreachable: header row found where only data rows were expected')
    if (!(row.__atomicWithNext ?? false)) {
      for (let k = clusterStart; k < r; k++) {
        const first = rows[clusterStart] as Extract<TableRow, { kind?: 'cells' }>
        const other = rows[k + 1] as Extract<TableRow, { kind?: 'cells' }>
        for (let level = 0; level < levelCount; level++) {
          if (other.groupValues![level] !== first.groupValues![level]) {
            throw new Error(
              `[paginator] table() rows ${clusterStart}..${r} form a rowSpan cluster but disagree on group values ("${first.groupValues![level]}" vs "${other.groupValues![level]}" at level ${level}) — a rowSpan cluster must share the same group values throughout.`,
            )
          }
        }
      }
      clusterStart = r + 1
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
function applyGroupingRows(rows: TableRow[], groups: TableGroupLevel[], repeatGroupHeadersDefault: boolean, columnCount: number): TableRow[] {
  function recurse(rows: TableRow[], level: number): TableRow[] {
    // Leaf case: no more levels to bucket by. MUST be a literal pass-through, not a per-row
    // reconstructed object — rows may carry `__atomicWithNext`, and cells may carry `__resolvedCol`,
    // both baked in by resolveCellSpans() upstream; reconstructing the row object here would
    // silently drop whichever of those fields this function doesn't know to copy, with no test that
    // would catch the regression (no prior coverage of "spans + grouping in the same table").
    if (level >= groups.length) return rows

    const groupConfig = groups[level]!
    const out: TableRow[] = []
    for (const bucket of stableGroupBy(rows, level)) {
      const headerResult = groupConfig.header?.(bucket.value, bucket.rows) ?? defaultGroupHeader(bucket.value)
      if (Array.isArray(headerResult)) {
        // Resolved through the same implicit-flow tiling a totals() row gets (see there) — a
        // header can use colSpan across its cells too, column-grid-aligned instead of indented by
        // depth. `rowSpan` has nothing to span into (a header is always exactly one row) and
        // surfaces as the same "extends past the last row" throw resolveCellSpans() already gives.
        let resolved: TableRow
        try {
          ;[resolved] = resolveCellSpans([{ cells: headerResult }], columnCount)
        } catch (e) {
          throw new Error(`[paginator] table() group "${bucket.value}" (level ${level})'s header(): ${(e as Error).message}`)
        }
        if (resolved!.kind === 'header') throw new Error('[paginator] unreachable: resolveCellSpans() never returns a header-kind row')
        out.push({
          kind: 'header',
          depth: level,
          cells: resolved!.cells,
          background: groupConfig.background,
          repeat: groupConfig.repeat ?? repeatGroupHeadersDefault,
          topBorder: groupConfig.headerBorder?.top,
          bottomBorder: groupConfig.headerBorder?.bottom,
        })
      } else {
        out.push({
          kind: 'header',
          depth: level,
          content: headerResult,
          background: groupConfig.background,
          repeat: groupConfig.repeat ?? repeatGroupHeadersDefault,
          topBorder: groupConfig.headerBorder?.top,
          bottomBorder: groupConfig.headerBorder?.bottom,
        })
      }
      out.push(...recurse(bucket.rows, level + 1))
      if (groupConfig.totals !== undefined) {
        const totalsCells = groupConfig.totals(bucket.rows)
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
        let totalsRow: TableRow
        try {
          ;[totalsRow] = resolveCellSpans([{ cells: totalsCells, topBorder: groupConfig.totalsBorder?.top, bottomBorder: groupConfig.totalsBorder?.bottom }], columnCount)
        } catch (e) {
          throw new Error(`[paginator] table() group "${bucket.value}" (level ${level})'s totals(): ${(e as Error).message}`)
        }
        out.push(totalsRow!)
      }
    }
    return out
  }

  return recurse(rows, 0)
}

type SpanOccupant = { remaining: number; originRow: number; originCol: number }

// Resolves implicit HTML-table-like colSpan/rowSpan authoring into explicit grid positions: bakes
// `__resolvedCol` onto every cell and `__atomicWithNext` onto every row — see GUIDE.md's "Cell
// spans" section. Pure row-array transform, mirroring applyGroupingRows's shape. The caller
// (table()) is responsible for slicing any literal header-row prefix out of `rows` beforehand
// (spanning is never attempted there) and for the mutual-exclusion throws (column grouping,
// manually-authored `kind: 'header'` rows).
function resolveCellSpans(rows: TableRow[], columnCount: number): TableRow[] {
  const occupancy: (SpanOccupant | null)[] = new Array(columnCount).fill(null)

  const result = rows.map((row, r) => {
    if (row.kind === 'header') throw new Error('[paginator] unreachable: header row found where only data rows were expected')

    let colCursor = 0
    const resolvedCells = row.cells.map(cell => {
      const colSpan = cell.colSpan ?? 1
      const rowSpan = cell.rowSpan ?? 1
      if (!Number.isInteger(colSpan) || colSpan < 1) {
        throw new Error(`[paginator] table() row ${r}: colSpan must be a positive integer, got ${colSpan}`)
      }
      if (!Number.isInteger(rowSpan) || rowSpan < 1) {
        throw new Error(`[paginator] table() row ${r}: rowSpan must be a positive integer, got ${rowSpan}`)
      }
      if (cell.content === undefined) {
        throw new Error(`[paginator] table() row ${r}: cell needs "content"`)
      }
      // Advance past columns already occupied by an earlier row's rowSpan.
      while (colCursor < columnCount && occupancy[colCursor] !== null) colCursor++
      if (colCursor + colSpan > columnCount) {
        throw new Error(`[paginator] table() row ${r}: cell needs ${colSpan} column(s) starting at column ${colCursor}, but the table only has ${columnCount} columns`)
      }
      const resolvedCol = colCursor
      for (let c = colCursor; c < colCursor + colSpan; c++) {
        occupancy[c] = { remaining: rowSpan, originRow: r, originCol: resolvedCol }
      }
      colCursor += colSpan
      return { ...cell, __resolvedCol: resolvedCol }
    })

    // Keep advancing through any remaining TRAILING occupied columns before checking the row fully
    // tiled the grid — a trailing gap that's occupied by an earlier rowSpan is fine; only a
    // genuinely unfilled, non-occupied column is a real "too few cells" error.
    while (colCursor < columnCount && occupancy[colCursor] !== null) colCursor++
    if (colCursor !== columnCount) {
      throw new Error(`[paginator] table() row ${r} has too few cells — column ${colCursor} is neither filled by this row nor occupied by an earlier rowSpan`)
    }

    // This row can't be separated from the next by a page cut if any column's rowSpan still has at
    // least one more row left to cover after this one.
    const atomicWithNext = occupancy.some(o => o !== null && o.remaining > 1)

    for (let c = 0; c < columnCount; c++) {
      const o = occupancy[c]
      if (o !== null) {
        o.remaining--
        if (o.remaining <= 0) occupancy[c] = null
      }
    }

    // Spread `row` first (not a hand-picked field list) so any field this function doesn't know
    // about — `groupValues` in particular, when spans and grouping coexist in the same table —
    // passes through untouched instead of being silently dropped by a reconstructed literal.
    return { ...row, kind: 'cells' as const, cells: resolvedCells, __atomicWithNext: atomicWithNext }
  })

  const dangling = occupancy.find((o): o is SpanOccupant => o !== null)
  if (dangling !== undefined) {
    throw new Error(`[paginator] table() cell at row ${dangling.originRow}, column ${dangling.originCol} has a rowSpan that extends past the last row of the table`)
  }

  return result
}

/**
 * Convenience for a rowSpan cluster's physical rows that all belong to the same group bucket: they
 * must share identical `groupValues` (see "Column grouping" in GUIDE.md's cluster-constancy rule),
 * so instead of repeating the same array by hand on every row, spread it once here. Purely an
 * authoring shortcut — it doesn't change what `table()` validates; the cluster-constancy check
 * still runs on the result exactly as if you'd set `groupValues` on each row yourself.
 */
export function rowGroup(groupValues: string[], rows: Extract<TableRow, { kind?: 'cells' }>[]): TableRow[] {
  return rows.map(row => ({ ...row, groupValues }))
}

export function table(config: Omit<TableNode, 'type'>): TableNode {
  const hasGroups = (config.groups?.length ?? 0) > 0
  const hasStripe = config.stripe !== undefined

  if (config.border?.outer?.borderRadius !== undefined) {
    const resolvedOuterMode = config.border.outer.mode ?? 'all'
    if (resolvedOuterMode !== 'all') {
      throw new Error(
        `[paginator] table() border.outer.borderRadius needs border.outer.mode "all" (got "${resolvedOuterMode}") — no rectangular outer perimeter exists to round otherwise`,
      )
    }
    if (config.border.outer.borderRadius < 0) {
      throw new Error('[paginator] table() border.outer.borderRadius cannot be negative')
    }
  }
  if ((config.border?.inner?.thickness ?? 0) < 0) {
    throw new Error('[paginator] table() border.inner.thickness cannot be negative')
  }
  if ((config.border?.outer?.thickness ?? 0) < 0) {
    throw new Error('[paginator] table() border.outer.thickness cannot be negative')
  }
  if (typeof config.border?.headerSeparator === 'object' && (config.border.headerSeparator.thickness ?? 0) < 0) {
    throw new Error('[paginator] table() border.headerSeparator.thickness cannot be negative')
  }
  config.groups?.forEach((g, level) => {
    if (g.totalsBorder !== undefined && g.totals === undefined) {
      throw new Error(`[paginator] table() groups[${level}].totalsBorder requires groups[${level}].totals to be set — there's no totals row to attach it to`)
    }
  })

  const hasAnySpan = config.rows.some(row => row.kind !== 'header' && row.cells.some(c => (c.colSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1))
  if (hasAnySpan && config.rows.some(r => r.kind === 'header')) {
    throw new Error('[paginator] table() cannot combine colSpan/rowSpan with a manually-authored `kind: "header"` row in the same table.')
  }
  // `cells` on a header row is only ever produced by TableGroupLevel.header() returning
  // TableCell[] (applyGroupingRows() resolves it there) — a hand-authored banner row always uses
  // `content`, so this can only fire on a row the caller wrote directly.
  if (config.rows.some(r => r.kind === 'header' && r.cells !== undefined)) {
    throw new Error('[paginator] table() a manually-authored `kind: "header"` row must use "content", not "cells" — "cells" is only produced by `TableGroupLevel.header()`.')
  }

  const columnsWithContent = config.columns.filter(c => c.content !== undefined)
  const useAutoHeader = columnsWithContent.length > 0
  if (useAutoHeader && columnsWithContent.length !== config.columns.length) {
    throw new Error('[paginator] table() either every column defines "content" (for the auto-generated header row) or none do — partial adoption is not allowed.')
  }
  if (useAutoHeader && config.headerRows !== undefined && config.headerRows > 0) {
    throw new Error('[paginator] table() cannot combine per-column "content" (auto header row) with an explicit "headerRows" — use one or the other.')
  }

  const manualHeaderRowCount = useAutoHeader ? 0 : (config.headerRows ?? 0)
  if (manualHeaderRowCount > config.rows.length) {
    throw new Error('[paginator] table() headerRows cannot exceed the number of rows')
  }

  config.rows.forEach((row, i) => {
    if (row.kind === 'header') return
    const isLiteralHeaderRow = !useAutoHeader && i < manualHeaderRowCount

    if (!isLiteralHeaderRow && hasGroups) {
      const groupCount = config.groups!.length
      if (row.groupValues === undefined || row.groupValues.length !== groupCount) {
        throw new Error(
          `[paginator] table() row ${i} needs "groupValues" with ${groupCount} entries (one per TableNode.groups level), got ${row.groupValues?.length ?? 'none'}`,
        )
      }
    }

    // Spanning rows are validated by resolveCellSpans() below instead (array position no longer
    // equals column index under implicit-flow authoring) — this strict, positional check only
    // continues to apply to the literal header-row prefix (spanning is never attempted there) and
    // to ordinary body rows in a non-spanning table (byte-for-byte unchanged from before this
    // feature existed).
    if (!isLiteralHeaderRow && hasAnySpan) return
    if (row.cells.length !== config.columns.length) {
      throw new Error(`[paginator] table() row ${i} has ${row.cells.length} cells, expected ${config.columns.length}`)
    }
    row.cells.forEach((cell, c) => {
      if (cell.content === undefined) {
        if (isLiteralHeaderRow) {
          throw new Error(`[paginator] table() header row ${i}, cell ${c} needs "content"`)
        }
        throw new Error(`[paginator] table() cell at column ${c} needs "content"`)
      }
    })
  })

  if (!hasGroups && !useAutoHeader && !hasAnySpan && !hasStripe) {
    return { type: 'table', ...config } // unchanged fast path — zero overhead for ordinary tables
  }

  const literalHeaderRows: TableRow[] = useAutoHeader
    ? [{ cells: config.columns.map(c => ({ content: c.content! })), background: config.headerBackground }]
    : config.rows.slice(0, manualHeaderRowCount)
  const bodyRows = useAutoHeader ? config.rows : config.rows.slice(manualHeaderRowCount)

  if (hasGroups && bodyRows.some(r => r.kind === 'header')) {
    throw new Error('[paginator] table() cannot combine manually-authored `kind: "header"` rows with column grouping (`groups`) in the same table.')
  }

  const spanResolvedBodyRows = hasAnySpan ? resolveCellSpans(bodyRows, config.columns.length) : bodyRows

  if (hasGroups) {
    validateGroupClusterConstancy(spanResolvedBodyRows, config.groups!.length)
  }

  const desugaredBodyRows = hasGroups ? applyGroupingRows(spanResolvedBodyRows, config.groups!, config.repeatGroupHeaders ?? true, config.columns.length) : spanResolvedBodyRows
  const headerRowCount = useAutoHeader ? 1 : manualHeaderRowCount
  const assembledRows = headerRowCount > 0 ? [...literalHeaderRows, ...desugaredBodyRows] : desugaredBodyRows
  const finalRows = hasStripe ? applyStripeRows(assembledRows, headerRowCount, config.stripe!) : assembledRows

  return {
    type: 'table',
    ...config,
    rows: finalRows,
    headerRows: headerRowCount,
  }
}

// Desugars `TableNode.stripe` into per-row `background` at build time — table-layout.ts never
// knows striping happened, same architecture `groups` already uses. Skips the literal header-row
// prefix (the first `headerRowCount` rows, whether hand-authored or auto-generated from
// column.content) and any column-grouping header/divider bar (`kind: 'header'`) — `even`/`odd`
// count sequentially through only the ordinary data rows that remain, and never override a row
// that already set its own `background`.
function applyStripeRows(rows: TableRow[], headerRowCount: number, stripe: { even?: string; odd?: string }): TableRow[] {
  let dataIndex = 0
  return rows.map((row, i) => {
    if (i < headerRowCount || row.kind === 'header') return row
    const background = row.background ?? (dataIndex % 2 === 0 ? stripe.even : stripe.odd)
    dataIndex++
    return background === row.background ? row : { ...row, background }
  })
}
