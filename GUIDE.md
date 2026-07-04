# Paginator — Architecture & API Guide

Declarative, print/PDF-style document layout and pagination engine. You author a document as a
tree of building blocks (page config with header/footer/margins, Group, Text, Separator,
PageBreak, Image), and the engine computes page breaks and exact pixel positions **purely
arithmetically** — never via DOM measurement (`getBoundingClientRect`/`offsetHeight`) — then
renders the result into real, isolated DOM. A separate opt-in layer adds hover/click/drag/drop
events over the same computed layout, intended for building an editor on top of this later.

This document is written for an AI (or human) picking up this codebase cold. It states the
load-bearing invariants explicitly rather than leaving them implicit in code, since several bugs
during development came from violating one of them without realizing it.

## Mental model in one paragraph

`paginate(doc: PageDef): PaginatedResult` is a **pure, synchronous** function: node tree in, a
list of pages (each a tree of `RenderedNode`s with fully-resolved page-relative pixel boxes) out.
No DOM is touched during this call except pretext's own detached `OffscreenCanvas` for text
measurement. `mount(result, host)` is a **dumb paint step**: it walks `PaginatedResult` and creates
absolutely-positioned DOM elements with inline styles inside a Shadow DOM root — it does no layout
math of its own. `attachInteractions(result, host)` is a **third, independent layer**: it builds
its own pure-data hit-test registry from the same `PaginatedResult` and translates native Pointer
Events into hover/click/drag/drop callbacks. These three functions can be called independently;
`attachInteractions` requires `mount` to have run first only because it needs to find the live page
`<div>` elements via `getBoundingClientRect()` to translate cursor coordinates.

## Core invariants (read before changing layout/pagination code)

1. **`paginate()` is synchronous and side-effect-free except for memoizing pretext's prepared-text
   handle onto `TextNode.__prepared`/`__resumeCursor`.** Nodes are treated as immutable per
   `paginate()` call — build a fresh tree for each call. Never make `paginate()` async; `image()`
   deliberately requires explicit `width`/`height`/`aspectRatio` specifically to preserve this
   (see "Images never auto-detect dimensions" below).
2. **`RenderedNode.box` is always fully resolved** — page-content-box-relative for body nodes,
   region-local for header/footer — by the time `paginate()` returns. No further coordinate
   translation is ever needed to place a node. This is achieved by `translateRendered()`
   (`src/core/geometry.ts`) being applied cumulatively at every level of group nesting and again
   once by the pagination cursor.
3. **Sibling boxes can never overlap.** `layoutRow`/`layoutColumn` place children by strictly
   accumulating position along the main axis (`x += r.width + between` / `y += r.height + between`),
   and a parent's box always contains the union of its children's boxes. This is why the
   interaction system's hit-testing needs no real tie-breaking logic — geometric descent has at
   most one candidate at each level in practice.
4. **DOM rendering is flat, not nested.** `src/render/shadow-dom.ts`'s `renderNode()` appends a
   group's own wrapper `<div>` (kept only for devtools parity) and then appends every child
   **as a sibling in the same container**, not as a DOM descendant of the group's div. Consequences:
   native DOM event bubbling does **not** reflect the authored tree's logical nesting (this is why
   `attachInteractions` does its own pure-data ancestor walk instead of relying on `event.target`
   bubbling), and cloning a single DOM element does **not** capture a group's full visual content
   (this is why `renderPreview()` re-renders from `RenderedNode` data instead of cloning DOM).
5. **Every element gets explicit inline styles only — no `<style>` tag, no class name, anywhere,**
   with exactly one narrow exception: `mount()` injects a single shadow-root-scoped `<style>`
   containing only an `@page` rule (page size + zero margin), because `@page` is a stylesheet-level
   at-rule with no inline-style equivalent — see "Printing" below. `BASE_ELEMENT_STYLE`
   (`src/render/reset.ts`) is applied first, then node-specific styles, via `Object.assign(el.style,
   ...)`. Combined with mounting inside a Shadow DOM root, this is what makes rendering immune to
   host-page CSS (Tailwind Preflight, aggressive resets, etc.) — verified by injecting `* {
   box-sizing: content-box !important; margin: 8px !important; font-size: 40px !important; }` into
   the host document and confirming zero visual change. The `@page` exception doesn't reopen that
   hole: it stays inside the shadow root and only ever sets page geometry, never anything a host
   stylesheet could use to reach into the document's own content.
6. **Images never auto-detect dimensions from the loaded asset.** `image()` throws unless given
   enough of `{width, height, aspectRatio}` to compute a box synchronously. Any mismatch between
   the computed box and the real image's shape is reconciled by the native `object-fit` CSS
   property on the rendered `<img>` — the browser does that work, no reimplementation needed.
7. **pretext requires `document.fonts.ready` before first use.** Always `await ready()` before
   calling `paginate()` when using custom web fonts, or measurement happens against fallback-font
   metrics.

## Quick start

```ts
import { definePage, group, text, separator, image, pageBreak, ready, paginate, mount } from './index.ts'

const doc = definePage(
  {
    size: 'Letter', // or 'A4' or { width, height } in px
    margins: { top: 56, right: 56, bottom: 56, left: 56 },
    headerGap: 16,
    footerGap: 16,
    header: () => text({ content: 'My Document', fontFamily: 'Arial', fontSize: 11, lineHeight: 14 }),
    footer: ({ pageNumber, totalPages }) =>
      text({ content: `Page ${pageNumber} of ${totalPages}`, fontFamily: 'Arial', fontSize: 10, lineHeight: 13, align: 'right' }),
  },
  group({ direction: 'column', gap: 16 }, [
    text({ content: 'Title', fontFamily: 'Arial', fontSize: 24, fontWeight: 700, lineHeight: 30 }),
    separator({ thickness: 1, color: '#ddd' }),
    text({ content: 'Body copy...', fontFamily: 'Georgia', fontSize: 13, lineHeight: 20 }),
    image({ src: '/logo.png', width: 200, height: 80, objectFit: 'contain' }),
  ]),
)

await ready()
const result = paginate(doc)
mount(result, document.getElementById('app')!)
```

## Public API reference (`src/index.ts`)

### Document authoring
| Export | Signature | Notes |
|---|---|---|
| `definePage` | `(config: Omit<PageDef,'body'>, body: Node) => PageDef` | Top-level document wrapper |
| `group` | `(config: Omit<GroupNode,'type'\|'children'>, children: Node[]) => GroupNode` | Row or column container |
| `text` | `(config: Omit<TextNode,'type'\|'lineHeight'> & { lineHeight?: number }) => TextNode` | `lineHeight` defaults to `round(fontSize * 1.2)` |
| `separator` | `(config?: Omit<SeparatorNode,'type'>) => SeparatorNode` | Thin rule, dual orientation (see below) |
| `pageBreak` | `() => PageBreakNode` | Forces a page break; zero-size marker |
| `image` | `(config: Omit<ImageNode,'type'>) => ImageNode` | **Throws** if neither `height` nor `aspectRatio` is given |
| `table` | `(config: Omit<TableNode,'type'>) => TableNode` | Fixed grid, not semantic HTML — see below. **Throws** on a row/column-count mismatch, `headerRows` exceeding the row count, every column marked `group`, a `totals()` callback returning the wrong cell count, partial adoption of `column.content` across the effective columns, or `column.content` combined with an explicit `headerRows` |
| `chart` | `(config: Omit<ChartNode,'type'>) => ChartNode` | SVG bar/line/pie/donut, discriminated by `chartKind`. **Throws** if neither `height` nor `aspectRatio` is given, if `categories`/`series` are missing (or a series' `data` length doesn't match `categories`) for `bar`/`line`, or if `slices` are missing (or a slice has a negative/non-finite `value`) for `pie`/`donut` |

### Pagination & rendering
| Export | Signature | Notes |
|---|---|---|
| `ready` | `() => Promise<void>` | Awaits `document.fonts.ready`; call before `paginate()` |
| `paginate` | `(doc: PageDef) => PaginatedResult` | Pure, synchronous |
| `mount` | `(result: PaginatedResult, host: HTMLElement) => void` | Creates/reuses an open Shadow DOM on `host`, replaces its content |
| `printDocument` | `(host: HTMLElement) => void` | Prints a mounted document with correct page size/margins — see "Printing" below. **Throws** if `host` hasn't been `mount()`-ed |
| `renderPreview` | `(rendered: RenderedNode) => HTMLElement` | Standalone, pixel-identical re-render of one subtree, re-based to (0,0) — for drag-preview ghosts |
| `setLocale`, `clearCache` | pass-through from `@chenglou/pretext` | Locale-sensitive line-breaking / cache management escape hatches |

