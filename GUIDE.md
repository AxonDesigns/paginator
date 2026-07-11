# Paginator — Architecture & API Guide

Declarative, print/PDF-style document layout and pagination engine. You author a document as a
tree of building blocks (page config with header/footer/margins, Group, Text, RichText, Separator,
PageBreak, Image, Container, Table, Chart), and the engine computes page breaks and exact pixel
positions **purely arithmetically** — never via DOM measurement
(`getBoundingClientRect`/`offsetHeight`) — then renders the result into real, isolated DOM. A
separate opt-in layer adds hover/click/drag/drop events over the same computed layout, intended
for building an editor on top of this later.

This document is written for an AI (or human) picking up this codebase cold. It states the
load-bearing invariants explicitly rather than leaving them implicit in code, since several bugs
during development came from violating one of them without realizing it.

## Mental model in one paragraph

`new Paginator()` is the library's single entry point. An instance owns exactly one piece of real
state — its own registered-font map (see "PDF export" below) — and exposes the whole pipeline as
methods. `pdfDoc.paginate(doc: PageDef): PaginatedResult` is a **pure, synchronous** method: node
tree in, a list of pages (each a tree of `RenderedNode`s with fully-resolved page-relative pixel
boxes) out. No DOM is touched during this call except pretext's own detached `OffscreenCanvas` for
text measurement. `pdfDoc.mount(result, host)` is a **dumb paint step**: it walks `PaginatedResult`
and creates absolutely-positioned DOM elements with inline styles inside a Shadow DOM root — it does
no layout math of its own. `pdfDoc.attachInteractions(result, host)` is a **third, independent
layer**: it builds its own pure-data hit-test registry from the same `PaginatedResult` and translates
native Pointer Events into hover/click/drag/drop callbacks. These three methods can be called
independently; `attachInteractions` requires `mount` to have run first only because it needs to find
the live page `<div>` elements via `getBoundingClientRect()` to translate cursor coordinates. Node
builders (`text`, `group`, ...) stay plain top-level functions, not methods — they're pure content
constructors with no state, and the same authored `Node` tree can be handed to more than one
`Paginator`. See "Multiple `Paginator` instances" below for what is and isn't shared across
instances.

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
   `Container`/`Table` with `borderRadius` set are a narrow, deliberate exception: their content
   becomes a REAL descendant of a real `overflow: hidden` wrapper (so the rounded corner actually
   clips it), with the render-time origin rebased to that wrapper's own top-left — the exact
   technique `renderPreview()` already established above. Safe specifically because hit-testing
   never relied on real DOM structure to begin with. Everything else stays flat.
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
import { definePage, group, text, separator, image, pageBreak, ready, Paginator } from './index.ts'

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

const pdfDoc = new Paginator()
await ready()
const result = pdfDoc.paginate(doc)
pdfDoc.mount(result, document.getElementById('app')!)
```

## Multiple `Paginator` instances

Each `new Paginator()` owns exactly one piece of real state: its own registered-font map (see "PDF
export" below) — the one thing that actually needed per-instance isolation, since two instances
registering different font files under the same family/weight/style would otherwise silently
corrupt whichever instance's `generatePdf()` happened to run later. Everything else the engine
touches is either already a pure function/method with no state of its own (`paginate()`, `mount()`,
`attachInteractions()`), or a deliberately shared global that's safe — and correct — to share across
every instance:

- The built-in node-type registry (`src/core/behavior.ts`) — a type-name -> layout/render-behavior
  lookup table, populated once at import time by every module in `src/nodes/`. It's a plugin/schema
  table, not per-document data, so one shared registry backing every `Paginator` instance is correct,
  the same way every instance of an ordinary class shares its prototype's methods.
- Several lazy `OffscreenCanvas` context singletons and content-addressed caches (text width, PDF
  font metrics, CSS color parsing, rasterized watermark text) — pure memoization keyed by the content
  being measured, not by which document or `Paginator` is asking.
- `chart-render.ts`'s monotonic SVG-gradient-id counter — deliberately global so two charts sharing
  one physical DOM/shadow root (even across two different `Paginator`-mounted documents) never
  collide on an unqualified gradient id.

So two `Paginator`s run side by side safely: register different fonts on each, paginate/mount/
generate PDFs from each independently, and neither instance's `generatePdf()` output picks up the
other's fonts. The one caveat that isn't fixable from this side: `registerFont()` still calls
`document.fonts.add()`, and `document.fonts` is the browser's own page-wide font registry with no
per-instance equivalent — on-screen text (`paginate()`'s pretext measurement, `mount()`'s painted
DOM) still resolves whichever file the browser most recently associated with a given family/weight/
style, regardless of which instance registered it last. Only PDF **embedding** reads bytes straight
from the owning instance's own map, so that part — the part that was actually silently corrupting
output before this was fixed — is correctly isolated per instance. Similarly, `setLocale`/
`clearCache` (re-exported straight from `@chenglou/pretext`) are that dependency's own process-global
state; there's no instance-scoped equivalent to wrap without forking pretext itself.

## Public API reference (`src/index.ts`)

`src/index.ts` exports the `Paginator` class — the operational pipeline (pagination, DOM rendering,
interactions, PDF/Word/Excel export) as instance methods — alongside a handful of free functions/
types that carry no per-instance state: node builders, `ready()`, and pretext's own `setLocale`/
`clearCache` passthroughs.

### Document authoring
| Export | Signature | Notes |
|---|---|---|
| `definePage` | `(config: Omit<PageDef,'body'>, body: Node) => PageDef` | Top-level document wrapper |
| `group` | `(config: Omit<GroupNode,'type'\|'children'>, children: Node[]) => GroupNode` | Row or column container |
| `text` | `(config: Omit<TextNode,'type'\|'lineHeight'> & { lineHeight?: number }) => TextNode` | `lineHeight` defaults to `round(fontSize * 1.2)` |
| `richText` | `(config: Omit<RichTextNode,'type'\|'lineHeight'> & { lineHeight?: number }) => RichTextNode` | Mixed-style inline `runs` (bold one word mid-sentence, colored spans, inline links via `run.href`) within one paragraph — a separate node from `text`, which stays one uniform run. `lineHeight` defaults the same way. A run with `href` renders as a real `<a>` on screen and a real pdfkit link annotation in the PDF, bypassing the interactive/hit-registry system entirely (see "Known limitations") |
| `separator` | `(config?: Omit<SeparatorNode,'type'>) => SeparatorNode` | Thin rule, dual orientation (see below) |
| `pageBreak` | `() => PageBreakNode` | Forces a page break; zero-size marker |
| `image` | `(config: Omit<ImageNode,'type'>) => ImageNode` | **Throws** if neither `height` nor `aspectRatio` is given |
| `svg` | `(config: Omit<SvgNode,'type'>) => SvgNode` | Raw SVG markup rendered as true vector content in the PDF (via `svg-to-pdfkit`), not rasterized. **Throws** if `markup` doesn't look like an SVG document, or if neither `height` nor `aspectRatio` is given |
| `container` | `(config: Omit<ContainerNode,'type'\|'child'>, child: Node) => ContainerNode` | Single-child decorative wrapper (Flutter's `Container`) — `background`/`border`/`borderRadius`/`padding`, plus `width`/`height`(minimum)/`flex` sizing. The one place `background`/`border`/`padding` exist for an otherwise-plain piece of content, since `group` deliberately has none of those |
| `table` | `(config: Omit<TableNode,'type'>) => TableNode` | Fixed grid, not semantic HTML — see below. **Throws** on a row/column-count mismatch, `headerRows` exceeding the row count, every column marked `group`, a `totals()` callback returning the wrong cell count, partial adoption of `column.content` across the effective columns, or `column.content` combined with an explicit `headerRows` |
| `chart` | `(config: Omit<ChartNode,'type'>) => ChartNode` | Seven kinds — `categorical` (merged bar/line/points), `radial` (merged pie/donut, plus multi-ring/sunburst), `scatter`, `gantt`, `radar`, `candlestick`, `treemap` — discriminated by `chartKind`, all built by hand with no charting library. **Throws** if neither `height` nor `aspectRatio` is given, plus a battery of kind-specific shape checks — see the full `ChartNode` reference below |

### Free-standing exports
| Export | Signature | Notes |
|---|---|---|
| `ready` | `() => Promise<void>` | Awaits `document.fonts.ready`; call before `paginate()` |
| `setLocale`, `clearCache` | pass-through from `@chenglou/pretext` | Locale-sensitive line-breaking / cache management escape hatches. Process-global — not scoped to any `Paginator` instance (pretext has no instance-scoped equivalent; see "Multiple `Paginator` instances" above) |
| `normalizeFontWeight` | `(weight: number \| string \| undefined) => number` | `'bold'`/`'normal'`/`'bolder'`/`'lighter'`/numeric-string -> a definite CSS numeric weight. A pure normalizer with no registry involved, so it stays a free function even though the rest of the font API moved onto `Paginator` |

### Pagination & rendering (`Paginator` instance methods)
| Method | Signature | Notes |
|---|---|---|
| `paginate` | `(doc: PageDef) => PaginatedResult` | Pure, synchronous |
| `mount` | `(result: PaginatedResult, host: HTMLElement) => void` | Creates/reuses an open Shadow DOM on `host`, replaces its content. Also wires up the `@page` size/margin rule and print-mode CSS so a plain `window.print()` against a mounted host prints correctly — see "Printing" below |
| `renderPreview` | `(rendered: RenderedNode) => HTMLElement` | Standalone, pixel-identical re-render of one subtree, re-based to (0,0) — for drag-preview ghosts |

### PDF export (`Paginator` instance methods, see full section below)
| Method | Signature | Notes |
|---|---|---|
| `registerFont` | `(options: { family: string; url: string; weight?: number \| string; style?: 'normal' \| 'italic' }) => Promise<void>` | Fetches a font file, registers it on THIS instance's own registry for on-screen use AND later PDF embedding. Call before `paginate()` |
| `generatePdf` | `(result: PaginatedResult, metadata?: PdfMetadata) => Promise<Uint8Array>` | Real vector PDF from the same data `mount()` renders, embedding fonts from this instance's own registry. Throws if a `fontFamily`/weight/style was neither registered nor one of pdfkit's Standard-14 fonts (Helvetica/Times/Courier/Symbol/ZapfDingbats — see "PDF export" below) |
| `listRegisteredFonts` | `() => RegisteredFont[]` | Inspects what's currently registered on this instance |

`generatePdf()` returns raw bytes — what a consumer does with them (open in a new tab via an object
URL, show a `<dialog>` with an `<iframe>`, trigger a download) is plain browser-native code, not part
of this library's API. See `src/main.ts`'s `openPdfInNewTab()`/`showPdfDialog()` for the pattern.

### Word/Excel export (`Paginator` instance methods, see full section below)
| Method | Signature | Notes |
|---|---|---|
| `generateDocx` | `(doc: PageDef, metadata?: DocxMetadata) => Promise<Uint8Array>` | Real, reflowable `.docx` from the pre-pagination `PageDef` directly (NOT a `PaginatedResult` — Word paginates its own content). Never throws on an unsupported node/environment — warns once and skips |
| `generateXlsx` | `(doc: PageDef, metadata?: XlsxMetadata) => Promise<Uint8Array>` | `.xlsx` workbook, one worksheet per `table()` node found anywhere in `doc.body`. **Throws** if the document has no table |

### Interaction (`Paginator` instance methods, all opt-in, see full section below)
| Method | Signature | Notes |
|---|---|---|
| `attachInteractions` | `(result: PaginatedResult, host: HTMLElement, options?: AttachInteractionsOptions) => InteractionController` | Requires `mount()` to have run on `host` first |
| `buildHitRegistry` | `(result: PaginatedResult) => HitRegistry` | Pure data, no DOM; what `attachInteractions` builds internally |
| `hitTest` | `(registry, pageNumber, x, y) => InteractionTarget \| null` | Resolves via `interactive: true`, bubble-up |
| `hitTestDroppable` | `(registry, pageNumber, x, y, dragTypes?: string[]) => InteractionTarget \| null` | Resolves via `droppable: true` + `accepts` filter, bubble-up |
| `findById` | `(registry: HitRegistry, id: string) => InteractionTarget[]` | Identity lookup, not geometric — one entry per matching page/fragment, in page order |
| `findFragments` | `(registry: HitRegistry, target: InteractionTarget) => InteractionTarget[]` | Automatic, id-free counterpart to `findById` — every fragment of `target`'s node across every page it was split onto; `[target]` if it was never split |
| `toTypeList` | `(value: string \| string[] \| undefined) => string[]` | Normalizes `dragType`/`accepts` shorthand |
| `createZoomController` | `(host: HTMLElement, options?: ZoomOptions) => ZoomController` | Headless zoom primitive: applies an animated CSS `transform: scale()` to `host` and returns `getZoom`/`setZoom`/`zoomIn`/`zoomOut`/`reset` — no buttons/UI. Pass `{ zoom: controller.getZoom }` to `attachInteractions` so hit-testing stays aligned at any zoom level; `host` should be the same element passed to `mount()` |

None of the methods above except `registerFont`/`listRegisteredFonts`/`generatePdf` actually read or
write instance state — they're grouped onto `Paginator` for one consistent object-oriented surface,
not because they need `this`. `generateDocx`/`generateXlsx` in particular are plain delegations to
free functions in `src/export/` with no font registry or other instance state involved (Word/Excel
embed no fonts of their own the way PDF does — see "Word/Excel export" below).

## Node type reference

Every node type below also carries the shared `Interactive` fields: `interactive?`, `draggable?`,
`droppable?`, `dragType?: string | string[]`, `accepts?: string[]`, `id?: string`, `metadata?:
Record<string, unknown>` — all `undefined`/off by default. See the "Interaction system" section
for their semantics.

### `PageDef`
| Field | Type | Notes |
|---|---|---|
| `size` | `'A4' \| 'Letter' \| { width, height }` | Presets in CSS px @96dpi: A4 794×1123, Letter 816×1056 |
| `margins` | `{ top, right, bottom, left }` | px |
| `header` / `footer` | `Node \| ((ctx: { pageNumber, totalPages }) => Node)` | See two-pass resolution below |
| `headerHeight` / `footerHeight` | `number?` | Explicit override; skips auto-measurement |
| `headerGap` / `footerGap` | `number?` | Default 0 |
| `background` | `string \| ((ctx: { pageNumber, totalPages }) => string \| undefined \| null)?` | Solid page background color. Default white. Resolved once per page in `paginate()`, exactly like `header`/`footer`/`watermark` — same callback shape, so e.g. only the cover page can have a colored background; the callback may return `undefined`/`null` to opt a page out entirely. Threaded through `PaginatedPage.background`, drawn by both `mount()` and `generatePdf()` |
| `border` | `ContainerBorder \| ((ctx: { pageNumber, totalPages }) => ContainerBorder \| undefined \| null)?` | Drawn around the page's own edge in both renderers. Same per-page resolution as `background`, including the opt-out return. No `borderRadius` (a page is never clipped/cropped). `ContainerBorder.style` (`LineStyle`, default `'solid'`) works here too |
| `watermark` | `Watermark \| ((ctx: { pageNumber, totalPages }) => Watermark \| undefined \| null)?` | Decorative overlay drawn on every page. The callback may return `undefined`/`null` to skip the watermark on a given page (e.g. only page 1). See below |
| `body` | `Node` | Usually a column `group` |

### `Watermark`
Not a `Node` — it never participates in pagination/flow (doesn't consume content-box height, isn't
registered as a node type the way every entry in `src/nodes/` is). It's a page-absolute overlay, resolved
once per page in `paginate()` exactly like `header`/`footer` content is (same
`{ pageNumber, totalPages }` callback shape), then painted directly by both renderers **last** — on
top of the page background, border, and header/body/footer content — so an opaque table stripe,
container background, or chart's white surface elsewhere on the page can never hide it. Never a
hit-test target (it can't be an `attachInteractions()` target since it isn't part of the authored
node tree).

| Field | Type | Notes |
|---|---|---|
| `kind` | `'text' \| 'image'` | Discriminant |
| `opacity` | `number?` | `0-1`. Default `0.15` |
| `rotation` | `number?` | Degrees, clockwise. Default `-45` (classic diagonal stamp) |
| `tile` | `boolean?` | Repeat in a grid across the whole page instead of a single centered instance. Default `false` |
| `tileGapX` / `tileGapY` | `number?` | px gap between tiled repeats. Only meaningful when `tile: true` |

Text watermark (`kind: 'text'`) additionally: `text: string`, `fontFamily?` (defaults to Helvetica,
pdfkit's built-in Standard-14 font, when omitted — any OTHER family must be `registerFont()`-ed or
`generatePdf()` throws), `fontWeight?`, `fontStyle?`, `fontSize?` (default `72`), `color?` (default
`#000000`), `selectable?: boolean` (default `false`: `generatePdf()` rasterizes the text to a
transparent PNG and draws it as an image, so it can't be selected/copied out of the PDF — pdfkit's
`.text()` otherwise embeds real, selectable/searchable glyphs like any other text in the document,
rarely wanted for a stamp sitting over real body content. Set `true` to keep it as live vector text.
Only affects `generatePdf()`; the on-screen preview's watermark is always `pointer-events: none`
regardless, since it's decorative-only and never a hit-test target).