### PDF export (see full section below)
| Export | Signature | Notes |
|---|---|---|
| `registerFont` | `(options: { family: string; url: string; weight?: number \| string; style?: 'normal' \| 'italic' }) => Promise<void>` | Fetches a font file, registers it for on-screen use AND later PDF embedding. Call before `paginate()` |
| `generatePdf` | `(result: PaginatedResult, metadata?: PdfMetadata) => Promise<Uint8Array>` | Real vector PDF from the same data `mount()` renders. Never throws on a missing font — warns once and falls back to Helvetica |
| `openPdfInNewTab` | `(bytes: Uint8Array) => void` | Opens PDF bytes in a new browser tab via an object URL |
| `showPdfDialog` | `(bytes: Uint8Array, options?: { title?: string }) => { close(): void }` | Shows a modal `<dialog>` with an `<iframe>` displaying the PDF |
| `normalizeFontWeight` | `(weight: number \| string \| undefined) => number` | `'bold'`/`'normal'`/`'bolder'`/`'lighter'`/numeric-string -> a definite CSS numeric weight |
| `listRegisteredFonts` | `() => RegisteredFont[]` | Inspects what's currently registered |

### Interaction (all opt-in, see full section below)
| Export | Signature | Notes |
|---|---|---|
| `attachInteractions` | `(result: PaginatedResult, host: HTMLElement, options?: AttachInteractionsOptions) => InteractionController` | Requires `mount()` to have run on `host` first |
| `buildHitRegistry` | `(result: PaginatedResult) => HitRegistry` | Pure data, no DOM; what `attachInteractions` builds internally |
| `hitTest` | `(registry, pageNumber, x, y) => InteractionTarget \| null` | Resolves via `interactive: true`, bubble-up |
| `hitTestDroppable` | `(registry, pageNumber, x, y, dragTypes?: string[]) => InteractionTarget \| null` | Resolves via `droppable: true` + `accepts` filter, bubble-up |
| `toTypeList` | `(value: string \| string[] \| undefined) => string[]` | Normalizes `dragType`/`accepts` shorthand |

## Node type reference

Every node type below also carries the shared `Interactive` fields: `interactive?`, `draggable?`,
`droppable?`, `dragType?: string | string[]`, `accepts?: string[]` — all `undefined`/off by
default. See the "Interaction system" section for their semantics.

### `PageDef`
| Field | Type | Notes |
|---|---|---|
| `size` | `'A4' \| 'Letter' \| { width, height }` | Presets in CSS px @96dpi: A4 794×1123, Letter 816×1056 |
| `margins` | `{ top, right, bottom, left }` | px |
| `header` / `footer` | `Node \| ((ctx: { pageNumber, totalPages }) => Node)` | See two-pass resolution below |
| `headerHeight` / `footerHeight` | `number?` | Explicit override; skips auto-measurement |
| `headerGap` / `footerGap` | `number?` | Default 0 |
| `body` | `Node` | Usually a column `group` |

### `GroupNode` (`type: 'group'`)
| Field | Type | Notes |
|---|---|---|
| `direction` | `'row' \| 'column'` | |
| `mainAlign` | `'start'\|'center'\|'end'\|'space-between'\|'space-around'` | Default `'start'` |
| `crossAlign` | `'start'\|'center'\|'end'\|'stretch'` | Default `'start'` |
| `gap` | `number?` | Default 0 |
| `flex` | `FlexSize?` | Only meaningful as a ROW child — see "Row flex sizing" below |
| `splitColumns` | `boolean?` | Only meaningful when `direction: 'row'` — independent per-column page splitting, off by default |
| `children` | `Node[]` | |

### `TextNode` (`type: 'text'`)
| Field | Type | Notes |
|---|---|---|
| `content` | `string` | |
| `fontFamily`, `fontSize` | `string`, `number` | Required |
| `fontWeight`, `fontStyle`, `color` | optional | `fontWeight` default 400, `color` default `#000000` |
| `align` | `'left'\|'center'\|'right'` | Default `'left'` — pretext has **no** alignment concept; this is computed per-line from `line.width` vs box width |
| `lineHeight` | `number` | px. Required by the type, but the `text()` builder fills a default |
| `letterSpacing`, `whiteSpace`, `wordBreak` | optional | Forwarded to pretext's `prepare()` |
| `flex` | `FlexSize?` | Only meaningful as a ROW child |

### `SeparatorNode` (`type: 'separator'`)
| Field | Type | Notes |
|---|---|---|
| `thickness` | `number?` | Default 1 |
| `color` | `string?` | Default `#000000` |
| `margin` | `number?` | Default 0 — reserved on each side along the parent's **main axis** |

Dual orientation, no explicit flag needed: renders as a horizontal rule (spans full cross width,
`thickness+2*margin` tall) as a column child; as a vertical divider (stretches to full row height,
`thickness+2*margin` wide) as a row child.

### `PageBreakNode` (`type: 'page-break'`)
No fields beyond `Interactive`. Zero-size, invisible. Only has an effect inside COLUMN-direction
structure; inert (renders nothing, forces nothing) as a row's column.

### `ImageNode` (`type: 'image'`)
| Field | Type | Notes |
|---|---|---|
| `src`, `alt` | `string`, `string?` | |
| `width`, `height` | `number?` | At least one of `{width & height}`, `{width & aspectRatio}`, `{height & aspectRatio}`, or `{aspectRatio alone}` required |
| `aspectRatio` | `number?` | `width / height` |
| `objectFit` | `'fill'\|'contain'\|'cover'\|'none'\|'scale-down'` | Default `'fill'`, maps directly to the CSS property |
| `flex` | `FlexSize?` | Only meaningful as a ROW child |

### `ChartNode` (`type: 'chart'`)
SVG bar/line/pie/donut charts, discriminated by `chartKind`, built by hand at render time
(`src/render/chart-render.ts`) with no charting library. Sizing mirrors `ImageNode` exactly: same
`height`/`aspectRatio` rule, resolved synchronously in `src/core/chart-layout.ts` before anything is
drawn (so its internal chrome — axis margins, legend band — uses fixed heuristic margins, never
measured text). Non-splittable, same as image.

| Field | Type | Notes |
|---|---|---|
| `chartKind` | `'bar' \| 'line' \| 'pie' \| 'donut'` | Discriminant — one node type covers all four |
| `width`, `height`, `aspectRatio` | `number?` | Same rule as `ImageNode`: needs `height` or `aspectRatio` |
| `categories` | `string[]?` | `bar`/`line` only — x-axis labels, one per data point in every series |
| `series` | `{ name?: string; data: number[]; color?: string; fill?: boolean \| { color?; opacity? } }[]?` | `bar`/`line` only — one or more series (grouped bars / multi-line); every `data` array must match `categories.length`. Each series' own `color` wins over `colors`/the default palette. `fill` (`line` only, default off) shades the area between that series' line and the baseline with a linear gradient — opaque at the line, fully transparent at the baseline — so whatever sits behind the chart stays partly visible near the bottom; `true` uses the series' own resolved color at the default opacity (0.25), an object overrides `color`/`opacity`. Purely per-series — some lines in a chart can be filled and others not. **Throws** if `fill.opacity` is outside `[0, 1]` |
| `orientation` | `'vertical' \| 'horizontal'?` | `bar`/`line` only. Default `'vertical'` (categories on the x-axis, values on the y-axis). `'horizontal'` swaps them: categories run top-to-bottom, values run left-to-right, bars grow rightward (or leftward below the baseline) — implemented as its own rendering path (`renderHorizontalCategoricalChart`/`drawHorizontalCategoricalChart`), mirroring the vertical one field-for-field rather than a single axis-agnostic function, same reasoning as `group-layout.ts`'s `layoutRow`/`layoutColumn` split |
| `barMode` | `'grouped' \| 'stacked'?` | `bar` only. `'grouped'` (default) places each category's series side by side; `'stacked'` stacks them into one bar per category — positive values above the zero baseline, negative below, each in series order, with the rounded "data-end" only on the outermost segment |
| `barSegmentGap` | `number?` | `barMode: 'stacked'` only. Gap (px) between consecutive stacked segments — the true baseline and outermost-tip edges are never inset. Default `0` (flush segments). **Throws** if negative |
| `lineCurve` | `'linear' \| 'monotone'?` | `line` only. Default `'linear'` (straight segments between points). `'monotone'` draws a cubic-Bezier curve through every point using monotone cubic (Fritsch–Carlson) interpolation — tangents are clamped so the curve never overshoots past a point's own value relative to its neighbors, unlike a naive Catmull-Rom spline. Applies to every series in the chart |
| `slices` | `{ label: string; value: number; color?: string }[]?` | `pie`/`donut` only. Each slice's own `color` wins over `colors`/the default palette. **Throws** if any `value` is negative/non-finite |
| `donutInnerRadiusRatio` | `number?` | `donut` only. Default `0.6`. **Throws** if set outside `[0, 1)` |
| `sliceGap` | `number?` | `pie`/`donut` only. Gap between slices, in degrees (converted internally to a constant pixel width evaluated at the outer radius — so the visible channel is the same width from the inner rim/apex to the outer rim, not an angular wedge that tapers to nothing at the center). Default `1.5`; `0` removes it. **Throws** if negative |
| `title` | `string \| { text: string; fontSize?; color? }` | Optional, centered above the chart |
| `axis` | `{ show?; gridlines?; tickCount?; formatTick?(v); tickFontSize?; categoryFontSize? }?` | `bar`/`line` only. Chrome only — ticks/gridlines/labels drawn on top of whatever domain `view` resolves; never affects the domain itself (see `view` below). `show` toggles ticks+gridlines+category labels together; `gridlines` independently toggles just the lines. Both default `true`. `tickFontSize`/`categoryFontSize` (px, default 11 each) size the y-axis numbers and x-axis labels independently — margins, label-thinning, and baseline offsets are all recomputed from whichever size you set, so neither clips or overlaps the plot |
| `view` | `{ domain?: 'zero' \| 'auto' \| { min?; max? }; padding?: number }?` | `bar`/`line` only. Controls the y-domain. `domain` omitted or `'zero'` (default): auto-computed, always spans `[min(0, dataMin), max(0, dataMax)]` (or the stacked-sum equivalent). `'auto'`: auto-computed but tight to the data's own `[dataMin, dataMax]` — NOT forced through zero — then widened by `padding` (fraction of that range, default `0.1`) on both ends, e.g. so the single lowest/highest bar isn't flush against the plot's own edge (which would draw it at zero height). An explicit `{ min?, max? }` object overrides either auto mode outright — set either or both bounds; an unset one stays auto-computed the `'zero'` way. If zero ends up outside the resolved domain, bars grow from the domain's own nearer edge instead of zero. **Throws** if the object form has `min >= max`, or if `padding` is negative |
| `legend` | `{ show?; position?: 'right'\|'bottom'; fontSize? }?` | Default: on for `pie`/`donut` and for `bar`/`line` with `series.length > 1`; off for a single series. `fontSize` (px, default 11) sizes legend entry labels — row height/band size scale with it |
| `colors` | `string[]?` | Categorical palette override, cycled by index; falls back to the built-in default palette |
| `flex` | `FlexSize?` | Only meaningful as a ROW child |

### `TableNode` (`type: 'table'`)
A fixed grid, not a semantically "correct" HTML table — no `thead` element, but `colSpan`/`rowSpan`
cell merging is supported; see "Cell spans" below.

| Field | Type | Notes |
|---|---|---|
| `columns` | `{ width?: FlexSize; background?: string; align?: CrossAlign; content?: Node }[]` | `width` uses the *same* fixed-px/flex-weight model as row-child sizing below. `content` — a header caption for this column; see "Column header captions" below. Always exactly what you authored — no other feature (grouping included) ever strips or reshapes this array |
| `rows` | `TableRow[]` — `{ kind?: 'cells'; cells: TableCell[]; groupValues?: string[]; background?: string; verticalAlign?: 'start'\|'center'\|'end' }` or `{ kind: 'header'; depth: number; content?: Node; cells?: TableCell[]; background?: string; repeat?: boolean }` | `cells.length` must equal `columns.length` for every non-header row (implicit-flow authoring changes this when spans are in play — see "Cell spans"). `groupValues` — see "Column grouping". The `header` variant is either a full-width single-`content` bar, or colSpan-aware, column-grid-aligned `cells` (exactly one of the two is set) — see "Column grouping" |
| `TableCell` | `{ content?: Node; colSpan?; rowSpan?; background?: string; align?: CrossAlign; verticalAlign?: 'start'\|'center'\|'end'; value?: string }` | `content` is an arbitrary `Node` — a cell can nest a `group`/`text`/`image`/another `table`, and is always required. `value` — optional convenience for `totals()` callbacks (see "Column grouping"), unrelated to bucketing; `colSpan`/`rowSpan` — see "Cell spans" |
| `groups` | `TableGroupLevel[]?` | Report-style row grouping levels, ordered outermost -> innermost — see "Column grouping" |
| `headerRows` | `number?` | Leading row count repeated at the top of every continuation page this table spans. Freely composable with `groups`; mutually exclusive with `column.content` (see "Column header captions") |
| `headerBackground` | `string?` | Background for the single auto-generated header row (from `column.content`). Ignored if no column defines `content`, or if you author header row(s) manually via `headerRows` instead (set `background` on that row directly) |
| `repeatHeaderRow` | `boolean?` | Default `true`. Whether the table's own `headerRows` prefix repeats on every continuation page, or appears only once at the very top |
| `repeatGroupHeaders` | `boolean?` | Default `true`. Table-wide default for `TableGroupLevel.repeat` on every grouping level that doesn't set its own — see "Column grouping" |
| `border` | `{ mode?: 'none'\|'all'\|'outer'\|'horizontal'\|'vertical'; thickness?; color? }?` | Omitted = no borders. `mode` defaults to `'all'` when the object is present. Rendered as single-thickness line segments, never a per-cell CSS border, to avoid doubled thickness at shared cell edges |
| `cellPadding` | `number?` | Default 0, applied identically on all 4 sides of every cell |
| `flex` | `FlexSize?` | Only meaningful as a ROW child |