Image watermark (`kind: 'image'`) additionally: `src: string`, `width: number`, `height: number`.

```ts
definePage(
  {
    size: 'A4',
    margins: { top: 40, right: 40, bottom: 40, left: 40 },
    watermark: ({ pageNumber }) => ({ kind: 'text', text: pageNumber === 1 ? 'ORIGINAL' : 'COPY' }),
    body: myBody,
  },
)
```

### `GroupNode` (`type: 'group'`)
| Field | Type | Notes |
|---|---|---|
| `direction` | `'row' \| 'column'` | |
| `mainAlign` | `'start'\|'center'\|'end'\|'space-between'\|'space-around'` | Default `'start'` |
| `crossAlign` | `'start'\|'center'\|'end'\|'stretch'` | Default `'start'` |
| `gap` | `number?` | Default 0 |
| `flex` | `FlexSize?` | Only meaningful as a ROW child — see "Row flex sizing" below |
| `alignSelf` | `CrossAlign?` | Overrides the parent's `crossAlign` for this node alone — see "Per-child alignSelf override" below |
| `splitColumns` | `boolean?` | Only meaningful when `direction: 'row'` — independent per-column page splitting, off by default |
| `children` | `Node[]` | |

### `TextNode` (`type: 'text'`)
| Field | Type | Notes |
|---|---|---|
| `content` | `string` | |
| `fontFamily`, `fontSize` | `string`, `number` | Required |
| `fontWeight`, `fontStyle`, `color` | optional | `fontWeight` default 400, `color` default `#000000` |
| `align` | `'left'\|'center'\|'right'` | Default `'left'` — pretext has **no** alignment concept; this is computed per-line from `line.width` vs box width. No `'justify'` — see Known Limitations |
| `textDecoration` | `'none'\|'underline'\|'line-through'?` | Default `'none'`. On the PDF renderer, drawn as a hand-positioned line using each line's own already-known `line.width` — deliberately NOT pdfkit's built-in `.text()` `underline`/`strike` options, which throw `"unsupported number: NaN"` under this codebase's `lineBreak: false`/manual-baseline positioning (see Common Pitfalls) |
| `lineHeight` | `number` | px. Required by the type, but the `text()` builder fills a default |
| `letterSpacing`, `whiteSpace`, `wordBreak` | optional | Forwarded to pretext's `prepare()` |
| `flex` | `FlexSize?` | Only meaningful as a ROW child |
| `alignSelf` | `CrossAlign?` | Overrides the parent's `crossAlign` for this node alone — see "Per-child alignSelf override" below |