Alignment precedence, resolved per cell: horizontal `cell.align ?? column.align ?? 'stretch'`;
vertical `cell.verticalAlign ?? row.verticalAlign ?? 'start'`. Background precedence:
`cell.background ?? row.background ?? column.background ?? undefined`, resolved once at layout
time (`table-layout.ts`) and baked into the `RenderedNode`, not re-derived at render time. Rows are
atomic (a row's content never splits mid-row) — the table itself splits **between** rows across a
page boundary, same "walk top-to-bottom, defer the rest" shape as a column group's split, just over
`rows` instead of `children`. Cells (and a group header bar's `content`) participate in the
interaction system's bubble-up hit-testing exactly like group children — see "Interaction system"
below.

#### Column grouping

Report-style row grouping with subtotals. **Entirely independent of `columns`** — a group never
marks, hides, or reshapes any column. `TableNode.groups: TableGroupLevel[]` declares the bucketing
levels (outermost first):
```ts
type TableGroupLevel = {
  header?: (value: string, rows: TableRow[]) => Node | TableCell[]   // defaults to a plain bold text label
  background?: string
  totals?: (rows: TableRow[]) => TableCell[]            // one cell per column, colSpan-aware — same implicit-flow tiling as an ordinary row
  repeat?: boolean                                      // default: TableNode.repeatGroupHeaders (itself default true)
}
```
Each `cells`-kind row supplies its bucketing value(s) via `TableRow.groupValues: string[]` — one
entry per level, same order as `groups`, required (with the right length) whenever `groups` is set.
This is unrelated to `cells`/`columns` entirely: a row's `groupValues` and its `cells` are two
independent things living side by side on the same row object. `rowGroup(groupValues, rows)` is a
pure authoring convenience for a rowSpan cluster's rows, which must all share identical
`groupValues` (see below) — it just spreads the same array onto every row you pass it instead of
repeating it by hand; it changes nothing about what `table()` validates. Rows sharing a value at a given
level get bucketed into one group, rendered as a full-width header bar (a `kind: 'header'` row —
see above) at that point in the flow. Multiple levels nest left-to-right in `groups` array order —
independent of any column's left-to-right position, since groups don't reference columns at all.
`totals`, if set, appends one more row at the end of that group aggregating across **every** row in
it, including rows contributed by nested subgroups beneath it — safe to call `totals` independently
at multiple nesting levels without double-counting, since each level's `rows` are exactly that
group's own partition, never re-filtered as recursion descends. If you also want a column that
*shows* a row's group value, just author one — an ordinary column like any other, populated from
whatever the row's real value is; there's no special coupling to set up for that.

A `totals()` row is resolved through the same `resolveCellSpans()` implicit-flow tiling an ordinary
body row gets (called once, on a synthetic one-row array) — so a totals row can use `colSpan` too,
e.g. a label spanning two columns followed by a figure in the last one, instead of needing a blank
filler cell per skipped column. `rowSpan` on a totals cell has nothing to span into (a totals row is
always exactly one physical row) and surfaces as the same "extends past the last row" throw
`resolveCellSpans()` already gives any dangling `rowSpan`.

This is **entirely desugared at `table()` build time** (`applyGroupingRows()` in `nodes.ts`) — the
`TableNode` that actually exists at runtime has no `groups` left, and its `rows` are already a plain,
flat mix of ordinary `cells` rows and synthesized `header` bars, each carrying its own
already-resolved `repeat` flag baked in at desugar time. `table-layout.ts`, `geometry.ts`,
`shadow-dom.ts`, and `hit-registry.ts` never know grouping happened — and since grouping never
touches columns or cells, this file needs **zero changes for grouping**, unlike the header-repeat
mechanism below which does live partly in `table-layout.ts`. They only ever handle the two
`TableRow` kinds generically, reading `header.repeat` directly with no awareness of
`TableGroupLevel` or which level produced it.

Grouping is a **global regroup by value**, not a contiguous-run merge: every row sharing a value
buckets together regardless of where it sits in the authored row order (group order follows each
value's first appearance).

**Freely combinable with `colSpan`/`rowSpan` in the same table** (see "Cell spans" below) — since
grouping never touches `columns`/`cells`, there's no positional conflict with implicit-flow span
authoring. The one restriction: **a rowSpan cluster's rows must all share identical `groupValues`**
(every level) — bucketing only ever filters rows into groups, never reorders them, so if a cluster's
physical rows disagreed on a group value, satisfying both would require interleaving a header/totals
row into the middle of an atomic, non-splittable cluster. `table()` throws at build time if a
cluster's rows disagree.

**`header()` can return `TableCell[]` instead of a `Node`** for a colSpan-aware, column-grid-aligned
header bar — same implicit-flow tiling `totals()` gets (one cell per column, `colSpan` allowed,
`rowSpan` rejected since a header is always exactly one physical row, resolved via
`resolveCellSpans()` the same way). Unlike the `Node` form, a `TableCell[]` header is **not**
indented by nesting depth — its cells align with the real column grid instead, the same way a
`totals()` row already does, so indenting them would misalign against the data rows below. A
manually-authored `kind: 'header'` banner row must still use `content` — `cells` is only ever
produced by `TableGroupLevel.header()` (`table()` throws otherwise).

**Group headers repeat across a page split by default** (`repeat: true`), independently at every
nesting level — if a group's own rows span a page boundary, its header bar re-appears at the top of
the continuation page, same as the table's own column-caption header already does. Override per
level via `TableGroupLevel.repeat`, or set a new table-wide default via `TableNode.repeatGroupHeaders`
for every level that doesn't specify its own. This is implemented entirely inside
`tableMeasurer.split()` (`table-layout.ts`) — as it walks rows deciding what fits on the current
page, it maintains a small depth-indexed stack of "currently active" header rows (`row.depth` closes
any same-or-shallower entry already on the stack, mirroring the nesting `applyGroupingRows()`
already produces); whichever of those are still `repeat !== false` **and** still have at least one of
their own rows left after the cut (a header whose own `totals` row happened to be the very last thing
that fit is fully finished, not "in progress" — it does not re-appear even if `repeat` is on) get
prepended to the continuation's rows, ahead of whatever comes next. This composes with `headerRows`:
the table's own header prefix (governed independently by `repeatHeaderRow`) and any repeated group
headers can both be present at the top of a continuation page. Inner vertical border lines correctly
skip past a header bar's full width (same interval-subtraction machinery `renderTableBorders()` in
`shadow-dom.ts` already uses for colSpan/rowSpan cells — a header row's box is exactly
`[tableLeft, tableRight]`, so it "straddles" every inner vertical line by construction). `kind:
'header'` rows are also directly authorable by hand, independent of automatic
column grouping — a plain section-divider banner in any table (with its own `repeat`, default
`true`) — but not mixable with `groups` in the same table's data rows (`table()` throws if a `kind:
'header'` row appears among the rows that would otherwise get bucketed).

#### Column header captions

A column's header caption lives directly on the column definition, not as a separate hand-authored
row kept in sync with column order by hand:
```ts
{ width: 3, content: text({ content: 'Item', fontFamily: 'Arial', fontSize: 11, fontWeight: 700, lineHeight: 14 }) }
```
If **any** column defines `content`, `table()` auto-builds a single header row from every column's
`content` and sets `headerRows` to `1` automatically — either **all** columns define `content` or
**none** do (partial adoption throws). This is mutually exclusive with manually setting `headerRows`
yourself (`table()` throws if both are used) — the manual-row mechanism (a literal row at the front
of `rows`, one cell per column) remains fully available for anything the shorthand doesn't cover,
e.g. a multi-row header. Either way, the resulting header row repeats at the top of every continuation
page exactly like any other `headerRows` prefix — this is genuinely the same mechanism, just with
the row itself derived instead of hand-written — and can be turned off via `repeatHeaderRow: false`
to show it only once at the very top instead. `headerBackground` sets the auto-generated row's
background (ignored for a manually-authored header row — give that row its own `background` field
directly instead).

#### Cell spans

`colSpan`/`rowSpan` use **implicit HTML-table-like flow**: a row's `cells` array lists only the
cells that *start* in that row, left-to-right — `table()` figures out which column each one lands
in by skipping whatever's still occupied by an earlier row's `rowSpan`, exactly like a real
`<table>`. There's no explicit column-index field on a cell.
```ts
rows: [
  {
    cells: [
      { rowSpan: 2, content: text({ content: 'x2', ... }) },
      { colSpan: 2, content: text({ content: 'Espresso', ... }) },
    ],
  },
  {
    // Column 0 is skipped automatically — occupied by the rowSpan cell above.
    cells: [
      { content: text({ content: 'Large, oat milk', ... }) },
      { content: text({ content: '$4.50', ... }) },
    ],
  },
]
```
This is resolved once at `table()` build time (`resolveCellSpans()` in `nodes.ts`), an occupancy-grid
walk that bakes each cell's resolved starting column onto it as `__resolvedCol` (`@internal`) and
marks any row that a `rowSpan` still carries into the next row as `__atomicWithNext` (`@internal`) —
`table-layout.ts`, `geometry.ts`, `shadow-dom.ts`, and `hit-registry.ts` never see `colSpan`/`rowSpan`
themselves, only the already-resolved fields. `table()` throws for a non-positive-integer span, a
span that would run past the last column, a row that leaves a genuinely unoccupied gap, or a
`rowSpan` that would run past the table's last row.

**A rowSpan cluster is atomic for pagination** — extending the existing "a row never splits mid-row"
rule, a group of physical rows linked by a `rowSpan` can never be split across a page boundary; if
the whole cluster doesn't fit in the remaining space, all of it defers to the next page together.

**Freely combinable with column grouping** (`TableNode.groups`) — see "Column grouping" above for the
one narrow restriction (a rowSpan cluster's rows must agree on `groupValues`). **Mutually exclusive**
with manually-authored `kind: 'header'` rows — `table()` throws if a table combines `colSpan`/
`rowSpan` usage with those.

**Column align/background precedence for a spanning cell** resolves against the *starting* column
only (`columns[cell.__resolvedCol]`) — the column(s) it spans over past that point are ignored for
this purpose, same as most spreadsheet/table tooling.

Row-height distribution when a `rowSpan` cell's content is taller than the rows it spans naturally
sum to: the entire deficit is added to the **last** row in the span, not distributed proportionally
— see Known Limitations.

## Row flex sizing (`FlexSize = number | \`${number}px\``)

A ROW group's direct children are sized by a two-pass model, same mechanics as CSS `flex-grow`:
1. Fixed-size children (any child with `flex: 'Npx'`, plus separators, which are always
   fixed at `thickness + 2*margin`) claim their exact width first.
2. Remaining width is divided among flexible children (`flex: N` or unset, which defaults to
   weight `1`) proportional to their weight.

`mainAlign` (`space-between` etc.) only has an effect when **no** child is flexible — flexible
children already consume all remaining space by construction, exactly like CSS (`flex-grow` eats
free space before `justify-content` ever sees any).

Column children never use `flex` for width — their cross-axis width comes from `crossAlign`
(`'stretch'` = full column width, otherwise shrink-to-fit via pretext's `measureNaturalWidth`). A
nested group's *own* `crossAlign: 'stretch'` is honored by its shrink-wrapping ancestor too — a
column whose `crossAlign` is `'stretch'` is treated the same as a row with a flexible child (see
`childCrossWidthInColumn` in `group-layout.ts`): it's handed the full width being offered rather
than shrink-wrapped to its content, so its own children can actually fill it. Without that, a
`crossAlign: 'stretch'` column nested inside a shrink-wrapping ancestor would get boxed to its
content's natural width one level up, making the inner `stretch` inert — most visibly as a
single short text child (e.g. a heading) whose `align: 'center'` silently does nothing because
its box is already exactly as wide as the text.
Column children's **height** is always intrinsic/content-driven, never flex-based — pagination
depends on that.

## Pagination algorithm (`src/core/paginate.ts`, `src/core/group-layout.ts`)

Single recursive function `paginateNode(node, width, ctx)` handles every case uniformly:

```
1. Does node fit fully in remaining page height? → place it, done.
   (Guarded by subtreeHasPageBreak() — a break nested inside otherwise-fitting content
    still forces a page cut, not silently absorbed by this fast path.)
2. Is node NOT splittable (Separator, Image, row Group without splitColumns, PageBreak)?
   → if page is still empty, render anyway (overflow, console.warn) — else start a new
     page and retry the whole node there.
3. Is node splittable (Text, column Group, or row Group WITH splitColumns)?
   → split it: place the portion that fits, start a new page, recurse on the `rest`
     continuation. If ZERO content fits (orphan), same empty-page overflow-or-retry logic as (2).
```

- **Text splitting** streams through pretext's `layoutNextLine(prepared, cursor, width)` cursor
  mechanism — the exact mechanism pretext's own README describes for cross-boundary text flow.
  `measureHeight`/`layout`/`split` all funnel through one shared `streamLines()` helper
  (`src/core/measure-text.ts`) so there's exactly one code path walking the cursor.
- **Column group splitting** (`columnGroupSplit` in `group-layout.ts`) walks children top-to-bottom
  via the same `layoutColumn()` used for full layout (single source of truth); the first child that
  doesn't fully fit is recursively split if splittable, else deferred whole to `rest`.
- **Row group splitting** (`splitColumns: true` only) is **independent per column**: each column
  asks separately how much of itself fits in the same `availableHeight`. A column that finishes
  early gets a same-width, zero-height placeholder (`emptyContinuationFor`) in its slot on the
  continuation page so the grid doesn't drift out of alignment with siblings still flowing.
  `crossAlign` is **not honored** for split rows (always top-aligned per page) — no coherent
  meaning once columns consume different heights per page.
- **Two-pass header/footer**: header/footer height is measured once (pass 0, placeholder
  `{pageNumber:1, totalPages:1}` context, or an explicit `headerHeight`/`footerHeight` override),
  used to compute `contentBoxHeight` for the *entire* pagination pass (pass 1, which determines
  `totalPages`), then header/footer content is cheaply re-rendered per page with the real
  `{pageNumber, totalPages}` (pass 2, no re-pagination). Constraint: header/footer height must
  never depend on `totalPages`, only the rendered *text* may reference it.
- **Page break** (`pageBreak()`): a leading/redundant break (nothing placed on the current page
  yet) is silently no-op'd rather than producing a blank page. `subtreeHasPageBreak()` recurses
  only into COLUMN-direction groups (a break nested inside a row has no effect and isn't searched
  for).
- **EPSILON = 0.01** tolerance on all "does it fit" float comparisons throughout.

## CSS isolation (`src/render/shadow-dom.ts`, `src/render/reset.ts`)

- `mount()`: `host.shadowRoot ?? host.attachShadow({mode:'open'})`, `root.replaceChildren()` on
  every call (safe to call repeatedly, e.g. after re-pagination).
- One absolutely-positioned DOM element per `RenderedNode` (text box + one child div per line;
  separator div; real `<img>`; group wrapper div for devtools parity only) — always flat against
  the page container, never nested `position:relative` wrappers (see invariant #4).
- `BASE_ELEMENT_STYLE = { boxSizing:'border-box', margin:'0', padding:'0', border:'0 none',
  position:'absolute' }` applied first, node-specific styles applied after, always via
  `Object.assign(el.style, ...)` — never a class, never a stylesheet.
- Each page container: `position:relative; overflow:hidden; width/height: {pageSize}px` (always
  fixed px, matching physical page size), tagged `data-page-number` for `attachInteractions` to
  find it.
- Font loading is the developer's responsibility — the engine measures whatever font string it's
  given and assumes it's loaded (`ready()` only awaits `document.fonts.ready`). `@font-face` fonts
  registered at the host document level are visible inside shadow roots (standard browser
  behavior — `document.fonts` is document-global).

## Printing

Call `printDocument(host)` — the same `host` element passed to `mount()` — instead of reaching for
`window.print()` yourself:

```ts
mount(result, host)
printButton.addEventListener('click', () => printDocument(host))
```

`printDocument()` is a thin, validated wrapper (`throws` if `host` was never `mount()`-ed); all of
the actual print behavior is wired up by `mount()` itself, live, so it fires correctly regardless of
*how* printing gets triggered — the button above, the browser's own Ctrl/Cmd+P, or a print icon in
the OS UI:

- **`@page` rule** (the one `<style>`-tag exception to invariant #5, injected fresh on every
  `mount()` call): `size: {pageSize.width}px {pageSize.height}px; margin: 0`. `pageSize` is already
  in physical px at the same 96dpi the whole engine assumes (`page-sizes.ts`), so the printed page
  is pixel-for-pixel the same size as the on-screen one, and `margin: 0` stops the browser's own
  default print margin from pushing content in from the physical edge.
- **Screen-only chrome stripped during print**: the wrapper `<div>` `mount()` creates has 24px
  padding/gap and a gray background purely so pages look like separate sheets on screen; each page
  also gets a drop shadow. None of that has any logical-page meaning to the browser's print
  engine — left in place, it just accumulates (one padding, N−1 gaps) until the drift pushes
  trailing content onto an extra, mostly-blank physical page. `mount()` listens for
  `matchMedia('print')` `change` plus `beforeprint`/`afterprint` (used together for cross-browser
  reliability — real-world print-trigger behavior isn't perfectly consistent) and zeroes the
  padding/gap/background and shadows for the duration of the print, restoring them after. Screen
  presentation is untouched either way.
- **`break-after: page`** (plus the legacy `page-break-after: always` for older engines) is set
  unconditionally on every page's container except the last — these are plain CSS fragmentation
  properties, inert outside paged/print or multicol contexts, so they cost nothing on screen. This
  is what forces the physical page cut to land exactly at each logical page boundary rather than
  relying on the zeroed spacing to divide evenly on its own.
- Net effect: an *N*-logical-page document prints as exactly *N* physical pages, each starting flush
  with the physical page edge, matching the on-screen layout exactly — verified against a real
  `page.pdf()` render, not just print-media emulation.

## PDF export (`src/render/pdf-render.ts`, `src/render/font-registry.ts`, `src/render/pdf-view.ts`)

A second, independent paint step over the same `PaginatedResult`/`RenderedNode` data `mount()` already
consumes — same relationship `renderPreview()` has to `mount()`. Produces a real vector PDF via
[pdfkit](https://pdfkit.org): selectable/searchable text, not a screenshot. `generatePdf(result,
metadata?)` needs no DOM (beyond an `OffscreenCanvas`/`<img>` for font metrics and image rasterization)
and no arguments beyond what `mount()` itself needs — `PaginatedResult` is fully self-describing.
Runs entirely client-side: pdfkit is Node-oriented (streams/Buffers) upstream, but its distributed
`js/pdfkit.standalone.js` build is a self-contained Browserify bundle (Standard-14 AFM font metrics
inlined as string literals, `fs`/`stream`/`zlib` all shimmed INSIDE the bundle) — no Node-polyfill
bundler plugin needed to import it in Vite. The resulting `PDFDocument` is a push-stream; bytes are
collected by hand from its `'data'`/`'end'` events rather than via pdfkit's usual `blob-stream` browser
companion, since `blob-stream` itself calls the bare Node builtins `stream`/`util` at its own module
scope (not pre-bundled the way `pdfkit.standalone.js` is) — Vite can only externalize those to an empty
`{}` module, which crashes at runtime the moment `blob-stream`'s constructor calls `stream.Writable`.

**Why fonts need a registry.** Text layout (line breaks, `line.width`) was decided once by pretext
measuring against whatever font FILE the browser's canvas resolved for a `fontFamily` string (see
invariant #7 and `measure-text.ts`). For the PDF's embedded vector glyphs to reproduce identical line
breaks, the PDF must embed that literal file — not just a font that "looks like" the CSS family name.
`registerFont({ family, url, weight?, style? })` fetches a font file once and serves both consumers
from the one byte array: it registers a `FontFace` via `document.fonts.add()` + `.load()` (so canvas
measurement AND on-screen DOM rendering use this exact file, same guarantee `ready()` already
documents for `document.fonts.ready`), and retains the raw bytes for `generatePdf()` to embed
identically later via pdfkit's bundled fontkit v2. Must resolve before `paginate()` is called with text
using that family/weight/style. `.ttf`/`.otf`/`.woff`/`.woff2` are all accepted — fontkit v2 decodes all
four to real sfnt glyph data before embedding (verified: registering a `.woff2` file produces a valid,
correctly-rendering PDF, checked against poppler's strict parser as well as Chromium's own viewer).

**Missing-font behavior is warn-and-fallback, not throw.** If a `TextNode`'s `fontFamily`/`fontWeight`/
`fontStyle` was never registered, `generatePdf()` substitutes a Helvetica standard font (by weight/
style, via pdfkit's Standard-14 name strings — no embedding step needed) and logs one `console.warn`
per distinct missing family/weight/style (deduped per call) — generation always succeeds. The
tradeoff: the substitute's glyph widths differ from what pretext actually measured, so that text's
exact fit/alignment in the PDF can visually drift from the preview, even though the *line breaks
themselves* were already fixed by pagination and don't change. Register every font actually used for
guaranteed fidelity.

**Coordinate system.** `PaginatedResult`'s px values (96dpi, top-left origin, y-down — same as DOM)
convert to PDF points (72dpi, top-left origin, y-down — pdfkit applies a `1 0 0 -1 0 pageHeight` CTM
flip once per page internally, so its coordinate space already matches the DOM/px model) via one
uniform `PX_TO_PT = 0.75` factor (96/72) applied only at the final leaf draw call
(`toPdfRect`/`chartToPagePoint`) — no y-flip math anywhere in this file. Traversal itself accumulates
origins in px exactly like `shadow-dom.ts`'s `renderNode()`, so `pdf-render.ts`'s recursive shape is a
straight port of that file's, swapping `container.appendChild(styledDiv(...))` for pdfkit draw calls.
A4 794×1123px × 0.75 ≈ 595.5×842.25pt, matching the standard PDF A4 size — confirms the scale factor is
exact, not approximate.

**Text baseline.** pretext's `line.y = i * lineHeight` (`positionLines()`, `measure-text.ts`) is the
TOP of each line's box, not a baseline. The actual PDF baseline is derived from the font's own ascent/
descent, approximating the CSS half-leading algorithm browsers use to lay a line box out around a
font's own metrics: `halfLeading = (lineHeight - (ascent+descent)) / 2`, `baselineFromTop = halfLeading
+ ascent`. Ascent/descent come from the BROWSER's own canvas (`measureFontMetricsPx()` in
`pdf-render.ts`, via `CanvasRenderingContext2D.measureText().fontBoundingBoxAscent/Descent` on the
exact same font CSS string `measure-text.ts` uses) rather than the embedded font object's own metrics,
tying baseline positioning to the same measurement engine pretext itself already trusts for width.
Still best-effort, not a formal guarantee (browsers and canvas's own metrics can disagree by a fraction
of a pixel), same tier as `chart-render.ts`'s `estimateTextWidth` approximation. Every `.text()` call
passes `baseline: 0` — pdfkit otherwise treats its `y` argument as the TOP of the text box (offsetting
down by the font's own ascender internally, like a word processor), and `baseline: 0` (pdfkit's
"alphabetic" baseline, zero offset) is what makes `y` mean the exact baseline this function already
computed instead. `lineBreak: false` is equally load-bearing on every call — without it, pdfkit
defaults `options.width` to the remaining page width and silently re-wraps the string through its own
line-breaking engine, discarding pretext's already-computed line breaks. `letterSpacing`, when set, is
passed straight through as pdfkit's native `characterSpacing` option (a single `.text()` call, not
glyph-by-glyph).

**Ligatures are enabled by default** — fontkit v2 (pdfkit's bundled font engine) does not reproduce the
GSUB shaping bug the previous pdf-lib/`@pdf-lib/fontkit` backend had (substituting a ligature, e.g.
"fi"/"fl" -> one glyph, used to leave a stray placeholder glyph carrying its original component's
advance width — visibly broken spacing like "refl ow" instead of "reflow"). Verified by rendering
ligature-prone words ("reflow", "office", "waffle") in both Inter and Source Serif 4 (the two fonts
that reproduced the old bug) and visually confirming proper joined ligature glyphs with no stray gap.
`.text()`'s `features` option (fontkit-style GSUB toggle, e.g. `{ liga: false }`) remains available as
an escape hatch if a font-specific regression ever surfaces, but nothing disables ligatures by default
anymore. Neither this nor `characterSpacing` applies OpenType GPOS kerning the way the browser's canvas
does, so a font with strong kerning pairs can still show a small cumulative spacing drift within a line
even though the line's own box/width/breaks match exactly.

**Fonts are subsetted by default** — pdfkit always calls `font.createSubset()` before embedding (no
`subset: false` escape hatch exists or is needed), unlike the previous backend, which had to force
`subset: false` unconditionally because `@pdf-lib/fontkit`'s TTF subsetter had a reproducible
`RangeError` bug on some font/glyph combinations. Embedding only the glyphs actually used produces
meaningfully smaller PDFs than the old full-font-program embed — confirmed via poppler's `pdffonts`,
which reports every custom-registered font as subsetted (`sub: yes`, with the standard 6-letter PDF
subset-tag prefix on its PostScript name).

**Images.** pdfkit only natively decodes PNG/JPEG (same constraint pdf-lib had) and its `fit`/`cover`
sizing options don't crop or support a source-rect — no native `object-fit` equivalent. Every
`ImageNode` (any `src` format, any `objectFit` value) is loaded via a plain `<img>` element — the same
pipeline every on-screen `<img src=...>` in this library already relies on (deliberately NOT
`fetch()` + `createImageBitmap()`, which has proven unreliable decoding SVG sources in practice, even a
well-formed self-contained SVG with explicit `width`/`height` — throws `InvalidStateError`) — then
drawn onto an offscreen canvas sized to the resolved box **times `RASTER_SCALE` (2)**, with the CSS
object-fit crop/letterbox math applied manually at that scaled size, then re-exported as PNG and
embedded (via a `data:image/png;base64,...` URI, the one non-Buffer input pdfkit's image loader accepts
in-browser — a plain `Uint8Array` fails its internal `Buffer.isBuffer()` check) at the box's ORIGINAL
(unscaled) point size — one code path for every format/fit combination, cached per `(src, objectFit,
box size)` so a repeated header/footer image rasterizes and embeds once per document, not once per
page. The oversample exists because rasterizing at exactly the box's own 96dpi px size looks fine on
screen but is visibly soft once zoomed or printed — a PDF viewer/printer has no "extra" pixels beyond
what was captured; embedding more pixels than the display size and letting the viewer/printer
downsample is what makes this sharp rather than just bigger. `RASTER_SCALE` was lowered from 3x
(≈288dpi, near print quality) to 2x (≈192dpi) after large photos at 3x made some PDF viewers visibly
laggy to scroll/zoom — every embedded image is losslessly PNG-encoded (no JPEG transcoding), so pixel
count drives both file size and viewer performance directly; 2x quarters the pixel count against the
3x baseline (confirmed via `pdfimages -list`: a 2112×1584 banner shrank from 625KB to a 1408×1056/355KB
image) for a meaningfully lighter, more responsive PDF, at the cost of print-grade sharpness. Runs
entirely at generation time via a detached canvas, never inside `paginate()`, so it doesn't touch
invariant #1.

**Charts** are redrawn using `chart-render.ts`'s own pure geometry/color helpers (`barPath`,
`pieSlicePath`, `donutSlicePath`, `resolveColor`, `niceTickValues`, `estimateTextWidth`, etc. — all
exported from that file specifically for this reuse), only swapping SVG-element creation for pdfkit
draw calls (`.moveTo/.lineTo/.stroke` for lines, `.circle().fill()` for markers, `.path(d).fill()` for
bars/pie/donut slices). Unlike pdf-lib's `drawSvgPath()` (which flipped the SVG-vs-PDF y-axis
internally), pdfkit's `.path(d)` takes an SVG path string literally in whatever coordinate space is
currently active, with no coordinate reinterpretation of its own — confirmed empirically by inspecting
a generated PDF's raw content stream. So `chart-render.ts`'s `cx/cy/r/a0/a1`-based path strings (raw
px, anchored at the chart's own local origin) are fed to it completely unchanged, rounded bar corners
included, wrapped in a `save()`/`translate(originPt)`/`scale(PX_TO_PT)`/`restore()` content-matrix push
rather than any per-coordinate math — deliberately, since hand-rewriting the numbers inside an SVG path
string would be one misplaced digit away from corrupting an arc command's `0`/`1` flag fields. Chart
text deliberately never goes through the font registry — `chart-render.ts` already documents using a
fixed heuristic text-width estimate rather than real measurement, so it never claimed font-exact
fidelity to the document's own registered fonts; the two shared Helvetica Standard-14 names
`generatePdf()` uses for the missing-font fallback are reused here for free.

**Viewing helpers** (`src/render/pdf-view.ts`) are deliberately decoupled from `generatePdf`/
`PaginatedResult` entirely — same data/paint split as `paginate()`/`mount()` — so either works with PDF
bytes from any source. `openPdfInNewTab(bytes)` opens a new tab via an object URL it never revokes (the
tab needs it for its own lifetime, with no reliable close signal available here — the same tradeoff
common blob-URL download patterns accept). `showPdfDialog(bytes, options?)` shows a native `<dialog>`
with an `<iframe>`, in the light DOM like the demo's Print button (page chrome, not paginated content
— invariant #5 doesn't apply), and revokes its object URL on close.

## Interaction system (`src/interaction/`)

Everything here is **opt-in and off by default** — a document with no `interactive`/`draggable`/
`droppable` flags set produces zero interaction events, at zero runtime cost beyond building the
hit registry.

### Flags (all on the shared `Interactive` type, every node type)
| Flag | Gates | Notes |
|---|---|---|
| `interactive?: boolean` | hover, click, being a drag source | Off by default. Not inherited. |
| `draggable?: boolean` | starting a drag | Requires `interactive: true` too — interactive-only nodes still hover/click but never arm a drag |
| `droppable?: boolean` | being a valid drop landing zone | Fully independent of `interactive`/`draggable` — a plain non-interactive container can be a drop zone |
| `dragType?: string \| string[]` | which `accepts` lists this drag matches | Only meaningful with `draggable: true`. Unset = wildcard, matches any zone regardless of that zone's `accepts` |
| `accepts?: string[]` | which drag types this zone matches | Only meaningful with `droppable: true`. Unset = accepts anything, including untyped drags |

### Bubble-up resolution — the core mechanism
`hitTest()`/`hitTestDroppable()` (`src/interaction/hit-registry.ts`) find the deepest geometric
match at a point, then walk **from that deepest entry back up toward the root**, returning the
first node satisfying the relevant predicate (`interactive === true`, or
`droppable === true && typeMatches(dragTypes, accepts)`). Consequences:
- Clicking a plain (non-interactive) child inside an `interactive: true` group resolves to the
  group, with the group's own box — not the child's.
- If **both** a group and one of its descendants are interactive, the descendant wins (more
  specific match, since the search starts from the deepest point and stops at the first hit).
- A drop landing on a non-droppable or type-mismatched descendant keeps bubbling up until it finds
  a droppable-and-type-matching ancestor, or returns `null`.
- **Table cells delegate the same way group children do**: `buildHitRegistry()`'s `flatten()`
  recurses into a table's cells exactly like it recurses into a group's children, so a cell
  wrapped in `group({interactive: true, draggable: true}, [...])` becomes its own independent
  hover/click/drag/drop target — resolved before the table itself is ever considered, with zero
  table-specific interaction API. A plain (non-interactive) cell's click bubbles up through the
  table the same way a plain group child's does.

### Events (`InteractionEventMap`, via `controller.on(type, handler)`)
| Event | Fires when | Key fields beyond `target`/`sourceEvent` |
|---|---|---|
| `hover` | resolved target *changes* (discrete, not per-pixel) | `pointer: PagePoint` |
| `hoverend` | pointer leaves the previously-hovered target, or leaves the host entirely | — |
| `click` | plain click, suppressed if it followed a real drag | `pointer: PagePoint` |
| `dragstart` | pointer moves ≥ `dragThreshold` (default 4px) after down on a draggable target | `start: PagePoint`, `overDropTarget: InteractionTarget \| null` (resolved at the start position) |
| `drag` | every pointermove during an active drag | `start`, `current`, `delta: {dx,dy}`, `overDropTarget` (**live**, re-resolved every move — for valid/invalid drop-zone highlighting) |
| `dragend` | pointerup or pointercancel after a real drag | `delta`, `cancelled: boolean` |
| `drop` | only on an **uncancelled** release of a real drag | `dropTarget: InteractionTarget \| null` (final resolution, filtered by `dragType`/`accepts` same as `overDropTarget`) |

`InteractionTarget = { node, box, pageNumber, region, ancestors: {node,box}[], rendered:
RenderedNode }`. The `rendered` field is what makes `renderPreview(target.rendered)` possible —
see invariant #4 for why a raw DOM element reference wouldn't work here.

### Mechanics worth knowing
- Listeners attach to `host` (the light-DOM element), not the shadow root — needed for
  `pointerleave` to have real geometry, and shadow-boundary retargeting means `event.target` from
  outside listeners collapses to `host` anyway (irrelevant here since resolution is entirely
  coordinate-based via `clientX/clientY` + `getBoundingClientRect()`, never `event.target`-based).
- `<img>` elements are natively HTML5-draggable; a `dragstart` listener calls `preventDefault()`
  to suppress the browser's own ghost-image drag running alongside the custom one.
- Text under any `interactive && draggable` node (itself or **any** descendant, regardless of that
  descendant's own flags) gets `user-select: none` (`shadow-dom.ts`'s `renderNode` threads a
  `draggableAncestor` boolean down through recursion) — otherwise starting a drag by pressing on a
  bubbling-up plain child would also trigger native text selection.
- `resolvePagePos()` loops all page elements calling `getBoundingClientRect()` per relevant pointer
  event — fine at realistic page counts; flagged as the first thing to optimize (cache +
  `ResizeObserver`) if a very long document makes it a hot path. This is *not* a violation of "no
  DOM measurement" (invariant #1) — that principle is about not forcing reflow during the
  arithmetic *layout* pass; translating a user gesture's screen position is unavoidable for any
  interactive surface and doesn't feed back into layout decisions.
- `attachInteractions` snapshots the registry/page elements at call time. Re-paginating requires
  `controller.destroy()` + a fresh `attachInteractions()` call — no auto-sync.

## Architecture / file map

```
src/
  core/
    nodes.ts             — Node union, Interactive shared fields, PageDef, builder functions
    geometry.ts           — Box, RenderedNode union, translateRendered()
    behavior.ts            — NodeMeasurer interface, registry (the extension seam), isSplittable(),
                              type-safe dispatch wrappers (measureNodeHeight/layoutNodeFull/splitNode)
    measure-text.ts         — pretext adapter: streamLines(), textMeasurer, measureTextNaturalWidth
    group-layout.ts          — layoutColumn(), layoutRow(), columnGroupSplit(), rowGroupSplit(),
                                subtreeHasPageBreak(), groupMeasurer
    separator-layout.ts       — separatorMeasurer, separatorMainSize()
    page-break-layout.ts       — pageBreakMeasurer (trivial: zero size)
    image-layout.ts             — imageMeasurer, imageNaturalWidth(), height-resolution rules
    table-layout.ts               — tableMeasurer: column flex-width resolution, cell alignment,
                                     header-row-repeat split; cycles with group-layout.ts (see its
                                     header comment and the "Common pitfalls" entry about it)
    chart-layout.ts                — chartMeasurer, chartNaturalWidth(), same height-resolution
                                      shape as image-layout.ts
    page-sizes.ts                — PAGE_SIZE_PRESETS, resolvePageSize()
    paginate.ts                   — paginateNode(), two-pass header/footer, paginate()
  render/
    shadow-dom.ts                  — mount(), printDocument(), renderPreview(), renderNode() (flat
                                      rendering, draggableAncestor/user-select threading),
                                      renderTableNode() (background/border line segments)
    chart-render.ts                 — renderChartSvg(): hand-built inline SVG for bar/line/pie/donut,
                                       fixed heuristic margins (no text measurement — see its header
                                       comment), default categorical palette from the dataviz skill;
                                       also exports its pure geometry/color helpers for pdf-render.ts
    reset.ts                        — BASE_ELEMENT_STYLE
    interval-utils.ts                — subtractIntervals()/BORDER_EPSILON, shared by shadow-dom.ts's
                                        and pdf-render.ts's table border-segment math
    font-registry.ts                  — registerFont(): fetches a font file once, registers it for
                                         on-screen use (FontFace) AND retains its bytes for later PDF
                                         embedding — the single-source-of-truth this whole feature
                                         depends on, see "PDF export" above
    pdf-render.ts                      — generatePdf(): vector PDF via pdfkit, a second paint step
                                          over PaginatedResult mirroring shadow-dom.ts's renderNode()
    pdf-view.ts                         — openPdfInNewTab(), showPdfDialog(): PDF-bytes-in, browser-
                                           chrome-out, decoupled from generatePdf() itself
  interaction/
    types.ts                         — InteractionTarget, all event payload types, InteractionController
    hit-registry.ts                   — buildHitRegistry(), hitTest(), hitTestDroppable(), toTypeList()
    attach-interactions.ts             — attachInteractions(): pointer event state machine (hover/
                                          click/drag/drop, threshold, dragTypes, overDropTarget)
  ready.ts                             — ready() (awaits document.fonts.ready)
  index.ts                              — public API surface (only file most consumers should import from)
  main.ts                               — demo app exercising every feature (see below)
```

`main.ts` is a living demo/test bed, not shipped library code — it builds one large document that
exercises: multi-page text splitting, header/footer with "Page X of Y", CSS-isolation
demonstration, row/column groups with all alignment modes, `flex` sizing (default/weighted/fixed),
`splitColumns` independent column splitting, `pageBreak()`, `Image` with `aspectRatio` and all
`objectFit` values, a multi-page `table()` with header-row repetition, nested-group cells, cell/row/
column background + alignment, cell-level interaction delegation, a second table demonstrating
column grouping (nested Warehouse/Status groups, `totals()` at both levels, a custom `header()` at
one level and the library default at the other, and non-adjacent duplicate group values proving
the "global regroup by value" semantics), a third (receipt-style) table demonstrating `colSpan`/
`rowSpan` (a quantity cell spanning two physical rows, a product-name cell spanning two columns)
combined WITH column grouping (by category) in the same table — proving the two features coexist —
and the full interaction system (bubble-up, specific-child-wins, drag preview, typed drag-and-drop
with live valid/invalid highlighting).
Reading it top to bottom is a good way to see every API in realistic use.

## Extension seam — adding a new node type

`TableNode` (`src/core/table-layout.ts`) and `ChartNode` (`src/core/chart-layout.ts`,
`src/render/chart-render.ts`) are worked examples of this pattern — read one alongside the steps
below. Still not implemented: rich mixed-style text runs, a generic `CustomNode` escape hatch. To
add one:

1. Add the new variant to the `Node` union in `nodes.ts` (extend `Interactive` like the others if
   it should support hover/click/drag).
2. Add a matching variant to `RenderedNode` in `geometry.ts`.
3. Implement a `NodeMeasurer<YourNode>` (`measureHeight`, `layout`, optionally `split` +
   `splittable`) in a new `your-type-layout.ts`, following the pattern in
   `separator-layout.ts`/`image-layout.ts` (simple, non-splittable) or `measure-text.ts` (splittable).
4. Register it in `behavior.ts`'s `registry` object and its three dispatch-switch functions
   (`measureNodeHeight`, `layoutNodeFull`, `splitNode`).
5. If it should participate in row `flex` sizing or column shrink-wrap sizing, add a branch to
   `group-layout.ts`'s local `measureNodeHeight`/`layoutNode`/`resolveRowChildSizing`/
   `childCrossWidthInColumn` (these are intentionally duplicated from `behavior.ts`, not imported,
   to avoid a runtime ESM circular dependency — see the comment at the top of `group-layout.ts`).
   If your new type is itself a **container** that can hold arbitrary nested content (as `table`
   is), its own layout file will need the same kind of local dispatch to handle a nested `group`
   — importing `groupMeasurer` from `group-layout.ts` while `group-layout.ts` imports your
   measurer back forms a two-file cycle. This is safe (see `table-layout.ts`'s header comment for
   the full argument) only as long as **both** sides reference the other exclusively inside
   function bodies, never at either module's top level to eagerly build an object — that's exactly
   how `behavior.ts`'s cycle-avoidance works too, just between two peer files instead of
   behavior.ts and one file.
6. Add a render case to `shadow-dom.ts`'s `renderNode()`.
7. If cells/children of your new type should support `interactive`/`draggable`/`droppable`, add a
   traversal branch to `hit-registry.ts`'s `flatten()` (see `table`'s branch there) — this alone is
   the entire "interaction delegation" mechanism, no new predicate or event type needed.
8. Export the builder + types from `index.ts`.

**No changes to `paginate.ts` are needed** for a new atomic (non-splittable) leaf type — this is
the entire point of the registry pattern.

## Known limitations (documented, not bugs)

- Single-page-body `mainAlign` centering only has defined behavior when the whole document fits on
  one page; multi-page documents leave it as `start`-equivalent (no coherent single-page meaning).
- `crossAlign` is not honored for `splitColumns: true` rows (always top-aligned per page-instance).
- No touch-specific handling (`touch-action`, etc.) in the interaction layer — desktop/mouse-first.
- `resolvePagePos()`'s per-page `getBoundingClientRect()` loop is uncached; fine at realistic page
  counts, flagged as the first optimization target for very long documents.
- Calling `attachInteractions` twice on the same host attaches two independent listener sets — not
  deduped, caller's responsibility.
- Image dimensions are never auto-detected (see invariant #6) — this is permanent by design, not a
  gap to eventually fill, since filling it would make `paginate()` asynchronous.
- `TableNode`: a row (or, with `rowSpan` in play, a whole spanning cluster — see "Cell spans") is
  atomic — if it doesn't fit in the remaining page space, it defers whole to the next page, never
  partially. A `pageBreak()` nested inside a table cell has no effect (`subtreeHasPageBreak()` only
  recurses into column-direction groups, not table cells), same as one nested inside a row-group
  column today. `headerRows` repetition works by keeping those rows at the front of both the fitted
  and `rest` node on every split — there's no page-number-aware header content the way the
  page-level `header`/`footer` has, so a header row can't reference `pageNumber`/`totalPages`.
- `rowSpan`: when a spanning cell's content is taller than the rows it spans naturally sum to, the
  entire height deficit is dumped onto the *last* physical row in the span rather than distributed
  proportionally across all of them (no CSS-style proportional redistribution). This doesn't affect
  the spanning cell's own alignment, but it does mean an ordinary cell that happens to share that
  last row gets a bigger visual gap below its own content than a proportional split would produce.
- Column grouping: a group's own totals row never repeats across a page split (only the *header*
  bar can — `totals` is an ordinary atomic row, not tracked by the repeat mechanism). `column.content`
  (auto header row) and an explicit `headerRows` are mutually exclusive (`table()` throws if both are
  used) — use one or the other. A rowSpan cluster's rows must all agree on
  `groupValues` (see "Cell spans") — `table()` throws otherwise, since satisfying both would require
  splitting an atomic cluster.
- PDF export: colors on any node (`TextNode.color`, separator/table border/background colors) are
  parsed as hex only (`#rgb`/`#rrggbb`/`#rrggbbaa`, alpha ignored) — any other CSS color syntax falls
  back to black with a `console.warn`. An unregistered font falls back to a Helvetica standard font
  (warn, not throw — see "PDF export" above) rather than blocking generation, so a document with
  unregistered fonts still produces a PDF, just not a font-exact one. Registered fonts ARE subsetted
  (pdfkit always subsets, see "PDF export" above) — no known equivalent of the old pdf-lib-era
  subsetter bug has surfaced. PDF chart bars render with correctly ROUNDED corners — `drawChartPath()`
  feeds `barPath()`'s exact path string (including its `A`/arc corner-rounding commands) to pdfkit's
  `.path()` unchanged, confirmed by rendering and visually inspecting output. Only the chart legend's
  small color swatches render with square corners (drawn via plain `.rect()`, which has no
  corner-radius option — pdfkit's `.roundedRect()` exists but isn't used here), unlike the slight
  `rx: 2` rounding chart-render.ts's SVG legend swatches have on screen — a minor, easily-missed
  cosmetic difference, not fixed for v1. Neither `characterSpacing` nor pdfkit's own text shaping
  applies OpenType GPOS kerning the way the browser's canvas does, so a font with strong kerning pairs
  can show a small cumulative spacing drift in the PDF versus the preview — line breaks/widths remain
  identical either way, only intra-line glyph spacing is approximate. Every embedded image is
  losslessly PNG-encoded at `RASTER_SCALE` (2x the display box, ≈192dpi) rather than transcoded to
  JPEG, so a document with several large photos can still produce a noticeably heavier PDF than an
  equivalent JPEG-based export would — not fixed for v1 (see "PDF export" above for the tradeoff this
  scale factor represents).

## Common pitfalls (bugs caught during development — don't reintroduce)

- **Separator orientation**: a separator's box means different things in row vs. column context
  (horizontal-bar vs. vertical-bar). `group-layout.ts`'s `layoutResolvedChild()` must use the
  already-resolved box from `layoutRow`/`layoutColumn` directly for separators, never recompute via
  `separatorMeasurer.layout()` generically — that function only knows the column orientation and
  would silently discard a row separator's stretched height.
- **Row-group continuation placeholders**: when `splitColumns` finishes a column early but a
  sibling column keeps going, the finished column's slot needs an `emptyContinuationFor()`
  placeholder (same width, zero height) on the continuation page — otherwise the grid redistributes
  and drifts out of alignment with the same row's rendering on the previous page. This applies to
  *every* branch that produces a `rest` entry per column, not just the "split returned rest" case —
  the "fits fully, finished" branch needs it too.
- **Page-break fast-path bypass**: `paginateNode`'s "fits fully, skip the per-child walk" shortcut
  must be guarded by `subtreeHasPageBreak()` at **both** the top-level call and inside
  `columnGroupSplit`'s own per-child fits-fully check — guarding only one lets a break nested one
  level deep (inside content that would otherwise fit) slip through unnoticed.
- **Bare top-level `PageBreakNode`**: if `paginateNode` is ever called with a node that's literally
  just `{ type: 'page-break' }` (e.g. a degenerate `doc.body`), it needs its own early-return branch
  rather than falling into the generic atomic-node overflow path, which would log a spurious
  "exceeds page height" warning for a genuinely zero-height node.
- **Nested `crossAlign: 'stretch'` silently inert**: `childCrossWidthInColumn()` (`group-layout.ts`)
  computes the shrink-wrapped width a column hands to a nested group child. It already special-cased
  a nested *row* with a flexible child (`rowHasFlexChild`) as wanting full width, but originally had
  no equivalent check for a nested *column* — so `group({ direction: 'column', crossAlign: 'stretch'
  })` nested inside a shrink-wrapping ancestor got boxed to its content's natural width one level up,
  and the inner `stretch` had nothing left to stretch into. Fixed by checking `node.crossAlign ===
  'stretch'` alongside the row case. Symptom to watch for: a single short text child with `align:
  'center'`/`'right'` that visually stays flush-left no matter what — the giveaway is that its box
  width already equals the text's own width.
- **`group-layout.ts` ↔ `table-layout.ts` cycle is load-bearing, don't "clean it up"**: these two
  files import each other's exported measurer (`groupMeasurer`/`tableMeasurer`) to lay out a group
  nested in a table cell and a table nested in a row/column, respectively. It only works because
  both sides reference the other exclusively **inside function bodies** — never at module top
  level, the way `behavior.ts`'s `registry` object eagerly dereferences `groupMeasurer`/
  `tableMeasurer` to build itself (which is exactly the pattern `group-layout.ts`'s header comment
  says to avoid, and why `behavior.ts` can't be imported by either file). Hoisting either
  cross-reference to top level — e.g. a top-level `const` computed from the other module's export —
  reintroduces a real "Cannot access '...' before initialization" TDZ crash, not a style nit.
- **`table-layout.ts`'s split "rendered" node now matches group/text's convention — don't
  re-introduce the old slice**: an earlier version deliberately SLICED `tableMeasurer.split()`'s
  `rendered.node` to just the rows placed on that page (unlike `columnGroupSplit`/text's `split()`,
  which keep the FULL original node always), because `shadow-dom.ts` used to resolve per-cell
  background by indexing `node.rows[r]`/`node.columns[c]` positionally against `rendered.rows[r]`
  — which only worked if the two stayed index-aligned. Column grouping's synthesized header rows
  (no corresponding `node.rows[r]` entry at all) broke that invariant, so background/border
  resolution moved to *layout time* instead (baked directly into `RenderedTableCell`/
  `RenderedTableRow` — see "Column grouping" above), and the slice was reverted to the full,
  unsliced node. This also fixed a real inconsistency: hit-testing a whole `interactive: true`
  table (not a per-cell delegate) used to expose the sliced, current-page-only node via
  `InteractionTarget.node`, unlike every other splittable node type. If you ever touch
  `tableMeasurer.split()`, keep `rendered.node` as the full original — reintroducing the slice
  would silently break `InteractionTarget.node` again.