### `SeparatorNode` (`type: 'separator'`)
| Field | Type | Notes |
|---|---|---|
| `thickness` | `number?` | Default 1 |
| `color` | `string?` | Default `#000000` |
| `margin` | `number?` | Default 0 — reserved on each side along the parent's **main axis** |
| `style` | `LineStyle?` (`'solid' \| 'dashed' \| 'dotted'`) | Default `'solid'`. The same `LineStyle` vocabulary is shared by `ContainerBorder` (`ContainerNode.border`, `TableCell.border`, `PageDef.border`) and `TableNode.border` — one set of keywords everywhere a line/border is drawn. On screen, drawn via a single-side CSS `border` (native `border-style` keywords) rather than a filled rectangle. In `generatePdf()`, `'dashed'`/`'dotted'` stroke the centerline with a pdfkit dash pattern via the shared `applyLineStyle()`/`resetLineStyle()` helpers (`src/render/pdf-render.ts`) — `'dotted'` additionally uses round line caps to read as circular dots — instead of filling the inset rect; `'solid'` still fills directly. In `generateDocx()`, maps to `BorderStyle.DASHED`/`BorderStyle.DOTTED` (Word's own border-style keywords) via the shared `docxBorderStyle()` helper |

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
| `borderRadius` | `number?` | Rounds the image's own painted content (a replaced element clips to `border-radius` natively on screen; PDF uses a clip region) — NOT the same as wrapping the image in a `container`'s `borderRadius`, which would only decorate around a still-rectangular image |
| `opacity` | `number?` | `0-1` |
| `flex` | `FlexSize?` | Only meaningful as a ROW child. When unset and `width` is set, the row-slot size defaults to `width` — see "Row flex sizing" below |
| `alignSelf` | `CrossAlign?` | Overrides the parent's `crossAlign` for this node alone — see "Per-child alignSelf override" below |

### `SvgNode` (`type: 'svg'`)
Takes raw SVG **markup** (a string, not a `src`/URL) and renders it as true vector content in the
exported PDF — crisp at any zoom, small file size — unlike passing an SVG through `ImageNode.src`,
which only ever rasterizes to a fixed-resolution PNG (pdfkit itself can't decode SVG natively; see
"Images" below). Sizing mirrors `ImageNode` exactly: same `height`/`aspectRatio` rule, and dimensions
are never auto-detected from the markup itself (would make `paginate()` asynchronous).

| Field | Type | Notes |
|---|---|---|
| `markup` | `string` | A full `<svg>...</svg>` document. Parsed at RENDER time by each renderer, never at `svg()`-construction time (`svg()` only does a cheap `markup.includes('<svg')` sanity check) |
| `width`, `height` | `number?` | At least one of `{width & height}`, `{width & aspectRatio}`, `{height & aspectRatio}`, or `{aspectRatio alone}` required |
| `aspectRatio` | `number?` | `width / height` |
| `opacity` | `number?` | `0-1` |
| `flex` | `FlexSize?` | Only meaningful as a ROW child. When unset and `width` is set, the row-slot size defaults to `width` — see "Row flex sizing" below |
| `alignSelf` | `CrossAlign?` | Overrides the parent's `crossAlign` for this node alone — see "Per-child alignSelf override" below |

**Two different renderers, two different fidelity/strictness tradeoffs:**
- **On-screen preview** (`mount()`/`renderPreview()`): the markup is parsed with the browser's own
  `DOMParser` and inserted directly as a real `<svg>` element — the browser renders 100% of valid
  SVG natively (gradients, filters, `<text>`, everything), with no feature gaps at all. This path is
  **strict**: malformed markup throws a `[paginator]` error immediately (a browser has zero
  tolerance for invalid XML).
- **PDF export** (`generatePdf()`): markup is handed to the `svg-to-pdfkit` package, which parses it
  with its own hand-rolled, environment-agnostic XML parser (no `DOMParser`/`fs` dependency — it
  runs identically against this project's browser-based `pdfkit.standalone.js` build) and redraws
  it using the same `doc.path()`/`.fill()`/`.stroke()` pdfkit vector primitives this codebase's own
  chart-drawing code already uses. Supported: shapes (`rect`/`circle`/`path`/`ellipse`/`line`/
  `polyline`/`polygon`), `use`/nested `svg`, `text`/`tspan`/`textPath`, transforms, `viewBox`/
  `preserveAspectRatio`, clip-paths, masks, gradients, patterns, embedded images, fonts, and links.
  NOT supported: SVG filters, `foreignObject`, and a few text attributes (`font-variant`/
  `writing-mode`/`unicode-bidi`). This path is **lenient**: markup too malformed even for its own
  parser only produces a `console.warn` (prefixed `[paginator] svg node: ...`), never a thrown
  error — a document that already renders fine on screen shouldn't fail PDF export over one broken
  decorative element.

### `ContainerNode` (`type: 'container'`)
A single-child decorative wrapper — Flutter's `Container` is the reference point — since `group`
(the only general-purpose multi-child node) deliberately carries none of this: no background,
border, borderRadius, or padding. Wrapping any other node (image, chart, table, text, another
group) in a zero-padding container gives it a background/border/padding "for free," which is why
those don't need their own such fields.

| Field | Type | Notes |
|---|---|---|
| `child` | `Node` | Exactly one — not an array. Wrap a `group` for multiple children |
| `width` | `number?` | Natural/shrink-wrap width in a non-stretch column context — same mechanism as `ImageNode.width` (`childCrossWidthInColumn` in `src/nodes/group.ts`). Overridden by an ancestor's `crossAlign: 'stretch'` or this node's own `alignSelf: 'stretch'`, same known limitation image/chart already have. Also doubles as the row-slot size when this node is a ROW child and `flex` is left unset — see "Row flex sizing" below |
| `height` | `number?` | A **MINIMUM**, not exact/clipped: box content height is `Math.max(height ?? 0, childNaturalHeight + padding.top + padding.bottom)` — the same `targetHeight`-as-floor pattern `layoutColumn` already uses. Deliberately not exact/clipping: no clip-region code needed in either renderer, and content is never silently lost. Not re-enforced on a fragment produced by splitting across a page boundary — the ordinary (non-split) layout path re-applies it naturally once nothing more needs splitting |
| `flex` | `FlexSize?` | Only meaningful as a ROW child. When unset and `width` is set, the row-slot size defaults to `width` |
| `alignSelf` | `CrossAlign?` | Overrides the parent's `crossAlign` for this node alone — see "Per-child alignSelf override" below |
| `padding` | `number \| { top, right, bottom, left }?` | Insets `child` from whatever width/height the box resolved to |
| `background` | `string?` | |
| `border` | `ContainerBorder = { thickness?; color?; style?: LineStyle }?` | A plain rectangle at the container's own edge — no straddle-avoidance needed (unlike table borders), since there's no internal grid to share edges with. `style` (`'solid'` default, `'dashed'`/`'dotted'`) — see `SeparatorNode.style`'s doc for the rendering approximation both non-solid styles share across every line/border in this codebase |
| `borderRadius` | `number?` | Rounds the container's own box (background + border) AND real-clips `child`'s own painted content to match — DOM via `overflow: hidden` on a real (non-flat, see invariant #4) wrapper, PDF via a `save()`/`roundedRect().clip()`/`restore()` region around just the child draw, same technique `ImageNode.borderRadius` already uses for its own pixels. Clamped to half the box's own width/height, same as `chart-geometry.ts`'s `roundedRectPath()`. Wrapping an image still benefits from the image's *own* `ImageNode.borderRadius` too if you want the image's corners individually rounded rather than merely windowed by the container's clip |

Splittability delegates entirely to `child` (splittable iff `child` is splittable, exactly like
`group` delegates to its own children) — a container wrapping a long paragraph or a tall column can
still split across a page boundary like any other splittable node.

### `ChartNode` (`type: 'chart'`)
Seven chart kinds, discriminated by `chartKind`, built by hand at render time with no charting
library. Sizing mirrors `ImageNode` exactly: same `height`/`aspectRatio` rule, resolved
synchronously in `src/nodes/chart/layout.ts` before anything is drawn (so internal chrome — axis
margins, legend band, row heights — uses fixed heuristic margins, never measured text). Non-
splittable, same as image. Every kind carries the shared fields below, plus its own kind-specific
fields documented in its own subsection.

Renderer file layout: `src/render/chart-render.ts` (the SVG entry point + DOM-only primitives) and
`src/nodes/chart/pdf.ts` (the PDF entry point + pdfkit-draw primitives) each dispatch by
`chartKind` to their own per-kind file — `chart-render-<kind>.ts` / `pdf-<kind>.ts` (`categorical`,
`radial`, `scatter`, `gantt`, `radar`, `candlestick`, `treemap`). Every pure, DOM/pdfkit-agnostic
geometry/color/text-estimate helper both renderers share lives in `src/render/chart-geometry.ts` —
this is what keeps the on-screen SVG and the exported PDF pixel-identical, since both call the exact
same functions rather than two hand-synced implementations.

#### Rich chart text (`ChartText` / `ChartTextRun`)

Every chart text role — `title`, series/slice/task/item labels (`ChartSeries.name`,
`ChartSlice.label`, `ChartGanttTask.label`, `ChartTreemapItem.label`, etc.), `categories`,
axis tick-label formatters (`ChartAxisConfig.formatTick`/`ChartNumericAxisConfig.formatTick`), and
legend entries derived from any of those — accepts `ChartText = string | ChartTextRun[]`, not just a
plain string:

```ts
type ChartTextRun = {
  text: string          // may contain '\n' — forces a line break, continuing subsequent runs on a new line
  fontSize?: number      // falls back to the ambient default for that text role
  color?: string         // falls back to the ambient default color for that role
  opacity?: number       // 0-1, default 1
  fontWeight?: number | string
  fontStyle?: 'normal' | 'italic'
}
```

A plain `string` (as ever) means "one run, one line, ambient style." An array opts into per-run
styling and/or explicit multi-line content, e.g. a big bold name followed by a smaller, faded value:

```ts
formatLabel(item) {
  return [
    { text: item.label, fontSize: 16, fontWeight: 700 },
    { text: `\n${item.value} MB`, fontSize: 11, opacity: 0.6 },
  ]
}
```

This mirrors `RichTextRun`'s shape (mixed-style inline runs) but is a **deliberately separate**
mechanism, not a reuse of `RichTextNode`: rich text gets its inline run positioning from pretext's
real text-shaping engine, while chart text has always used the rough `estimateTextWidth` heuristic
instead, since chart rendering must stay pixel-consistent between the on-screen SVG and the exported
PDF (see this file's own "fixed heuristic, never measured" rule above). `normalizeChartText()` (in
`chart-geometry.ts`) is the one place both renderers resolve a `ChartText` value's lines/runs against
ambient defaults; `svgText()`/`drawChartText()` then do their own final positioning (native `<tspan>`
layout for SVG, pdfkit's real `widthOfString()` for PDF) — but both draw from the exact same
line/run breakdown, so they can't drift. `fontStyle: 'italic'` only affects the SVG output — the PDF
renderer's font resolution has no italic variant to switch to (unlike `TextNode`'s own font
resolution), so it has no effect there. Truncation (used to fit a legend swatch row) only ever
applies to the plain-`string` case — a rich (array-form) label is drawn as-is, never truncated.

**Chart titles auto-wrap.** A `title` too wide for the chart's own box is word-wrapped onto
multiple centered lines (using the same heuristic both renderers share, so they wrap at the exact
same word) rather than overflowing the chart's edges — the title band's height grows to fit however
many lines that takes. This is legitimate because title/legend/axis chrome sizing has never been
part of `paginate()`'s synchronous layout (only the chart's OUTER box, from `height`/`aspectRatio`,
is — see `src/nodes/chart/layout.ts`'s header comment) — it's already recomputed from scratch on
every render in both renderers, so a content-dependent title band is no different in kind from the
legend band that already varies with entry count.

**Shared fields** (every `chartKind`):

| Field | Type | Notes |
|---|---|---|
| `chartKind` | `'categorical' \| 'radial' \| 'scatter' \| 'gantt' \| 'radar' \| 'candlestick' \| 'treemap'` | Discriminant |
| `width`, `height`, `aspectRatio` | `number?` | Same rule as `ImageNode`: needs `height` or `aspectRatio` |
| `title` | `ChartText \| { text: ChartText; fontSize?; color? }` | Optional, centered above the chart, word-wrapped to fit — see "Rich chart text" above |
| `fontFamily` | `string?` | Applies to every text role. Default Helvetica, pdfkit's built-in Standard-14 font. On the PDF renderer, resolves through the SAME font registry `text()` nodes use (`registerFont()`) — an unregistered, non-Standard-14 family throws, same as a `TextNode` |
| `legend` | `{ show?; position?: 'right'\|'bottom'; fontSize?; color? }?` | Default: on for `radial` and for any series-based kind with more than one series; off for `gantt`/`treemap` (nothing meaningful to show — Gantt's color is per-task, a treemap labels every rectangle inline) and for a single series. `fontSize` (px, default 11) sizes legend entry labels. `color` overrides the default secondary-ink legend text color |
| `colors` | `string[]?` | Categorical palette override, cycled by index; falls back to the built-in default palette |
| `flex` | `FlexSize?` | Only meaningful as a ROW child. When unset and `width` is set, the row-slot size defaults to `width` — see "Row flex sizing" below |
| `alignSelf` | `CrossAlign?` | Overrides the parent's `crossAlign` for this node alone — see "Per-child alignSelf override" below |

#### `chartKind: 'categorical'` — merged bar + line + points

One or more `series`, each independently rendered as `'bar'`, `'line'`, or `'points'` (markers
only, no connecting stroke) — freely mix e.g. two grouped bar series with a line series and a
points series, all sharing the same category x-axis and y-domain. Bar grouping/stacking (`barMode`)
only ever applies AMONG `'bar'`-kind series; a chart's line/points series are always drawn in their
own pass on top of the bars, never grouped or stacked with them.

| Field | Type | Notes |
|---|---|---|
| `categories` | `ChartText[]` | x-axis labels, one per data point in every series |
| `series` | `ChartSeries[]` — `{ name?; data: number[]; color?; kind?: 'bar'\|'line'\|'points'; fill?; curve?; strokeWidth?; markerRadius? }` | `kind` defaults `'bar'`. `fill` (`'line'` only) shades the area between that series' line and the baseline with a linear gradient — `true` uses the series' own resolved color at 0.25 opacity, an object overrides `color`/`opacity`. **Throws** if `fill`/`strokeWidth` is set on a non-`'line'` series, or `curve`/`markerRadius` on a `'bar'` series, or `fill.opacity` is outside `[0, 1]`, or a `data` length doesn't match `categories.length` |
| `orientation` | `'vertical' \| 'horizontal'?` | Default `'vertical'`. `'horizontal'` swaps the axes: categories run top-to-bottom, values run left-to-right — its own rendering path, mirroring the vertical one field-for-field (same reasoning as `group.ts`'s `layoutRow`/`layoutColumn` split) |
| `barMode` | `'grouped' \| 'stacked'?` | Only meaningful among `'bar'`-kind series. `'grouped'` (default) places them side by side; `'stacked'` sums them into one bar per category — positive above zero, negative below, rounded "data-end" only on the outermost segment |
| `barSegmentGap` | `number?` | `barMode: 'stacked'` only. Gap (px) between stacked segments; the true baseline/outermost-tip edges are never inset. Default `0`. **Throws** if negative |
| `barCornerRadius` | `number?` | Corner radius (px) of a bar's rounded "data end". Default 4 |
| `lineCurve` | `'linear' \| 'monotone'?` | Chart-level default for every `'line'`/`'points'` series without its own `ChartSeries.curve`. `'monotone'` draws monotone cubic (Fritsch–Carlson) interpolation — never overshoots a point's own value relative to its neighbors |
| `lineStrokeWidth` | `number?` | Chart-level default for every `'line'` series without its own `strokeWidth`. Default 2 |
| `markerRadius` | `number?` | Chart-level default for every `'line'`/`'points'` series without its own `markerRadius`. The white "surface ring" behind it stays 2px larger. Default 4 |
| `axis` | `ChartAxisConfig?` | `{ show?; gridlines?; tickCount?; formatTick?(v); tickFontSize?; categoryFontSize?; color?; gridlineColor?; tickColor? }`. Chrome only — never affects the domain (see `view`). `show` toggles ticks+gridlines+category labels together (default `true`); `gridlines` independently toggles just the lines |
| `view` | `ChartViewConfig?` | `{ domain?: 'zero' \| 'auto' \| { min?; max? }; padding?: number }`. Controls the y-domain. `'zero'` (default): spans `[min(0, dataMin), max(0, dataMax)]`. `'auto'`: tight to `[dataMin, dataMax]`, widened by `padding` (default `0.1`) on each side. An explicit `{ min?, max? }` overrides either mode outright. **Throws** if `min >= max` or `padding` is negative |

#### `chartKind: 'radial'` — merged pie + donut + rings/sunburst

Every radial chart is authored as `rings` — there is no top-level `slices` shorthand; a plain
single-ring pie/donut is just `rings: [{ slices: [...] }]`.

| Field | Type | Notes |
|---|---|---|
| `rings` | `ChartRing[]` — `{ slices: ChartRingSlice[]; sliceGap?; colors?: string[] }[]` | Ordered innermost (index 0) to outermost. Per-ring `colors` overrides the chart-level palette, cycled by that ring's OWN slice index (`si`), scoped to just that ring |
| `ChartRingSlice` | `{ label; value; color?; parentIndex? }` | `parentIndex` — index into the PREVIOUS ring's `slices` — nests this slice's arc inside a proportional sub-arc of that parent slice (sunburst). Meaningless on ring 0 (**throws** if set). A ring must be either fully hierarchical (every slice sets `parentIndex`) or fully flat (none do) — **throws** if a ring mixes both. **Throws** on an out-of-bounds `parentIndex`, or any `value` negative/non-finite |
| `innerRadiusRatio` | `number?` | Fraction of the outer radius left as a hole at the very center, shared by every ring (each ring gets an equal-width band across whatever radius remains). Replaces the old `donutInnerRadiusRatio`. Default `0` (solid pie). **Throws** if outside `[0, 1)` |
| `sliceGap` | `number?` | Angular gap between slices, in degrees (converted to a constant pixel width at the outer radius, so the channel doesn't taper toward the center). Default `1.5`. Per-ring `ChartRing.sliceGap` overrides this for that ring. **Throws** if negative |

#### `chartKind: 'scatter'` — continuous numeric x/y, optional bubble sizing

The only chart kind (besides `gantt`'s single time axis) with a genuinely numeric x-axis — every
categorical chart's other axis is a category band, not a real numeric domain.

| Field | Type | Notes |
|---|---|---|
| `series` | `ChartScatterSeries[]` — `{ name?; points: ChartScatterPoint[]; color? }` | `ChartScatterPoint = { x; y; size?; color? }`. **Throws** on an empty `series`/`points`, or a negative `size` |
| `xAxis`, `yAxis` | `ChartNumericAxisConfig?` | `{ show?; gridlines?; tickCount?; formatTick?(v); tickFontSize?; color?; gridlineColor?; tickColor? }` — independently resolved per axis (unlike `ChartAxisConfig`, which assumes one shared axis) |
| `xView`, `yView` | `ChartViewConfig?` | Same shape as categorical's `view`, but defaults to `'auto'` (not `'zero'`) when entirely omitted — scatter data routinely sits far from either axis' zero |
| `pointRadius` | `number?` | Fixed radius (px) for a point without its own `size`, or when `sizeScale` is unset entirely. Default 4 |
| `sizeScale` | `{ type?: 'sqrt'\|'linear'; range?: [number, number] }?` | Presence (even `{}`) opts every point WITH a `size` into bubble sizing; omitted means every point uses `pointRadius` regardless of `size`. `'sqrt'` (default) keeps AREA — not radius — linearly proportional to `size` (the standard bubble-chart convention). `range` default `[4, 24]`. **Throws** if `range[0] >= range[1]` or either bound is negative |

#### `chartKind: 'gantt'` — task/timeline bars over a numeric time axis

| Field | Type | Notes |
|---|---|---|
| `tasks` | `ChartGanttTask[]` — `{ label; start: number; end: number; color?; group?; labelColor? }` | `start`/`end` are PLAIN NUMBERS, never `Date` objects — this library does no date math anywhere; pre-convert real dates to numeric offsets and use `xAxis.formatTick` to render them back. **Throws** if `end < start`, or on an empty `tasks` array. `end === start` is a valid zero-width "milestone," drawn as a small pill. `color` is the task's own BAR fill; `labelColor` (independent of `color`) overrides `taskLabelColor` for that one task's row-label text alone |
| `group` | `string?` (on each task) | Tasks sharing a `group` value in a CONTIGUOUS run get one header band above them — deliberately much simpler than `TableNode.groups`: no reordering, no aggregation, just a divider wherever the group value changes between adjacent tasks |
| `xAxis` | `ChartNumericAxisConfig?` | Same shape scatter's axes use |
| `xView` | `ChartViewConfig?` | Defaults to `'auto'`, same reasoning as scatter's `xView`/`yView` |
| `rowHeight` | `number?` | px height of each row (task or header). Default: divides the available plot height evenly across every row. An explicit value is used exactly as given — size `height`/`aspectRatio` generously enough to fit every row, or rows overflow the chart's own box. **Throws** if `<= 0` |
| `showGroupHeaders` | `boolean?` | Default `true` iff any task sets `group` |
| `groupHeaderColor`, `groupHeaderBackground` | `string?` | Chart-level default text/background color for every group header BAND. Fall back to a neutral ink/light gray when entirely unset |
| `groups` | `Record<string, { color?; background? }>?` | Per-group override, keyed by the exact `group` string used on a task — wins over `groupHeaderColor`/`groupHeaderBackground` for that one group's band. A key that never matches any task's `group` is simply unused |
| `taskLabelColor` | `string?` | Chart-level default text color for every task's own row label — independent of `groupHeaderColor` (that's the header band text) and independent of each task's own bar `color`. Falls back to a neutral ink when unset. Per-task `ChartGanttTask.labelColor` overrides this for one task alone |

#### `chartKind: 'radar'` — spider chart

Reuses the categorical `categories`/`series` shape, laid out radially instead of on a Cartesian
plane: each category becomes a spoke (0°=top, sweeping clockwise, same convention `radial`'s
slices use), each series becomes one closed polygon connecting a vertex per spoke.

| Field | Type | Notes |
|---|---|---|
| `categories` | `ChartText[]` | The spokes |
| `series` | `ChartRadarSeries[]` — `{ name?; data: number[]; color?; fill? }` | `data` — one value per category. Values CAN be negative: reuses the exact same zero/auto/explicit domain resolution as categorical's y-domain, so the domain's own MINIMUM (not a hard-coded 0) becomes the center. `fill` is a FLAT solid-color-at-opacity (unlike a line's gradient-to-baseline fade — a closed radial shape has no single edge that reads as "the baseline"). **Throws** if a `data` length mismatches `categories.length`, or `fill.opacity` is outside `[0, 1]` |
| `view` | `ChartViewConfig?` | Shared radial domain across every series |
| `axis` | `ChartAxisConfig?` | Reused (not `ChartNumericAxisConfig`) since radar genuinely has both a category axis (spokes) and a value axis (concentric rings) at once |
| `markerRadius` | `number?` | Radius (px) of each vertex marker. `0` draws none. Default 3. **Throws** if negative |
| `lineStrokeWidth` | `number?` | Stroke width (px) of each polygon outline. Default 2 |

#### `chartKind: 'candlestick'` — OHLC bars

Reuses the categorical x-axis/category-band layout (always vertical — no `orientation` field;
real candlestick charts have no horizontal-orientation counterpart). No statistics computed
anywhere — every candle is caller-supplied, validated only for internal shape consistency.

| Field | Type | Notes |
|---|---|---|
| `categories` | `ChartText[]` | x-axis labels |
| `series` | `ChartCandlestickSeries[]` — `{ name?; data: ChartCandle[]; upColor?; downColor? }` | `ChartCandle = { open; high; low; close }`. **Throws** if `low > min(open, close)`, `high < max(open, close)`, or a `data` length mismatches `categories.length` |
| `view` | `ChartViewConfig?` | Defaults to `'auto'`, same reasoning as scatter/gantt — real price data rarely sits near zero |
| `axis` | `ChartAxisConfig?` | Same shape categorical uses |
| `candleWidth` | `number?` | px width of each candle body. Default: same band-fit sizing a single-series bar gets (capped at the bar-thickness cap), divided among series like grouped bars when there's more than one |
| `wickWidth` | `number?` | px width of the high-low wick line. Default 1 |
| `upColor`, `downColor` | `string?` | Chart-level default fill for a candle whose `close >= open` / `close < open`. Default a green/red. Per-series `upColor`/`downColor` override these for that series alone — a candle's color is driven by direction, not series identity, so there's no plain `series.color` field here |

#### `chartKind: 'treemap'` — flat, single-level, squarified layout

The odd one out: no axis, no domain, no ticks at all — the whole plot box IS the treemap.

| Field | Type | Notes |
|---|---|---|
| `items` | `ChartTreemapItem[]` — `{ label; value; color? }` | Flat, single level (no nested/hierarchical drill-down — deliberately scoped out). Rectangle area is proportional to `value`, packed via the standard squarified layout algorithm (Bruls/Huizing/van Wijk) to keep rectangles close to square rather than the thin slivers a naive slice-and-dice produces. A `value` of `0` is allowed (degenerates to a zero-area rectangle, contributing no visible mark). **Throws** if any `value` is negative or non-finite, or on an empty `items` array |
| `itemGap` | `number?` | px gap between adjacent rectangles, inset uniformly on every rectangle's own edges (a treemap has no shared "baseline" edge the way a stacked bar does). Default 2. **Throws** if negative |
| `labelFontSize` | `number?` | px font size for each rectangle's own inline label (drawn in white, directly on the fill). A rectangle too small to fit its label at this size simply omits it — never overflows or wraps. Default 12 |
| `formatLabel` | `((item: ChartTreemapItem) => ChartText)?` | Formats the content drawn inside each rectangle — same caller-supplied-formatter pattern as `ChartAxisConfig.formatTick`, now returning full `ChartText` (see "Rich chart text" above) rather than a plain string, so a name run and a smaller/faded value run can be styled independently. Receives the whole item (not just `label`), so the formatted content can fold in `value` too. The too-small-to-fit check is measured against the resolved content's widest line and total block height; an empty (or all-blank) result omits the label entirely, same as returning `''` always has. Default: `item.label` unchanged |

### `TableNode` (`type: 'table'`)
A fixed grid, not a semantically "correct" HTML table — no `thead` element, but `colSpan`/`rowSpan`
cell merging is supported; see "Cell spans" below.

| Field | Type | Notes |
|---|---|---|
| `columns` | `{ width?: FlexSize; background?: string; align?: CrossAlign; padding?: number; verticalAlign?: 'start'\|'center'\|'end'; content?: Node }[]` | `width` uses the *same* fixed-px/flex-weight/`'shrink'` model as row-child sizing below — `width: 'shrink'` sizes the column to the widest colSpan-1 cell's own natural width across every row (own padding included), the same `naturalWidth()`/`childCrossWidthInColumn` mechanism a shrink-wrapped row/column child uses, just maxed over the whole column instead of one subtree (`columnNaturalWidth()` in `src/nodes/table/layout.ts`). `generateDocx()` can't compute it (see Row flex sizing below) and falls back to an equal flex-grow weight with a one-time warning; `generateXlsx()` computes it correctly, since it reuses this same real layout function. `padding`/`verticalAlign` are per-column DEFAULTS for every cell in that column (see precedence below) — `verticalAlign` in particular is the only way to align the auto-generated header row (from `content`), since that row has no other mechanism to set it. `content` — a header caption for this column; see "Column header captions" below. Always exactly what you authored — no other feature (grouping included) ever strips or reshapes this array |
| `rows` | `TableRow[]` — `{ kind?: 'cells'; cells: TableCell[]; groupValues?: string[]; background?: string; verticalAlign?: 'start'\|'center'\|'end'; topBorder?: ContainerBorder; bottomBorder?: ContainerBorder }` or `{ kind: 'header'; depth: number; content?: Node; cells?: TableCell[]; background?: string; repeat?: boolean; topBorder?: ContainerBorder; bottomBorder?: ContainerBorder }` | `cells.length` must equal `columns.length` for every non-header row (implicit-flow authoring changes this when spans are in play — see "Cell spans"). `groupValues` — see "Column grouping". The `header` variant is either a full-width single-`content` bar, or colSpan-aware, column-grid-aligned `cells` (exactly one of the two is set) — see "Column grouping". `topBorder`/`bottomBorder` — a full-width accent line at this row's own top/bottom edge, overriding whatever `TableNode.border.inner`/`headerSeparator` would otherwise draw at that exact boundary; hand-authorable on any row, or baked in automatically by `TableGroupLevel.headerBorder`/`totalsBorder` — see the `border` row below and "Column grouping" |
| `TableCell` | `{ content?: Node; colSpan?; rowSpan?; background?: string; align?: CrossAlign; verticalAlign?: 'start'\|'center'\|'end'; padding?: number; border?: ContainerBorder; value?: string }` | `content` is an arbitrary `Node` — a cell can nest a `group`/`text`/`image`/another `table`, and is always required. `padding` overrides `column.padding`/`TableNode.cellPadding` for this one cell. `border` draws a complete rectangle around just this cell's own box, independent of (and drawn on top of) the table-wide `border.inner`/`border.outer` lines below — since it's a full rect rather than a shared-edge line, two adjacent bordered cells show a double-thickness line between them (deliberately simpler, not a bug); no `borderRadius` (a rounded corner on one cell in a shared grid has no well-defined meaning next to its square neighbors). `border.style` (`LineStyle`, default `'solid'`) is independent of, and can differ from, the table-wide `border.inner.style`/`border.outer.style`. `value` — optional convenience for `totals()` callbacks (see "Column grouping"), unrelated to bucketing; `colSpan`/`rowSpan` — see "Cell spans" |
| `groups` | `TableGroupLevel[]?` | Report-style row grouping levels, ordered outermost -> innermost — see "Column grouping" |
| `headerRows` | `number?` | Leading row count repeated at the top of every continuation page this table spans. Freely composable with `groups`; mutually exclusive with `column.content` (see "Column header captions") |
| `headerBackground` | `string?` | Background for the single auto-generated header row (from `column.content`). Ignored if no column defines `content`, or if you author header row(s) manually via `headerRows` instead (set `background` on that row directly) |
| `repeatHeaderRow` | `boolean?` | Default `true`. Whether the table's own `headerRows` prefix repeats on every continuation page, or appears only once at the very top |
| `repeatGroupHeaders` | `boolean?` | Default `true`. Table-wide default for `TableGroupLevel.repeat` on every grouping level that doesn't set its own — see "Column grouping" |
| `border` | `{ inner?: TableBorderLine; outer?: TableBorderLine & { borderRadius?: number }; headerSeparator?: ContainerBorder \| boolean }?` — `TableBorderLine = { mode?: 'none'\|'horizontal'\|'vertical'\|'all'; thickness?; color?; style?: LineStyle }` | Omitted entirely = no borders at all. `inner` (grid lines between rows/columns) and `outer` (the table's own perimeter) are FULLY INDEPENDENT — each resolves its own `mode`/`thickness`/`color`/`style` (defaults `1`/`'#000000'`/`'solid'`), and `mode` defaults to `'all'` whenever that group's object is present (even with `mode` itself unset), same "object present = mode defaults to all" rule the old single `mode` used. For `inner`, `'horizontal'`/`'vertical'` mean "only between-row lines"/"only between-column lines"; for `outer`, they mean "only the top+bottom perimeter edges"/"only the left+right perimeter edges". Migrating the old single-`mode` shorthand: old `'outer'` is `{ inner: { mode: 'none' }, outer: {} }`; old `'horizontal'`/`'vertical'`/`'all'`/`'none'` is the same mode set on BOTH `inner` and `outer`. Rendered as single-thickness line segments, never a per-cell CSS border, to avoid doubled thickness at shared cell edges — a `'dashed'`/`'dotted'` line segment strokes its own centerline instead of filling (same approximation `SeparatorNode.style` uses), still avoiding the double-thickness straddle. `outer.borderRadius` rounds the OUTER perimeter's 4 corners and real-clips cell/row/header backgrounds and content to match (same clipping technique as `ContainerNode.borderRadius`) — only valid when `outer.mode` is `'all'` (the only mode that draws a closed rectangle; `table()` throws otherwise), clamped to half the table's own width/height. `headerSeparator` draws one more line at the boundary between the table's `headerRows` prefix and its body — `true` reuses `inner`'s own thickness/color/style, an object is fully custom, and it's silently skipped when `headerRows` is 0 (no boundary exists). A row's own `topBorder`/`bottomBorder` (see the `rows` row above, and `TableGroupLevel.headerBorder`/`totalsBorder` under "Column grouping") overrides whatever `inner`/`headerSeparator` would otherwise draw at that one row boundary — precedence at any given horizontal line, most-specific wins: row override > `headerSeparator` > `outer` (only at an outer-perimeter position) > `inner`. docx/xlsx exports support independent `inner`/`outer` styling (real per-edge `IBorderOptions`/`ExcelJS.Borders`) but ignore `outer.borderRadius` (no rounded-border primitive in either format), `headerSeparator`, and any row's `topBorder`/`bottomBorder` — each skipped with its own one-time console warning |
| `cellPadding` | `number?` | Default 0. Table-wide default, overridable per column (`column.padding`) or per cell (`cell.padding`) — see precedence below |
| `stripe` | `{ even?: string; odd?: string }?` | Alternating row background, desugared entirely at `table()` build time into per-row `background` (`src/nodes/table/layout.ts` never knows striping happened, same architecture "Column grouping" already uses). Applies only to ordinary data rows — never the table's own literal header-row prefix, nor a column-grouping header/divider bar — and never overrides a row that already sets its own `background`. `even`/`odd` count sequentially through those data rows starting at 0 (even) |
| `flex` | `FlexSize?` | Only meaningful as a ROW child |

Alignment precedence, resolved per cell: horizontal `cell.align ?? column.align ?? 'stretch'`;
vertical `cell.verticalAlign ?? row.verticalAlign ?? column.verticalAlign ?? 'start'`. Padding
precedence: `cell.padding ?? column.padding ?? TableNode.cellPadding ?? 0` — note the row height
itself is still shared across every cell in that row (`Math.max` of each cell's own
`naturalHeight + 2*padding`), so a column with a smaller padding than its neighbors doesn't shrink
the row — it just gets more slack inside a box already sized for the taller neighbors, which is why
`verticalAlign` matters for a tighter-padded column. Background precedence: `cell.background ??
row.background ?? column.background ?? undefined`, resolved once at layout time (`src/nodes/table/layout.ts`)
and baked into the `RenderedNode`, not re-derived at render time. Rows are atomic (a row's content
never splits mid-row) — the table itself splits **between** rows across a page boundary, same "walk
top-to-bottom, defer the rest" shape as a column group's split, just over `rows` instead of
`children`. Cells (and a group header bar's `content`) participate in the interaction system's
bubble-up hit-testing exactly like group children — see "Interaction system" below.

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
  headerBorder?: { top?: ContainerBorder; bottom?: ContainerBorder }  // accent line at this level's header bar's own top/bottom edge
  totalsBorder?: { top?: ContainerBorder; bottom?: ContainerBorder }  // same, for this level's totals() row — table() throws if set without totals
}
```
`headerBorder`/`totalsBorder` are baked onto the synthesized `kind: 'header'`/totals row's own
`topBorder`/`bottomBorder` (see the `rows` row in "Node type reference" above) by
`applyGroupingRows()` — for the `TableCell[]`-form `totals()`, they're passed on the INPUT to
`resolveCellSpans()` rather than bolted on afterward, so they survive that call's `{ ...row, ... }`
spread the same way `groupValues` already does when spans and grouping coexist. They OVERRIDE (not
add to) whatever the table-wide `border.inner`/`border.headerSeparator` would otherwise draw at that
exact row boundary — see the `TableNode.border` row's precedence rule above.

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
already-resolved `repeat` flag baked in at desugar time. `src/nodes/table/layout.ts`, `geometry.ts`,
`src/nodes/table/dom.ts`, and `hit-registry.ts` never know grouping happened — and since grouping never
touches columns or cells, this file needs **zero changes for grouping**, unlike the header-repeat
mechanism below which does live partly in `src/nodes/table/layout.ts`. They only ever handle the two
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
`splitTable()` (`src/nodes/table/layout.ts`) — as it walks rows deciding what fits on the current
page, it maintains a small depth-indexed stack of "currently active" header rows (`row.depth` closes
any same-or-shallower entry already on the stack, mirroring the nesting `applyGroupingRows()`
already produces); whichever of those are still `repeat !== false` **and** still have at least one of
their own rows left after the cut (a header whose own `totals` row happened to be the very last thing
that fit is fully finished, not "in progress" — it does not re-appear even if `repeat` is on) get
prepended to the continuation's rows, ahead of whatever comes next. This composes with `headerRows`:
the table's own header prefix (governed independently by `repeatHeaderRow`) and any repeated group
headers can both be present at the top of a continuation page. Inner vertical border lines correctly
skip past a header bar's full width (same interval-subtraction machinery `renderTableBorders()` in
`src/nodes/table/dom.ts` (and its PDF counterpart in `src/nodes/table/pdf.ts`) already uses for colSpan/rowSpan cells — a header row's box is exactly
`[tableLeft, tableRight]`, so it "straddles" every inner vertical line by construction). `kind:
'header'` rows are also directly authorable by hand, independent of automatic
column grouping — a plain section-divider banner in any table (with its own `repeat`, default
`true`) — but not mixable with `groups` in the same table's data rows (`table()` throws if a `kind:
'header'` row appears among the rows that would otherwise get bucketed).

**Horizontal border-line precedence** (`src/nodes/table/border-resolve.ts`, shared by `dom.ts`/
`pdf.ts` so the two renderers can't drift): at any given horizontal Y position, the most specific
source wins — a row's own `topBorder`/`bottomBorder` (whether hand-authored or baked in from
`TableGroupLevel.headerBorder`/`totalsBorder`) beats `border.headerSeparator`, which beats
`border.outer` (only at an outer-perimeter position), which beats `border.inner`. When two adjacent
rows both set a border at the boundary they share (row *i*'s `bottomBorder` and row *i+1*'s
`topBorder`), row *i*'s `bottomBorder` wins. **Known limitation:** when `border.outer.borderRadius`
is active, a row's own accent border landing exactly on row 0 or the last row draws as an ordinary
straight segment, not clipped to the curve — the rounded perimeter's clip region is already restored
by the time row-level overrides draw, the same class of narrow cosmetic limitation as docx's
documented rowSpan-border-repeat issue below.

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
`src/nodes/table/layout.ts`, `geometry.ts`, `src/nodes/table/dom.ts`, and `hit-registry.ts` never see `colSpan`/`rowSpan`
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

## Row flex sizing (`FlexSize = number | \`${number}px\` | 'shrink'`)

A ROW group's direct children are sized by a two-pass model, same mechanics as CSS `flex-grow`:
1. Fixed-size children — any child with `flex: 'Npx'` or `flex: 'shrink'`, plus separators, which
   are always fixed at `thickness + 2*margin` — claim their exact width first.
   - `flex: 'Npx'` claims exactly `N` authored pixels.
   - `flex: 'shrink'` claims its own natural/shrink-wrap width instead of an authored pixel value —
     the same `naturalWidth()`/`measureNaturalWidth` mechanism a column child uses to hug its
     content (a nested row's own natural width sums each child's natural contribution — a fixed
     child's resolved size, or a flex child's OWN natural/shrink-wrap width computed the same
     recursive way, plus gaps; a nested column reuses `childCrossWidthInColumn`'s max-of-children).
     Works
     on any node type that registers a `naturalWidth` (`TextNode`, `RichTextNode`, `ImageNode`,
     `SvgNode`, `ContainerNode`, `GroupNode`) — see `shrinkWrapWidth()` in `src/nodes/group.ts`. This
     is how you get CSS-`inline-block`-style siblings that hug their own content instead of splitting
     the row into equal (or px-authored) columns, so `mainAlign: 'center'`/`'space-between'` on the
     row has real free space to distribute (see rule 3 below) — e.g. two headline `text()` nodes in a
     row both need `flex: 'shrink'` for `mainAlign: 'center'` to visually center them as a unit
     (`src/main.ts`'s title row).
   - `ImageNode`/`SvgNode`/`ChartNode`/`ContainerNode` also claim a fixed width here from their own
     `width` field whenever `flex` is left unset — the same value that already governs their size in
     a column/shrink-wrap context works unchanged as a row child too, so `flex: 'Npx'`/`'shrink'` is
     only needed to override `width` or to opt into flex-grow weighting for these four types.
   - **A leaf content node (`TextNode`/`RichTextNode`/`ImageNode`/`SvgNode`/`ContainerNode`/
     `ChartNode`) with `flex` left unset AND no explicit `width` is ALSO fixed-size by default** —
     it behaves exactly like `flex: 'shrink'`, hugging its own natural width instead of taking an
     equal share. This mirrors CSS's actual flex-item default (`flex-grow: 0`, content-sized), not
     an equal-share weight — an un-pinned label/value pair of `text()` nodes sizes to its own
     content and never wraps just because a sibling squeezed it below what it needs.
2. Remaining width is divided among flexible children proportional to their weight. Only a nested
   **`GroupNode`** (row or column) with `flex` left unset defaults to being flexible here (weight
   `1`) — a nested group is a layout container, closer to a block-level flex box that fills its
   share of the row unless told otherwise, so it keeps the old equal-share default. An explicit
   `flex: N` makes ANY child (leaf or group) flexible with that weight, overriding its type's default.

`mainAlign` (`space-between` etc.) only has an effect when **no** child is flexible — flexible
children already consume all remaining space by construction, exactly like CSS (`flex-grow` eats
free space before `justify-content` ever sees any). `flex: 'shrink'` children (and now, by default,
any un-pinned leaf child) count as fixed-size for this rule, same as `flex: 'Npx'`, so a row that's
entirely leaf/`'shrink'`/`'Npx'`/separator children leaves free space for `mainAlign` to distribute.

`TableColumn.width` reuses the same `FlexSize` type/px/`'shrink'` model, but **keeps the old
equal-share default** (`width` unset → weight `1` for every column, regardless of what a cell's
content type is) — a table's columns are a grid, not a row of arbitrary content, so equal columns
stays the sane default there; only `TableColumn.width: 'shrink'` opts a column out of it, sizing it
to the widest colSpan-1 cell's natural width across every row instead of one subtree (see the
`TableNode.columns` row in "Node type reference" above for exactly how it's computed and its one
edge case, colSpan>1 cells). `generateDocx()` can't compute a `'shrink'` width for either a row
child's `flex` or a `TableColumn.width` — it deliberately avoids pulling in the DOM/pretext
measurement path (see the module header comment in `src/export/docx-export.ts`) — and falls back to
an equal flex-grow weight in both cases, with a one-time console warning.

Column children never use `flex` for width — their cross-axis width comes from `crossAlign`
(`'stretch'` = full column width, otherwise shrink-to-fit via pretext's `measureNaturalWidth`). When
neither a child's own `alignSelf` nor the column's own `crossAlign` is set, the default itself
depends on the child's type, mirroring the row-axis default above: **a nested `GroupNode` defaults
to `'stretch'`** (fills the column's full width, like a block-level flex box), while **every other
node type defaults to `'start'`** (hugs its own natural width, like inline/replaced content) — see
`layoutColumn()` in `src/nodes/group.ts`. A nested group's *own* `crossAlign: 'stretch'` is honored
by its shrink-wrapping ancestor too — a column whose `crossAlign` is `'stretch'` (see
`childCrossWidthInColumn` in `src/nodes/group.ts`) is handed the full width being offered rather
than shrink-wrapped to its content, so its own children can actually fill it. Without that, a
`crossAlign: 'stretch'` column nested inside a shrink-wrapping ancestor would get boxed to its
content's natural width one level up, making the inner `stretch` inert.
Column children's **height** is always intrinsic/content-driven, never flex-based — pagination
depends on that.

## Per-child `alignSelf` override

Every node that has ambiguous shrink-wrap-vs-stretch sizing (`GroupNode`, `TextNode`, `RichTextNode`,
`ImageNode`, `SvgNode`, `ChartNode`, `ContainerNode`) also carries an optional `alignSelf: CrossAlign`
— mirrors CSS `align-self`. When set, it overrides the parent group's `crossAlign` for that one child
alone, without touching how any sibling is sized or positioned.

In a COLUMN parent, `alignSelf: 'stretch'` claims the column's full width for this child even though
the column itself isn't stretching every child — this is the direct, scoped alternative to wrapping
just that one child in its own dedicated `group({ direction: 'column', crossAlign: 'stretch' }, [child])`
ancestor. Two cases this fixes:
- A single short text child (e.g. a heading) whose `align: 'center'`/`'right'` would otherwise
  silently do nothing, because its shrink-wrapped box is already exactly as wide as the text —
  `text({ ..., align: 'center', alignSelf: 'stretch' })` centers it in place.
- A ROW group whose own `mainAlign` (`'center'`, `'space-between'`, etc.) would otherwise have no
  free space to distribute, because the row shrink-wraps to the sum of its fixed-size children —
  `group({ direction: 'row', mainAlign: 'center', alignSelf: 'stretch' }, [...])` centers the row's
  own children in place.

In a ROW parent, `alignSelf` only affects this child's own vertical position among mismatched-height
siblings (`'start'`/`'center'`/`'end'`) — `'stretch'` has no effect there (falls back to `'start'`),
since a row child's height is always intrinsic; there's no reflow mechanism to actually grow a
shorter child to the row's full height.

## Pagination algorithm (`src/core/paginate.ts`, `src/nodes/group.ts`)

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
  (`src/nodes/text.ts`) so there's exactly one code path walking the cursor.
- **Column group splitting** (`columnGroupSplit` in `src/nodes/group.ts`) walks children top-to-bottom
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

Printing itself is just `window.print()` — this library has no API of its own for triggering it (see
`src/main.ts`'s `printDocument()` helper for the demo's thin, validated wrapper: `throws` if `host`
was never `mount()`-ed). What the library DOES do is make a plain `window.print()` call against a
`mount()`-ed host come out correctly sized, with no extra blank pages — wired up live inside `mount()`
itself, so it fires correctly regardless of *how* printing gets triggered — a button calling
`window.print()`, the browser's own Ctrl/Cmd+P, or a print icon in the OS UI:

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

## PDF export (`src/paginator.ts`, `src/render/pdf-render.ts`, `src/render/pdf-fonts.ts`, `src/render/font-registry.ts`)

A second, independent paint step over the same `PaginatedResult`/`RenderedNode` data `mount()` already
consumes — same relationship `renderPreview()` has to `mount()`. Produces a real vector PDF via
[pdfkit](https://pdfkit.org): selectable/searchable text, not a screenshot. `pdfDoc.generatePdf(result,
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
invariant #7 and `src/nodes/text.ts`). For the PDF's embedded vector glyphs to reproduce identical line
breaks, the PDF must embed that literal file — not just a font that "looks like" the CSS family name.
`pdfDoc.registerFont({ family, url, weight?, style? })` fetches a font file once and serves both
consumers from the one byte array: it registers a `FontFace` via `document.fonts.add()` + `.load()`
(so canvas measurement AND on-screen DOM rendering use this exact file, same guarantee `ready()`
already documents for `document.fonts.ready`), and retains the raw bytes in `pdfDoc`'s own registry
for `generatePdf()` to embed identically later via pdfkit's bundled fontkit v2 (the actual font-name
resolution each PDF-drawing node type calls into — `resolveTextFont()`/`resolveRunFont()`/
`resolveChartFontName()` — lives in `src/render/pdf-fonts.ts`, shared by `src/nodes/text.ts`,
`src/nodes/rich-text.ts`, and `src/nodes/chart/pdf.ts`). Must resolve before `paginate()` is called
with text using that family/weight/style. `.ttf`/`.otf`/`.woff`/`.woff2` are all accepted — fontkit v2
decodes all four to real sfnt glyph data before embedding (verified: registering a `.woff2` file
produces a valid, correctly-rendering PDF, checked against poppler's strict parser as well as
Chromium's own viewer).

**The registry itself is owned per `Paginator` instance, not global.** `font-registry.ts`'s
`registerFont()`/`lookupFont()`/`listRegisteredFonts()` all take an explicit `FontRegistry`
(`Map<string, RegisteredFont>`) argument rather than reading/writing module state; `Paginator` holds
the actual `Map` and threads it through every method that needs it — `registerFont`,
`listRegisteredFonts`, and `generatePdf()`'s `PdfContext.fonts`. This is what lets two independent
`Paginator` instances register different files under the same family/weight/style without one
instance's `generatePdf()` output being corrupted by the other's later `registerFont()` call — see
"Multiple `Paginator` instances" above for the full picture, including the one part of this that's
still unavoidably page-global (`document.fonts`).

**Missing-font behavior is Standard-14-or-throw.** If a `TextNode`'s `fontFamily`/`fontWeight`/
`fontStyle` was never registered, `generatePdf()` (via `resolveStandardFontName()` in
`font-registry.ts`) checks whether the requested family names one of pdfkit's 14 standard fonts —
Helvetica, Times, Courier (each with regular/bold/italic/boldItalic variants), Symbol, or
ZapfDingbats. Those need no font file at all: pdfkit ships their AFM metrics inline, so every PDF
viewer already has them and `generatePdf()` can pass the name straight to `doc.font()`. Anything
else — a family that was neither registered via `registerFont()` nor names a Standard-14 font — makes
`generatePdf()` throw rather than silently substitute a different font's glyph widths (which would
otherwise make that text's fit/alignment in the PDF visibly drift from what pretext actually measured
on screen, even though the *line breaks themselves* were already fixed by pagination). The library's
own defaults (`DEFAULT_FONT_FAMILY` in `font-registry.ts` — the default `TextNode`/chart/watermark
family, and the row-group header default) are all Helvetica for exactly this reason: they're always
drawable with zero setup. Register every non-Standard-14 font actually used for guaranteed fidelity.

**Coordinate system.** `PaginatedResult`'s px values (96dpi, top-left origin, y-down — same as DOM)
convert to PDF points (72dpi, top-left origin, y-down — pdfkit applies a `1 0 0 -1 0 pageHeight` CTM
flip once per page internally, so its coordinate space already matches the DOM/px model) via one
uniform `PX_TO_PT = 0.75` factor (96/72) applied only at the final leaf draw call
(`toPdfRect`/`chartToPagePoint`) — no y-flip math anywhere in this file. Traversal itself accumulates
origins in px exactly like `shadow-dom.ts`'s `renderNode()`, so `pdf-render.ts`'s recursive shape is a
straight port of that file's, swapping `container.appendChild(styledDiv(...))` for pdfkit draw calls.
A4 794×1123px × 0.75 ≈ 595.5×842.25pt, matching the standard PDF A4 size — confirms the scale factor is
exact, not approximate.

**Text baseline.** pretext's `line.y = i * lineHeight` (`positionLines()`, `src/nodes/text.ts`) is the
TOP of each line's box, not a baseline. The actual PDF baseline is derived from the font's own ascent/
descent, approximating the CSS half-leading algorithm browsers use to lay a line box out around a
font's own metrics: `halfLeading = (lineHeight - (ascent+descent)) / 2`, `baselineFromTop = halfLeading
+ ascent`. Ascent/descent come from the BROWSER's own canvas (`measureFontMetricsPx()` in
`src/render/pdf-fonts.ts`, via `CanvasRenderingContext2D.measureText().fontBoundingBoxAscent/Descent` on the
exact same font CSS string `src/nodes/text.ts` uses) rather than the embedded font object's own metrics,
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
invariant #1. Note this rasterization applies even when `src` is itself an SVG — `ImageNode` has no
way to preserve vector fidelity; use `SvgNode` (`svg()`, raw markup instead of a `src`) when that
matters, which draws true vector output via `svg-to-pdfkit` instead (see its own doc section above).

**Charts** are redrawn using `chart-geometry.ts`'s own pure geometry/color helpers (`barPath`,
`pieSlicePath`, `donutSlicePath`, `resolveColor`, `niceTickValues`, `estimateTextWidth`,
`squarifyTreemap`, etc. — every one of these shared verbatim between the SVG and PDF renderers,
which is what keeps the two pixel-identical), only swapping SVG-element creation for pdfkit
draw calls (`.moveTo/.lineTo/.stroke` for lines, `.circle().fill()` for markers, `.path(d).fill()` for
bars/slices/candles/treemap rects). Unlike pdf-lib's `drawSvgPath()` (which flipped the SVG-vs-PDF y-axis
internally), pdfkit's `.path(d)` takes an SVG path string literally in whatever coordinate space is
currently active, with no coordinate reinterpretation of its own — confirmed empirically by inspecting
a generated PDF's raw content stream. So `chart-geometry.ts`'s `cx/cy/r/a0/a1`-based path strings (raw
px, anchored at the chart's own local origin) are fed to it completely unchanged, rounded bar corners
included, wrapped in a `save()`/`translate(originPt)`/`scale(PX_TO_PT)`/`restore()` content-matrix push
rather than any per-coordinate math — deliberately, since hand-rewriting the numbers inside an SVG path
string would be one misplaced digit away from corrupting an arc command's `0`/`1` flag fields. Chart
text (title/axis/legend) DOES go through the same font registry a `TextNode` gets — `resolveChartFontName()`
in `pdf-fonts.ts` mirrors `resolveTextFont()`, mapping `ChartNode.fontFamily` (default
`DEFAULT_FONT_FAMILY`, i.e. Helvetica) plus a binary bold/regular weight (chart text has no arbitrary
numeric weight the way body text does) through `lookupFont()`, falling back to the matching
Standard-14 name on a miss (or throwing if the family isn't Standard-14 either). `chart-geometry.ts`'s
own `estimateTextWidth` heuristic (no real
measurement, by design — see that file's header comment) is unaffected by this; it only ever
decides internal margins/truncation, never actual glyph rendering, so it never claimed font-exact
fidelity to begin with and doesn't need to.

**Viewing PDF bytes is entirely the consumer's responsibility** — this library stops at
`generatePdf()` returning a `Uint8Array`; opening it in a new tab, showing a preview dialog, or
triggering a download is plain browser-native code with no library API of its own (see `src/main.ts`'s
`openPdfInNewTab()`/`showPdfDialog()` for the demo's pattern: an object URL opened via `window.open()`,
or shown inside a native `<dialog>`/`<iframe>`, in the light DOM like the rest of the demo's toolbar
chrome — page chrome, not paginated content, so invariant #5 doesn't apply).

## Word/Excel export (`src/export/`)

A **third, independent export path**, structurally unlike PDF: `pdfDoc.generateDocx(doc, metadata?)`
and `pdfDoc.generateXlsx(doc, metadata?)` take the pre-pagination `PageDef` **directly** — not a
`PaginatedResult` — because Word and Excel each do their own reflow/pagination (or, for Excel, have
no pagination concept at all), so there is no pixel-box layout step to run first. This is a
deliberate, permanent asymmetry with `generatePdf(result, ...)`, not an oversight. Both walk the same
`Node` tree `paginate()` itself starts from, translating each node type into `docx`/`exceljs` library
primitives instead of pixel positions — the semantic content, not a picture of the paginated pages.

**Fidelity is semantic/reflowable, not pixel-perfect, by design.** Word gets real flowing paragraphs/
tables that Word paginates itself; Excel gets a real spreadsheet grid. Neither tries to reproduce
`PaginatedResult`'s exact page breaks/pixel boxes — that would fight against how both formats
actually work (Word reflows; Excel has no page-box model at all). Where a pixel-model concept (a row's
`gap`, a table's `cellPadding`) has no native equivalent in the target format, it's translated to the
*closest* real primitive (see below) rather than dropped silently.

File layout — a new top-level directory, not folded into `src/render/`, since these are standalone
tree-walkers with no dependency on `src/core/behavior.ts`'s registry (see "Extension seam" below —
a new custom node type does NOT need a docx/xlsx entry to keep working with `generatePdf`/`mount`):

```
src/export/
  docx-export.ts    — generateDocx(): the Node -> `docx` library translator (see below)
  xlsx-export.ts     — generateXlsx(): the Node -> ExcelJS translator (see below)
  find-tables.ts       — findTables(): depth-first walk collecting every table() node in the
                         semantic tree (recurses into group/container/table-cell content) — what
                         generateXlsx() uses to find its worksheets
  export-color.ts       — resolveExportColor()/toArgb(): a standalone, DOM-free CSS color resolver
                          (#hex and rgb()/rgba() only — falls back to black + a warning for named
                          colors/hsl()/hsla()) — deliberately NOT pdf-render.ts's resolvePdfColor,
                          which needs OffscreenCanvas and would make xlsx-export.ts untestable
                          under `bun test`
  node-to-text.ts        — flattenNodeToText(): best-effort plain-text reduction for content a
                          target genuinely can't hold structured (an xlsx cell; an unsupported
                          node type)
  table-grid.ts           — borderSides(): shared table-border grid math for BOTH exporters — a
                            TableNode's rows/cells are already grid-aligned (no pixel geometry,
                            unlike pdf-render.ts's interval-straddle math), so "does this cell's
                            edge get a line, and is it the inner or outer style" is pure row/col-
                            index adjacency against border.inner/border.outer's independent modes
  units.ts                 — pxToTwip()/pxToPt()/pxToExcelWidth()/pxToEmu(): unit conversions,
                             deliberately NOT imported from pdf-render.ts (pulls in pdfkit's
                             browser-standalone bundle at module scope) — small enough to duplicate
                             rather than drag pdfkit into the docx/xlsx bundle
```

### Excel export (`generateXlsx`, via [ExcelJS](https://github.com/exceljs/exceljs))

**Tables only, by design** — `findTables(doc.body)` collects every `table()` node anywhere in the
document; everything else (headings, paragraphs, images, charts) is not represented in the workbook
at all. **Throws** if the document has zero tables (a workbook with no sheets is an invalid file, not
a harmless empty result). One worksheet per table, positionally named `"Table 1"`, `"Table 2"`, ….

Reads `TableNode.rows` directly, same as the PDF/DOM table renderers — `.groups`/`.stripe` are
already fully desugared into a flat `rows` array by `table()`'s own builder (`core/nodes.ts`), so this
file never reimplements grouping/totals/striping. Column widths reuse the exact same
`resolveColumnWidths()` the PDF/DOM table renderers use (exported from `src/nodes/table/index.ts`),
converted px -> Excel's character-width unit (`≈ px / 7`, a documented approximation — Excel's own
unit is font-metric-based, not pixel-exact). `colSpan`/`rowSpan` -> `worksheet.mergeCells(...)`,
using `cell.__resolvedCol` exactly like the PDF/DOM renderers do. Text/richText cell content becomes
real ExcelJS rich-text cell values (preserving per-run bold/italic/color/underline/strike); anything
structurally nested (a group/container/table nested in a cell) falls back to `flattenNodeToText()`
with a one-time warning, since a spreadsheet cell can't host nested flex layout.

**Bundler-agnostic `Buffer` handling.** ExcelJS needs a global `Buffer` for its zip/xlsx encoding —
Bun (which runs `bun test`) implements it natively, but a browser bundle doesn't. Rather than a
Vite-specific polyfill plugin, `xlsx-export.ts` imports the plain `buffer` npm package (works
unmodified under any bundler) and shims `globalThis.Buffer` only if missing — no `vite.config.ts`
needed, and switching bundlers later requires no changes.

### Word export (`generateDocx`, via [`docx`](https://docx.js.org))

| Node type | Translation |
|---|---|
| `text`/`richText` | A `Paragraph` of `TextRun`s; a link run (`RichTextRun.href`) becomes a real `ExternalHyperlink` |
| `group` (column) | Children's blocks flattened in sequence — real vertical stacking, no trick needed |
| `group` (row) | An invisible (all-borders-`NONE`) single-row `Table`, one cell per child, widths from the same `resolveFlexWidths()` two-pass model `group.ts`'s own `layoutRow` uses — the standard reflowable-Word "cells side by side" trick |
| `container` | Same trick, a 1×1 table — its one cell carries `background`/`border`/`padding`, since a Paragraph can't. No `borderRadius` equivalent |
| `table` | A real `Table` — see below |
| `image` | Fetched via `fetch()` (works for URLs and `data:` URIs alike) and embedded as an `ImageRun`. An SVG-sourced `image()` is skipped with a warning (not yet rasterized) |
| `chart` | Rasterized — see below |
| `pageBreak` | `new PageBreak()` — a direct native equivalent, no faking needed |
| `separator` | A `Paragraph` with only a bottom border, its own line pinned to an exact height (see "gap" below) |
| `svg` | Skipped with a one-time warning (not yet implemented — rasterizing raw SVG markup, like `chart` already does, is the natural next step) |

**`gap` becomes a real spacer, not silently dropped.** A column group's `gap` has no meaning once
every child becomes an independent `Paragraph`/`Table` in a flat Word body (OOXML has no "gap between
siblings" concept, and a `Table` has no spacing-before/after property to set on itself) — so
`columnGroupToBlocks()` inserts an empty spacer `Paragraph` between consecutive children, its line
pinned to an *exact* twip value (`LineRuleType.EXACT`) regardless of font size. This is also why a
bare `separator()` with no explicit `margin` now shows real surrounding space where it previously
showed none — the parent's `gap` used to be silently dropped rather than degrading to *some* spacing.
A row group's `gap` becomes a right-margin trimmed from each non-last cell's own content area instead
(column widths are resolved against the FULL width, not width-minus-gap, so the table still spans it).

**`table()` cell translation** reads `node.rows` directly (same principle as xlsx). Cell *placement*
needs no manual merge-range math, unlike xlsx: the `docx` library's own `Table` constructor
auto-inserts `vMerge` "continue" cells for any `rowSpan > 1` cell into the following physical row(s),
given rows whose `children` list only the cells that START there — exactly the implicit-flow shape
`TableRow.cells` already has. Border *sides* still need grid awareness (top/bottom/left/right
adjacency via `table-grid.ts`'s `borderSides()`, shared with xlsx), since that's about which edges get
a line, independent of how placement resolves. `cellPadding`/`column.padding`/`cell.padding` resolve
with the same precedence `table/layout.ts`'s `layoutCell` uses (`cell ?? column ?? table`) and become
docx `margins` (a `TableCell`'s direct analog of padding). **Known limitation**: `docx` copies a
rowSpan cell's `borders` verbatim onto every auto-inserted continuation cell, so a "this cell's merged
block ends here" bottom border can repeat at every physical row inside the span rather than only its
true bottom edge — rare (colSpan/rowSpan + `border.inner`/`border.outer` drawing at that edge together), accepted as a
known cosmetic limitation. Cell content goes through the exact same node-to-blocks recursion as
everything else in the document (a group/container/table nested in a cell gets real paragraph breaks
and real per-run styling, not a flattened single-style string).

**Page-number sentinel convention.** `PageDef.header`/`footer` are resolved ONCE, with a placeholder
`{ pageNumber: 1, totalPages: 1 }` context (same convention `core/nodes.ts` already documents for
`headerHeight`/`footerHeight` auto-computation) — since Word paginates the body itself, a literal
page number baked in at export time would be wrong past page 1. To get a LIVE page number in Word,
put the literal substrings `'{{pageNumber}}'`/`'{{totalPages}}'` in header/footer text; `generateDocx`
splices these into docx's own `PageNumber.CURRENT`/`PageNumber.TOTAL_PAGES` fields (rendered as real
`PAGE`/`NUMPAGES` field codes). Header/footer text that doesn't use the sentinel renders as literal,
computed-once text — correct for a static label, wrong (frozen at "1") for an actual running count.
The demo's own footer (`src/main.ts`) intentionally keeps its real-`pageNumber`-interpolating PDF/DOM
footer separate from a sentinel-based `docxFooter()` used only for the `generateDocx()` call, since
the same `PageDef.footer` function drives both the correctly-per-page PDF/DOM output and the
once-resolved Word output.

**Chart rendering reuses `chart-render.ts`'s existing DOM/SVG renderer** (`renderChartSvg()`) — the
same code the on-screen preview draws with, needing no chart-specific drawing logic of its own,
covering all 7 chart kinds through that one entry point. The returned `<svg>` is serialized to a
string, rasterized via canvas into a PNG (at `CHART_RASTER_SCALE` = 2× the logical display size for
crisper output, the same "export at 2x" convention `generatePdf`'s own image embedding uses — see
"Images" above), then embedded exactly like a regular `image()` node. **`createImageBitmap()` on an
SVG `Blob` is unreliable** (fails with "the source image could not be decoded" even for trivially
valid SVG, confirmed in headless Chromium) — loading through a plain `<img>` with a `data:` URI
first, THEN drawing that onto the canvas, is the broadly-supported path used instead. Needs a real DOM
(`document.createElementNS`, used inside `renderChartSvg`) in addition to `OffscreenCanvas` —
unavailable under `bun test` — so this degrades gracefully: warns once and skips in that environment,
but works in any real browser (verified: extracted and visually inspected embedded chart PNGs from a
real exported `.docx`).

**Explicitly NOT applied, by design:** `PageDef.background` (no clean Word equivalent — skipped with
a one-time warning) and `PageDef.border` (a page border WAS implemented at one point via docx's
`pageBorderTop/Right/Bottom/Left`, then deliberately removed — it's resolved once against a
placeholder page count that has no relationship to however many pages Word actually reflows the
content into, so keeping it would have been quietly wrong for any multi-page document). `PageDef.
watermark` rasterization is implemented but currently **disabled** in `docx-export.ts` (the call site
in `generateDocx()` and the watermark section are commented out, along with their now-unused imports)
— the code follows the same "rasterize via canvas, embed as a floating behind-text image in the
document header" approach as chart rendering, tiling via the same `resolveWatermarkInstances()` the
PDF/DOM renderers already share; re-enabling it means uncommenting the import block, the watermark
section, and the `watermarkRuns` line in `generateDocx()` together.

**Testability.** Both exporters avoid `measureNodeHeight`/pretext/canvas entirely — they read
`TextNode.content`/`RichTextRun.runs` as plain data, never measure it — so most of both files run
under `bun test` with no browser required (see `test/xlsx-export.test.ts`/`test/docx-export.test.ts`).
`generateXlsx()`'s output round-trips through ExcelJS's own reader for structural assertions;
`generateDocx()`'s output (a standard OOXML zip) is unzipped and asserted on via `word/document.xml`
substring checks, since `docx` has no object-model "load back" API. The two genuinely browser-only
paths — chart rasterization and `ImageNode`'s `fetch()` for non-`data:` sources — degrade to a
one-time warning + skip rather than throwing, so a document containing them still exports successfully
under `bun test`; real rendering is verified separately in an actual browser (Playwright).

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
| `metadata?: Record<string, unknown>` | nothing — never read by paginator itself | Arbitrary caller data, along for the ride on `node`. Read it back off `InteractionTarget.node.metadata` in any event handler to recover app-specific context (e.g. a record id) without a side-table keyed by node identity |
| `id?: string` | nothing directly — resolved via `findById()` | No uniqueness enforced (caller's responsibility). Splitting clones a node's continuation onto each new page, so one authored node with an `id` can produce several matches; `findById()` always returns an array, ordered by page |

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

`findById()` is the non-geometric counterpart: instead of resolving a point, it walks the whole
registry looking for nodes whose `id` matches, independent of `interactive`/`droppable`. Useful for
things like a table of contents — build the registry once, then look up an authored `id` to find
which page(s)/box(es) it landed on.

`findFragments(registry, target)` is `findById()`'s automatic sibling, for the common case of "I
just hovered/clicked one fragment of a node — give me every fragment of that same node." It
requires no authored `id` at all: `splitNode()` (`core/behavior.ts`) already stamps every fragment
produced by a split with a shared internal lineage id, independent of the caller-facing `id`, so
`findFragments()` just resolves that instead. A node that was never split has no such id, so this
degrades to `[target]` — always safe to call unconditionally, e.g. on every `hover` handler, to
highlight a split node's fragments across every page it spans instead of just the one under the
pointer.

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

Every node type — measurement, splitting, DOM rendering, and PDF drawing — lives together in
`src/nodes/`, one module (or, for the two largest types, one folder) per type, each registering
itself with `src/core/behavior.ts`'s registry as an import side effect. See "Extension seam" below
for the full contract; this section is just the map of where everything lives. `src/export/`
(Word/Excel) is the one exception to the registry pattern — see "Word/Excel export" above for why.

```
src/
  core/
    nodes.ts             — Node union, Interactive shared fields, PageDef, builder functions
    geometry.ts           — Box, RenderedNode union, translateRendered()
    behavior.ts            — the registry itself: NodeTypeDefinition interface, registerNode(), and
                              the generic dispatchers every node type is reached through
                              (measureNodeHeight/layoutNodeFull/splitNode/isSplittable/naturalWidth/
                              renderNodeDom/drawPdfNode) — see "Extension seam" below. Deliberately
                              never imports a concrete node module (only types), which is what lets
                              every node module import ITS generic dispatchers with no ESM cycle
    flex-widths.ts          — resolveFlexWidths()/RowChildSizing: the shared two-pass flex-grow math
                              behind both a ROW group's child widths (src/nodes/group.ts) and a
                              table's column widths (src/nodes/table/layout.ts)
    page-sizes.ts           — PAGE_SIZE_PRESETS, resolvePageSize()
    paginate.ts              — paginateNode(), two-pass header/footer, paginate() — dispatches
                               purely through behavior.ts's generic functions, never switches on
                               node.type itself except the one bare-top-level-page-break special case
    watermark-layout.ts       — resolveWatermarkInstances() (tiling math for Watermark, not a Node)
  nodes/                      — one node type per module/folder; importing src/nodes/index.ts (once,
                                 done for you by src/index.ts) registers all of them
    index.ts                   — side-effect barrel: one `import './<type>.ts'` line per type
    text.ts                     — pretext adapter (streamLines(), measureTextNaturalWidth), DOM
                                   rendering, PDF drawing (drawTextNode, baseline math)
    rich-text.ts                  — @chenglou/pretext/rich-inline adapter, mirrors text.ts's shape
                                     for mixed-style runs; also the PDF `.link()` annotation for
                                     RichTextRun.href
    separator.ts                   — separatorMainSize(); a separator's ROW-context box is actually
                                      resolved by group.ts's own layoutRow/layoutColumn, not here —
                                      see "Common pitfalls"
    page-break.ts                   — trivial: zero size, no-op render/draw
    image.ts                         — imageNaturalWidth(), height-resolution rules, PDF
                                       rasterize-and-embed (embedImage, shared with the page
                                       watermark's own image path in pdf-render.ts)
    svg.ts                             — svgNaturalWidth(); DOM path parses+inserts real markup
                                         (strict), PDF path goes through svg-to-pdfkit (lenient)
    container.ts                        — containerNaturalWidth(); height is a MINIMUM
                                          (targetHeight-as-floor, same pattern layoutColumn uses);
                                          isSplittable delegates to its child via behavior.ts's own
                                          generic isSplittable() — safe now, no cycle to avoid
    group.ts                              — layoutColumn(), layoutRow(), columnGroupSplit(),
                                            rowGroupSplit(), subtreeHasPageBreak(),
                                            childCrossWidthInColumn() (exported — table/layout.ts
                                            needs it too)
    table/
      layout.ts                            — column flex-width resolution, cell alignment,
                                             header-row-repeat split (resolveColumnWidths, exported
                                             for table/dom.ts + table/pdf.ts)
      dom.ts                                 — renderTableNode()/renderTableBorders() (background/
                                               border line segments via interval-subtraction)
      pdf.ts                                  — drawTableNode()/drawTableBorders(), same math as
                                               dom.ts, pdfkit draw calls instead of styled divs
      index.ts                                 — wires layout.ts/dom.ts/pdf.ts into one
                                                registerNode('table', {...}) call
    chart/
      layout.ts                                 — chartNaturalWidth(), same height-resolution shape
                                                  as image.ts (kind-agnostic — unaffected by which
                                                  of the 7 chartKinds this is)
      dom.ts                                      — thin wrapper around chart-render.ts's
                                                    renderChartSvg()
      pdf.ts                                        — drawChartNode() entry point (title/legend
                                                      layout + dispatch by chartKind) + shared
                                                      pdfkit-draw primitives (drawChartPath,
                                                      drawChartText, drawChartLegend, ...)
      pdf-categorical.ts, pdf-radial.ts,               — one file per chartKind, each a port of its
      pdf-scatter.ts, pdf-gantt.ts,                     matching chart-render-<kind>.ts (SVG) file
      pdf-radar.ts, pdf-candlestick.ts,                 to pdfkit calls, reusing chart-geometry.ts's
      pdf-treemap.ts                                    pure helpers unchanged
      index.ts                                       — wires layout.ts/dom.ts/pdf.ts into one
                                                       registerNode('chart', {...}) call
  render/
    shadow-dom.ts                  — mount(), renderPreview(), styledDiv(), page
                                      watermark painting. No longer contains any per-node-type
                                      rendering or a renderNode() dispatcher — every node type's
                                      renderDom() is reached through behavior.ts's renderNodeDom()
    chart-render.ts                 — renderChartSvg() entry point (title/legend layout + dispatch
                                       by chartKind) + DOM-only primitives (svgEl/svgText, the
                                       area-fill-gradient <defs> helpers, renderLegend); fixed
                                       heuristic margins throughout (no text measurement — see its
                                       header comment)
    chart-render-categorical.ts,      — one file per chartKind's own SVG rendering logic
    chart-render-radial.ts,
    chart-render-scatter.ts,
    chart-render-gantt.ts,
    chart-render-radar.ts,
    chart-render-candlestick.ts,
    chart-render-treemap.ts
    chart-geometry.ts               — every pure, DOM/pdfkit-agnostic geometry/color/text-estimate
                                       helper + constant shared verbatim by every chart-render-*.ts
                                       AND every src/nodes/chart/pdf-*.ts file (barPath,
                                       pieSlicePath, resolveRingSliceAngles, resolveChartDomain,
                                       resolveBubbleRadius, radarPolygonPoints, candlestickGeometry,
                                       squarifyTreemap, default categorical palette from the
                                       dataviz skill, ...) — this single shared module is what keeps
                                       the on-screen SVG and the exported PDF pixel-identical
    reset.ts                        — BASE_ELEMENT_STYLE
    interval-utils.ts                — subtractIntervals()/BORDER_EPSILON, shared by
                                        src/nodes/table/dom.ts's and .../pdf.ts's border-segment math
    font-registry.ts                  — registerFont()/lookupFont()/listRegisteredFonts(): fetch-once
                                         FontFace registration (on-screen use) + retained bytes (later
                                         PDF embedding), all operating on an explicit `FontRegistry`
                                         map argument rather than module state — `../paginator.ts`
                                         owns the actual Map instance, see "PDF export" above
    pdf-fonts.ts                       — PDF font-name resolution shared by every text-drawing node
                                         type (resolveTextFont/resolveRunFont/resolveChartFontName,
                                         ensureRegisteredFont, pickFallbackFont, measureFontMetricsPx)
                                         — split out of pdf-render.ts so a node module doesn't need
                                         to depend on the whole generatePdf() orchestrator
    pdf-render.ts                      — generatePdf(): vector PDF via pdfkit. Owns the doc-level
                                          orchestration, PdfContext (exported), generic unit/color
                                          plumbing (pxToPt/resolvePdfColor/toPdfRect), image embedding
                                          (embedImage, shared with src/nodes/image.ts), and the page
                                          watermark (not a Node, so it has nowhere else to live). No
                                          longer contains any per-node-type drawing or a drawNode()
                                          dispatcher — every node type's drawPdf() is reached through
                                          behavior.ts's drawPdfNode()
    zoom.ts                             — createZoomController(): headless CSS-transform zoom state
                                           (getZoom/setZoom/zoomIn/zoomOut/reset), no UI of its own
  interaction/
    types.ts                         — InteractionTarget, all event payload types, InteractionController
    hit-registry.ts                   — buildHitRegistry(), hitTest(), hitTestDroppable(), findById(),
                                          findFragments(), toTypeList()
    attach-interactions.ts             — attachInteractions(): pointer event state machine (hover/
                                          click/drag/drop, threshold, dragTypes, overDropTarget)
  export/                             — Word/Excel export (see "Word/Excel export" above) —
                                         standalone Node-tree walkers, no dependency on
                                         core/behavior.ts's registry
    docx-export.ts                    — generateDocx(): Node -> `docx` library primitives
    xlsx-export.ts                     — generateXlsx(): Node -> ExcelJS primitives (tables only)
    find-tables.ts                      — findTables(): depth-first table() collector for xlsx
    export-color.ts                      — resolveExportColor()/toArgb(): standalone DOM-free color
                                           resolution (#hex/rgb() only)
    node-to-text.ts                       — flattenNodeToText(): best-effort plain-text fallback
    table-grid.ts                          — borderSides(): shared table-border grid math
    units.ts                                — pxToTwip()/pxToPt()/pxToExcelWidth()/pxToEmu()
  ready.ts                             — ready() (awaits document.fonts.ready)
  paginator.ts                          — Paginator class: the public facade. Owns a per-instance
                                           font registry (Map) and exposes paginate()/mount()/
                                           renderPreview()/attachInteractions()/the hit-registry
                                           functions/generatePdf()/generateDocx()/generateXlsx()/
                                           registerFont()/listRegisteredFonts() as instance methods,
                                           delegating to the (unchanged) functions in
                                           core/render/interaction/export. Only registerFont/
                                           listRegisteredFonts/generatePdf actually touch instance
                                           state — everything else (including generateDocx/
                                           generateXlsx) is grouped here for one consistent surface
                                           (see "Multiple Paginator instances")
  index.ts                              — public API surface (only file most consumers should import
                                           from): node builders + types, ready(), setLocale/
                                           clearCache (pretext's own globals), and Paginator. Its
                                           first line imports src/nodes/index.ts so every built-in
                                           node type is registered before anything else runs
  main.ts                               — demo app exercising every feature (see below)
```

`main.ts` is a living demo/test bed, not shipped library code — it builds one large document that
exercises: multi-page text splitting, `textDecoration` (underline/line-through), header/footer with
"Page X of Y", CSS-isolation demonstration, row/column groups with all alignment modes, `flex`
sizing (default/weighted/fixed), `splitColumns` independent column splitting, `pageBreak()`, a
Containers section (background/border/borderRadius/padding card, a badge row sized via `flex`, a
chart wrapped in a container to show background/border "for free," `height`-as-minimum in both
directions, a container split across a page boundary, a container nested in a table cell, and an
interactive/draggable container), `Image` with `aspectRatio`, all `objectFit` values, `borderRadius`,
and `opacity`, a multi-page `table()` with header-row repetition, nested-group cells, cell/row/
column background + alignment, cell-level interaction delegation, a second table demonstrating
column grouping (nested Warehouse/Status groups, `totals()` at both levels, a custom `header()` at
one level and the library default at the other, and non-adjacent duplicate group values proving
the "global regroup by value" semantics), a third (receipt-style) table demonstrating `colSpan`/
`rowSpan` (a quantity cell spanning two physical rows, a product-name cell spanning two columns)
combined WITH column grouping (by category) in the same table — proving the two features coexist —
a fourth table demonstrating per-cell `border`, per-column `padding`/`verticalAlign`, and `stripe`
zebra striping, chart theming (`axis`/`legend` colors, a custom `fontFamily`, `barCornerRadius`/
`lineStrokeWidth`/`markerRadius`), and the full interaction system (bubble-up, specific-child-wins,
drag preview, typed drag-and-drop with live valid/invalid highlighting). "Open PDF"/"Preview PDF"
buttons exercise `generatePdf()`; "Export Word"/"Export Excel" buttons exercise `generateDocx()`/
`generateXlsx()` (the Word export swaps in a sentinel-based `docxFooter()` for its live page-number
field — see "Word/Excel export" above — rather than reusing the PDF/DOM footer's real-number one).
Reading it top to bottom is a good way to see every API in realistic use.

## Extension seam — adding a new node type

Every built-in node type — `text`/`richText`/`separator`/`page-break`/`image`/`svg`/`table`/`chart`/
`container`/`group` — plugs into pagination, DOM rendering, and PDF drawing purely by calling
`registerNode()` once (`src/core/behavior.ts`). `paginate.ts`, `shadow-dom.ts`, and `pdf-render.ts`
never switch on `node.type` themselves; they only ever dispatch through behavior.ts's generic
functions (`measureNodeHeight`/`layoutNodeFull`/`splitNode`/`isSplittable`/`naturalWidth`/
`renderNodeDom`/`drawPdfNode`), which do a plain registry lookup. Nothing in any of those three files
needs to change when you add a new type.

`src/nodes/table/` and `src/nodes/chart/` are worked examples of a node that holds MULTIPLE pieces of
nested content (cells, series) big enough to warrant splitting `layout.ts`/`dom.ts`/`pdf.ts` into
their own folder. `src/nodes/container.ts` is a worked example of the other shape — exactly ONE
child, no array. `src/nodes/rich-text.ts` is a worked example of a splittable leaf whose internal
content is itself an array requiring a dedicated measurement library adapter
(`@chenglou/pretext/rich-inline`). Read whichever is closest to what you're adding, alongside the
steps below. Still not implemented: a generic `CustomNode` escape hatch for registering a type at
runtime without extending the `Node` union at all (the union stays closed/type-safe by design — see
`behavior.ts`'s own header comment). To add a new built-in type:

1. Add the new variant to the `Node` union in `nodes.ts` (extend `Interactive` like the others if
   it should support hover/click/drag), plus a matching variant to `RenderedNode` in `geometry.ts`.
2. Create `src/nodes/<type>.ts` (or a folder, `layout.ts`/`dom.ts`/`pdf.ts`/`index.ts`, if it's big
   enough to want the split) implementing `NodeTypeDefinition<YourNode, YourRenderedNode>`
   (`behavior.ts`): `measureHeight`, `isSplittable`, optionally `split`, `layout`, optionally
   `naturalWidth` (shrink-wrap width for column/cell placement — omit it to mean "wants the full
   width offered," the default separator/page-break/table already rely on), `renderDom`, `drawPdf`.
   Follow the pattern in `src/nodes/separator.ts`/`image.ts` (simple, non-splittable, no nested
   content) or `text.ts` (splittable). If your type recurses into arbitrary child content (like
   `container`/`group`/`table`), call the generic `measureNodeHeight`/`layoutNodeFull`/
   `isSplittable`/`splitNode`/`renderNodeDom`/`drawPdfNode` from `behavior.ts` for those
   children — there's no cycle to avoid; `behavior.ts` never imports concrete node modules, so any
   node module can safely import its dispatchers.
3. Call `registerNode('<type>', {...})` once at the bottom of your new module.
4. Add one `import './<type>.ts'` line to `src/nodes/index.ts`.
5. If cells/children of your new type should support `interactive`/`draggable`/`droppable`, add a
   traversal branch to `hit-registry.ts`'s `flatten()` (see `table`'s branch there) — this alone is
   the entire "interaction delegation" mechanism, no new predicate or event type needed.
6. If your `RenderedNode` variant nests other `RenderedNode`s (a wrapper/container shape), add one
   branch to `geometry.ts`'s `translateRendered()` — the one place that's still a small,
   deliberately manual if-chain rather than part of the registry, since it's keyed on "does this
   shape nest other rendered children" (true for `group`/`table`/`container` today), not on type
   identity, and most new leaf types need zero change here.
7. Export the builder + types from `index.ts`.

**No changes to `paginate.ts`, `shadow-dom.ts`, or `pdf-render.ts` are needed** for a new node
type, splittable or not — this is the entire point of the registry pattern.

## Known limitations (documented, not bugs)

- `setLocale`/`clearCache` (pretext's own state) and the built-in node-type registry
  (`core/behavior.ts`) are process-global, not scoped to any `Paginator` instance — by design
  (an external dependency's own global, and a schema/plugin-level table, respectively). Only the
  font registry needed per-instance isolation and got it; see "Multiple `Paginator` instances" above
  for the full list of what's shared vs. per-instance, and the one remaining `document.fonts` caveat.
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
- PDF export: `resolvePdfColor()` accepts hex (`#rgb`/`#rrggbb`/`#rrggbbaa`, alpha dropped) directly,
  and resolves anything else CSS accepts as a color (`rgb()`/`rgba()`/`hsl()`/`hsla()`/named
  keywords/etc., alpha dropped the same way) via `normalizeCssColor()` — a canvas 2D `fillStyle`
  round-trip that delegates to the browser's own CSS color parser rather than a hand-written
  named-color table or an hsl->rgb converter, same "trust the browser's own engine" approach
  `measureFontMetricsPx()` already uses for font metrics. A string that isn't a valid CSS color at
  all still falls back to black with a `console.warn`. An unregistered font falls back to the matching
  Standard-14 name (Helvetica/Times/Courier/Symbol/ZapfDingbats — no file needed) and otherwise throws
  (see "PDF export" above) rather than silently substituting a font pretext never measured against.
  Registered fonts ARE subsetted
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
- `ContainerNode.height` is a MINIMUM, not an exact/clipped size — deliberately, so no clip-region
  code is needed in either renderer and content is never silently lost. If you want a true fixed-
  and-clipped box, it isn't supported.
- `TableNode.border.outer.borderRadius` only works with `outer.mode: 'all'` (`table()` throws for
  `'horizontal'`/`'vertical'`/`'none'`, since no closed rectangle exists to round there) — it real-
  clips cell/row/header content to the rounded outer shape, same technique as `ContainerNode.
  borderRadius`. docx/xlsx exports ignore it (square corners, one-time warning) since neither format
  has a rounded-border primitive — they also ignore `border.headerSeparator` and any row's
  `topBorder`/`bottomBorder` entirely (each skipped with its own one-time warning; the ordinary
  inner/outer grid still draws at that boundary instead), though they DO support `border.inner`/
  `border.outer` resolving to independently different thickness/color/style, via real per-edge
  `IBorderOptions`/`ExcelJS.Borders`. `TableCell.border` (per-cell) draws a complete, independent
  rectangle rather than a shared-edge line, so two adjacent bordered cells show a double-thickness
  line between them by design — still no `borderRadius` there (a rounded corner on one cell in a
  shared grid has no well-defined meaning next to its square neighbors).
- `TextNode.align` has no `'justify'` option — true justify needs per-word spacing distribution,
  which needs word-boundary data pretext's `LayoutLine` doesn't currently expose; not attempted
  without first investigating pretext's own API.
- `RichTextNode`'s mixed-style runs share ONE baseline per line, computed from the node's own
  default font (`fontFamily`/`fontSize`/`fontStyle`), not a per-run ascent-aware CSS-style vertical
  alignment — mixing run font *sizes* on the same line doesn't reflow the baseline the way a
  browser's native inline formatting would. This matches `@chenglou/pretext/rich-inline`'s own model
  (`lineHeight` is a single caller-supplied layout input, not derived per-fragment), not a bug
  specific to this renderer. Link runs (`RichTextRun.href`) are deliberately NOT part of the generic
  interactive/hit-registry system — they render as a real `<a href>` on screen and a real pdfkit
  `.link()` annotation in the PDF, both natively clickable without any custom hit-testing.
- `ImageNode` has no filters/tint (grayscale, sepia, color overlay) — would need a canvas filter
  graph on the DOM side and per-pixel raster work in `rasterizeImageToPng` on the PDF side.
- No rotation or transform support anywhere in the node model — e.g. a diagonal watermark isn't
  buildable; `PageDef.background` covers a solid-color page background, nothing rotated on top of it.
- Word/Excel export (`src/export/`, see full section above): `generateXlsx()` is tables-only —
  headings/paragraphs/images/charts elsewhere in the document aren't represented in the workbook at
  all, and **throws** if the document has zero tables. `generateDocx()` doesn't support `svg` nodes
  or an SVG-sourced `image()` (both skipped with a warning), doesn't apply `PageDef.background`/
  `border` (skipped/removed — see "Word/Excel export" above for why border was deliberately removed
  after being implemented), and currently ships with `PageDef.watermark` rendering **disabled**
  (implemented, but commented out in `docx-export.ts`). Chart rasterization needs a real DOM +
  `OffscreenCanvas` (unavailable under `bun test`) — degrades to a warning + skip rather than
  throwing. A `rowSpan` cell's border can incorrectly repeat at every physical row it spans (docx
  copies `borders` verbatim onto every auto-inserted continuation cell) rather than only its true
  bottom edge — rare (needs colSpan/rowSpan + `border.inner`/`border.outer` drawing at that edge together). Excel cell
  `padding` has no real equivalent (spreadsheets have no box-model padding concept) and is
  approximated via `alignment.indent` at best. Both exporters' color resolution (`export-color.ts`)
  only understands `#hex`/`rgb()`/`rgba()` — named CSS colors and `hsl()`/`hsla()` fall back to black
  with a warning (narrower than `generatePdf`'s `resolvePdfColor`, which resolves any valid CSS color
  via the browser's own parser — see "PDF export" above).

## Common pitfalls (bugs caught during development — don't reintroduce)

- **Separator orientation**: a separator's box means different things in row vs. column context
  (horizontal-bar vs. vertical-bar). `src/nodes/group.ts`'s `layoutResolvedChild()` must use the
  already-resolved box from `layoutRow`/`layoutColumn` directly for separators, never recompute via
  the registered separator `layout()` generically — that function only knows the column orientation
  and would silently discard a row separator's stretched height.
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
- **Nested `crossAlign: 'stretch'` silently inert**: `childCrossWidthInColumn()` (`src/nodes/group.ts`)
  computes the shrink-wrapped width a column hands to a nested group child. It already special-cased
  a nested *row* with a flexible child (the row branch of `shrinkWrapWidth()` — see the pitfall
  below) as wanting full width, but originally had no equivalent check for a nested *column* — so
  `group({ direction: 'column', crossAlign: 'stretch' })` nested inside a shrink-wrapping ancestor
  got boxed to its content's natural width one level up, and the inner `stretch` had nothing left to
  stretch into. Fixed by checking `node.crossAlign === 'stretch'` alongside the row case. Symptom to
  watch for: a single short text child with `align: 'center'`/`'right'` that visually stays
  flush-left no matter what — the giveaway is that its box width already equals the text's own
  width. A per-child `alignSelf: 'stretch'` (see "Per-child `alignSelf` override" above) is now the
  direct fix for this same symptom — set it on the one child that needs full width instead of
  reaching for an ancestor `crossAlign: 'stretch'` wrapper, which affects every sibling too.
- **Nested row's shrink-wrap width bailing out to "full width" whenever it had a flex child**:
  `shrinkWrapWidth()`'s row branch (`src/nodes/group.ts`) used to treat ANY row with a default-flex
  child (i.e. almost any row of plain, width-less content — a label/value text pair is the ordinary
  case) as having no natural width of its own, returning the full width handed down instead of a
  content-derived size. That inflated "natural width" then flowed into a `flex: 'shrink'` ancestor
  column's own size via `resolveRowChildSizing`'s `'shrink'` case, so the column claimed ~all the
  available width and starved its `flex: 1` sibling column down to 0. Fixed by having the row's
  natural width SUM each child's own contribution instead of bailing out — fixed children via
  `resolveRowChildSizing`'s existing 'fixed' resolution, flex children via their OWN
  recursively-computed `shrinkWrapWidth()` (`sumNaturalRowWidth()`, replacing the old
  `rowHasFlexChild`/`sumFixedRowWidth` pair). Symptom to watch for: a `flex: 'shrink'` column
  sibling getting width 0 as soon as its shrink-wrapped column contains any nested row of ordinary
  (width-less) content, even though the same column works fine with a single non-row child.
- **The old `group-layout.ts` ↔ `table-layout.ts` cycle is gone — don't reintroduce a peer-file
  cycle "for convenience"**: an earlier version of this codebase had `group-layout.ts` and
  `table-layout.ts` import each other's exported measurer to lay out a group nested in a table cell
  and a table nested in a row/column, respectively, safe only because both sides referenced the
  other exclusively inside function bodies, never at module top level. That whole class of problem
  was eliminated by having `behavior.ts` never import any concrete node module (only types) — every
  node module (`src/nodes/group.ts`, `src/nodes/table/layout.ts`, `src/nodes/container.ts`, ...) now
  imports the GENERIC dispatchers (`measureNodeHeight`/`layoutNodeFull`/`isSplittable`/`splitNode`/
  `renderNodeDom`/`drawPdfNode`) from `behavior.ts` directly, with nothing to cycle against. Don't
  reach for a direct peer-to-peer import between two node modules to "avoid the indirection" —
  that's exactly the pattern this refactor removed, and reintroducing it reopens the same
  TDZ-crash risk the old comment warned about.
- **`table/layout.ts`'s split "rendered" node matches group/text's convention — don't slice it**:
  an earlier version deliberately SLICED the table split's `rendered.node` to just the rows placed
  on that page (unlike `columnGroupSplit`/text's `split()`, which keep the FULL original node
  always), because the DOM renderer used to resolve per-cell background by indexing
  `node.rows[r]`/`node.columns[c]` positionally against `rendered.rows[r]` — which only worked if
  the two stayed index-aligned. Column grouping's synthesized header rows (no corresponding
  `node.rows[r]` entry at all) broke that invariant, so background/border resolution moved to
  *layout time* instead (baked directly into `RenderedTableCell`/`RenderedTableRow` — see "Column
  grouping" above), and the slice was reverted to the full, unsliced node. This also fixed a real
  inconsistency: hit-testing a whole `interactive: true` table (not a per-cell delegate) used to
  expose the sliced, current-page-only node via `InteractionTarget.node`, unlike every other
  splittable node type. If you ever touch `splitTable()` (`src/nodes/table/layout.ts`), keep
  `rendered.node` as the full original — reintroducing the slice would silently break
  `InteractionTarget.node` again.
- **pdfkit's own `underline`/`strike` `.text()` options throw `"unsupported number: NaN"` under
  this codebase's positioning model** — `drawPdf()` (`src/nodes/text.ts`) already calls `.text()`
  with `lineBreak: false` and a hand-computed `baseline: 0` position per line (needed to reproduce
  pretext's already-decided line breaks exactly, see "PDF export" above), and pdfkit's internal
  underline/strike line-extent computation depends on state that path never populates — reproduces
  regardless of font (registered or fallback), confirmed by isolating the exact same `.text()` call
  with only `underline: true` added. Fixed by drawing the decoration line by hand instead, using
  each line's own already-known `line.width` — the same manual-line approach `src/nodes/chart/pdf.ts`'s
  `drawChartLine` already uses. Don't reach for pdfkit's built-in options here again without
  re-verifying against this failure mode first.
