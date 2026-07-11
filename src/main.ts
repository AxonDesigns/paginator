import './style.css'
import {
  chart,
  container,
  definePage,
  group,
  image,
  pageBreak,
  Paginator,
  ready,
  richText,
  rowGroup,
  separator,
  svg,
  table,
  text,
} from './index.ts'
import type { InteractionTarget, PageDef, PaginatedResult, TableCell, TableColumn, TableRow, ZoomController } from './index.ts'

// Raw TrueType files in public/fonts/ — see public/fonts/README.md for provenance/license.
// registerFont() also accepts .woff/.woff2 directly; these are .ttf simply because that's how they
// were originally sourced/converted for this demo.
const INTER_REGULAR_URL = '/fonts/inter-latin-400-normal.ttf'
const INTER_BOLD_URL = '/fonts/inter-latin-700-normal.ttf'
const SOURCE_SERIF_REGULAR_URL = '/fonts/source-serif-4-latin-400-normal.ttf'
const SOURCE_SERIF_BOLD_URL = '/fonts/source-serif-4-latin-700-normal.ttf'

// Registered via registerFont() in main() below, before paginate() — the same font FILE then backs
// both on-screen canvas measurement/rendering and generatePdf()'s embedded PDF glyphs, which is what
// makes the two outputs' text layout identical (see font-registry.ts's header comment). The fallback
// stacks after each registered family are pre-load paint safety only; registerFont() always resolves
// before paginate() runs, so the registered font is what's actually measured.
const BODY_FONT = '"Source Serif 4", Georgia, "Iowan Old Style", serif'
const UI_FONT = 'Inter, Arial, Helvetica, sans-serif'

const longParagraph1 = `Pretext exploits an asymmetry the browser has always had but never exposed: canvas measureText resolves against the exact same font engine as DOM rendering, yet carries none of DOM layout's reflow penalty. When text first appears, pretext measures every segment once via canvas and caches the widths. After that one-time preparation pass, laying text out at any width and any line height is pure arithmetic over cached numbers — no synchronous layout, no forced reflow, no dependency on how many other elements exist on the page. This document's pagination is built entirely on that arithmetic: every line break, every page break, and every box position below was computed before a single DOM node existed, then painted once, flat, and absolute.`

const longParagraph2 = `A paragraph long enough to overflow a page is not a special case here — it is the same recursive rule applied again. The pagination engine asks a splittable node for as many lines (or, for a vertical group, as many children) as fit in the remaining space on the current page. Whatever is left over becomes a continuation node carried forward: for text, that continuation is nothing more than a saved cursor into the already-prepared segment stream, so pretext resumes exactly where it left off with no re-measurement, no duplicated words, and no dropped characters. The same paragraph you are reading now may cross a page boundary right in the middle of a sentence, and if it does, the words on the far side of that boundary are the literal continuation of this cursor, not a re-flowed approximation of it. Below this paragraph, a labelled row demonstrates horizontal grouping with space-between alignment and a stretched vertical divider, and after that, a second long paragraph continues pushing content past the bottom of this page to force a second page break, and a third page break beyond that, so you can see the header and footer repeat correctly with an accurate "Page X of Y" count that could only be known after the entire document had already been paginated once.`

const longParagraph3 = `Every element on every page in this demo — including this paragraph, this page's header, and its footer — is styled entirely through inline styles inside an open shadow root, with no class name and no <style> tag anywhere in the tree. That is deliberate: a shadow boundary already prevents host-page stylesheets (Tailwind's Preflight reset among them) from ever matching anything inside, and setting box-sizing, margin, padding, font, and color inline on every single node means there is nothing left for even a maximally aggressive host rule to override, since there is no selector for it to match in the first place. Open the browser devtools console and inject a rule like "* { box-sizing: content-box !important; margin: 8px !important; font-size: 40px !important; }" into the top-level document — the pages rendered here will not move a single pixel, because that rule structurally cannot cross the shadow boundary, and even if some property could inherit across it, every element already carries its own explicit value that wins regardless of source.`

const longParagraph4 = `Group layout in this engine is a small, deliberately literal reimplementation of the parts of flexbox that a print-style document actually needs: a main axis and a cross axis, alignment along each, and a fixed gap between children. A column group stacks its children top to bottom and treats height as intrinsic — the sum of every child's own height, plus the gaps between them — while a row group lays children left to right and treats width as intrinsic in the same way. Every child in this engine is always handed a definite width from its parent, mirroring how block-level layout on the web has always worked, and the other dimension is always computed bottom-up from content. Separators are the simplest possible leaf: a thin line drawn perpendicular to whichever axis is "main" for its immediate parent, reserving space equal to its thickness plus twice its margin along that axis, and stretching to fill the full length of the parent's other axis regardless of any alignment setting. That single rule is what makes the same separator definition work correctly as both a horizontal rule under a heading and a vertical divider inside a row of labelled fields, with no separate orientation flag required anywhere in its declaration.`

const longParagraph5 = `None of the arithmetic above would matter if the final paint step could be silently rewritten by whatever stylesheet happens to be loaded on the host page. A design system's reset, a CSS-in-JS runtime's global styles, or a utility framework's base layer can all redefine what a bare <div> looks like by default, and none of them ask permission first. The two defenses stacked in this renderer are chosen to be independently sufficient, not merely additive: Shadow DOM enforces, at the browser's own style-resolution boundary, that selectors written outside the shadow tree simply cannot match elements inside it, regardless of specificity or the presence of "!important" — this is not a convention that a sufficiently determined stylesheet could defeat, it is a hard rule the rendering engine itself enforces. Separately, every element created here carries an explicit inline value for every property this layout math depends on, so even in a hypothetical embedding context without a shadow boundary at all, cascade-derived surprises have nothing left to attach to. You should be able to delete either defense and the pages would still render correctly; keeping both is simply cheap insurance against the other one having a bug.`

const columnA = `Every row child defaults to flex: 1, so three text blocks like this one automatically divide the row into three equal columns, each wrapping independently at its own share of the width rather than at the full row width.`

const columnB = `Passing a bare number instead changes only the weight, not the mechanism: a column with flex: 2 claims twice the share of whatever space is left after any fixed-width siblings are subtracted, exactly like CSS flex-grow. Being twice as wide as its narrow neighbors, this column also wraps far more efficiently per character, so it comfortably finishes on the first page even carrying more text than they do — a small demonstration that row height in this engine tracks actual wrapped line count at a column's own width, never character count alone.`

const columnC = `This column opts the whole row into splitColumns: true, which changes what happens at a page boundary. Without it, a row is atomic: if it does not fit in the space left on the page, the entire row — every column at once — moves forward together to a fresh page, the same as a separator or an image would. With splitColumns enabled, each column instead asks independently how much of itself fits in the remaining space, exactly the way pretext's own cursor mechanism lets a single paragraph resume mid-sentence. Every other column in this row is short enough to finish on the first page, each leaving a same-width blank slot behind on the continuation so the grid stays aligned instead of quietly reflowing into a different shape — that placeholder mechanism is what you're looking at in their empty space below. This column alone is deliberately long enough to keep going onto a second page-instance of this very row, resuming mid-sentence exactly where the first page's portion left off, the same guarantee pretext's cursor already gives a single splitting paragraph, just applied independently per column instead of to one shared flow.`

const sidebarNote = `Fixed at 160px regardless of how much space the other two columns claim. This one finishes quickly too.`

const pageBreakIntro = `Sometimes a break shouldn't depend on running out of room at all. The paragraph below this one is short — comfortably shorter than the space left on this page — yet it starts on a fresh page anyway, because a pageBreak() node sits between them in the document tree. Pagination treats it as an explicit, unconditional cut: whatever came before stays here, and everything from the marker onward moves to the top of the next page, regardless of how much space remains.`

const pageBreakOutro = `This paragraph is the proof: it begins at the very top of its page, with a large stretch of white space above where it easily could have started instead. Two safeguards keep this from misbehaving at the edges. First, if a pageBreak() lands as the very first thing on an already-empty page — for instance two of them placed back to back — the redundant one is silently dropped rather than producing a blank page. Second, a break nested inside content that would otherwise fit entirely on the current page is still discovered and honored, not silently absorbed by the fast path that places whole-fitting subtrees in one step.`

// Self-contained 4:3 SVG data URI — keeps the demo free of network/asset dependencies. Baked-in
// dimensions (400x300) and label make it obvious when a box's aspect ratio doesn't match the
// source, which is exactly the case objectFit exists to reconcile.
const DEMO_IMAGE_ASPECT_RATIO = 400 / 300
const DEMO_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4f7cff"/>
      <stop offset="100%" stop-color="#22c1a0"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <circle cx="200" cy="150" r="90" fill="#ffffff" fill-opacity="0.22"/>
  <text x="200" y="158" font-family="Arial" font-size="30" fill="#ffffff" text-anchor="middle">400 x 300</text>
</svg>
`)}`

const tableIntro = `A table is a fixed grid of rows and columns, not a semantically "correct" HTML table — no thead element, though colSpan/rowSpan cell merging IS supported (see the "Cell Spans" section further down). Column widths use the exact same fixed-px/flex-weight model as a row group's children: "#", "Qty", and "Price" below are fixed-px, "Item" is flexible. Each column's header caption lives directly on the column definition ("content", right alongside "width"/"align") — table() derives one auto-repeating header row from them, so there's no separate row to keep in sync with column order by hand. It repeats automatically at the top of every page this table spans — enough rows are generated here to force at least one page break, so watch for the header reappearing. A cell can hold arbitrary nested content, not just text — row 13's "Item" cell nests a column group containing a row group (SKU + a vertical divider + status), i.e. groups nested inside groups inside a cell, and the last row's "Item" cell opts itself into hover/click/drag independent of the table (try dragging it). Cell/row/column background color, alignment overrides, and independently-configurable inner grid lines vs. outer perimeter ("border.inner"/"border.outer", each with their own mode/thickness/color/style) are all supported — this demo matches them (dashed, same color) and rounds the outer perimeter via "border.outer.borderRadius".`

// Enough rows to force at least one page break. Row 12 (0-indexed) gets a nested group + longer
// content to demonstrate mixed cell heights within one row (paired with verticalAlign: 'center');
// row 5's "Price" cell gets a one-off background override; row 3's "#" cell gets a per-cell
// alignment override; the last row's "Item" cell opts into its own interaction (delegation).
const TABLE_ROW_COUNT = 32

// Header captions live directly on each column — table() derives a single auto-repeating header
// row from them (see column.content in GUIDE.md), rather than requiring a hand-authored row kept
// in sync with column order by hand.
function headerCaption(content: string): ReturnType<typeof text> {
  return text({ content, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, })
}

const tableColumns: TableColumn[] = [
  { width: 'shrink', align: 'end', content: headerCaption('#') },
  { width: 3, content: headerCaption('Item') },
  { width: '64px', align: 'end', content: headerCaption('Qty') },
  { width: '84px', align: 'end', background: '#fbfbfb', content: headerCaption('Price') },
]

function tableDataRows(): TableRow[] {
  return Array.from({ length: TABLE_ROW_COUNT }, (_, i) => {
    const isTall = i === 12
    const isLast = i === TABLE_ROW_COUNT - 1
    const qty = 1 + ((i * 7) % 12)
    const price = 4.5 + ((i * 13) % 40)

    // Group nesting inside a cell isn't limited to one level: this cell nests a row group (SKU +
    // status) inside a column group, inside the table cell — the same recursive layoutNode
    // dispatch table-layout.ts already uses for a single nested group handles arbitrary depth for
    // free, since each level is just another Node it hands off to the generic dispatcher.
    const itemContent = isTall
      ? group({ direction: 'column', gap: 2 }, [
        text({ content: `Widget Deluxe Pro ${i}`, fontFamily: BODY_FONT, fontSize: 12, }),
        group({ direction: 'row', gap: 8, crossAlign: 'center' }, [
          text({ content: 'SKU: WD-1042', fontFamily: UI_FONT, fontSize: 10, color: '#666666', flex: '90px' }),
          separator({ thickness: 1, color: '#dddddd' }),
          text({ content: 'Backordered — extended lead time', fontFamily: UI_FONT, fontSize: 10, color: '#b45309' }),
        ]),
      ])
      : isLast
        ? group({ direction: 'column', interactive: true, draggable: true }, [
          text({ content: `Widget ${String.fromCharCode(65 + (i % 26))}${i}`, fontFamily: BODY_FONT, fontSize: 12, color: '#4f7cff', fontWeight: 700 }),
        ])
        : text({ content: `Widget ${String.fromCharCode(65 + (i % 26))}${i}`, fontFamily: BODY_FONT, fontSize: 12, })

    const hashCell: TableCell = {
      content: text({ content: String(i + 1), fontFamily: UI_FONT, fontSize: 11, color: '#888888' }),
      ...(i === 3 ? { align: 'center' as const } : {}),
    }
    const priceCell: TableCell = {
      content: text({ content: `$${price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, }),
      ...(i === 5 ? { background: '#ffe8e8' } : {}),
    }

    return {
      background: i % 2 === 1 ? '#f7f9fc' : undefined,
      verticalAlign: isTall ? ('center' as const) : undefined,
      cells: [hashCell, { content: itemContent }, { content: text({ content: String(qty), fontFamily: UI_FONT, fontSize: 12, }) }, priceCell],
    }
  })
}

const demoTable = table({
  columns: tableColumns,
  rows: tableDataRows(),
  cellPadding: 8,
  border: { inner: { mode: 'all', thickness: 1, color: '#dddddd', style: 'dashed' }, outer: { mode: 'all', thickness: 1, color: '#dddddd', style: 'dashed', borderRadius: 16 } },
  headerBackground: '#eef1f6',
})

const groupingIntro = `Column grouping is a TABLE-level concept, entirely independent of "columns" — it never marks or removes a column. Instead, "groups: [...]" on the table declares report-style bucketing levels, and each row supplies its bucketing value(s) via "groupValues" (one entry per level), unrelated to that row's "cells". Below, Warehouse (outermost) and Status (innermost) are nested groups, yet neither has a column of its own — the table's only real columns are Item/Qty/Price, each still getting its own repeating column header exactly like the plain table above. Because a group never touches columns/cells, it's freely combinable with colSpan/rowSpan in the very same table (see the receipt table further down, grouped by category). Grouping is a "global regroup by value": rows sharing a value merge into one group wherever they appear in the authored row order, not just when adjacent — the rows below deliberately cycle through warehouses every row, yet every "Warehouse: West" row still ends up gathered under one heading. Each level can opt into its own totals() row, aggregating across all of that group's rows (including nested subgroups) via a fully custom callback — Warehouse's total sums every status beneath it, not just rows directly at that level. Enough rows are generated here to force a page split in the middle of a group's own data (not just at a group boundary) — watch "Warehouse: X" reappear at the top of the next page, since Warehouse defaults to "repeat: true", while "Pending"/"Shipped" do NOT reappear, since Status opts out with "repeat: false". The table's own "border.headerSeparator" also draws a distinct line beneath the repeating column header, and the Warehouse level's "headerBorder"/"totalsBorder" put a blue accent rule at that group's own header bar bottom edge / totals row top edge — overriding the ordinary gray inner line at those two boundaries specifically.`

type InventoryRow = { warehouse: string; status: string; item: string; qty: number; price: number }

const INVENTORY_WAREHOUSES = ['West', 'East', 'North']
const INVENTORY_STATUSES = ['Pending', 'Shipped']
const INVENTORY_ROW_COUNT = 60

// Deliberately scattered, not pre-sorted: warehouse cycles every row while status cycles more
// slowly, so the same warehouse reappears many times non-adjacently — proof that grouping performs
// a global regroup by value rather than only merging contiguous runs.
const inventoryRows: InventoryRow[] = Array.from({ length: INVENTORY_ROW_COUNT }, (_, i) => ({
  warehouse: INVENTORY_WAREHOUSES[i % INVENTORY_WAREHOUSES.length]!,
  status: INVENTORY_STATUSES[Math.floor(i / INVENTORY_WAREHOUSES.length) % INVENTORY_STATUSES.length]!,
  item: `Item ${i + 1}`,
  qty: 1 + ((i * 5) % 9),
  price: 5 + ((i * 7) % 50),
}))

// totals()/header() callbacks receive the ORIGINAL authored TableRow[] for the bucket — narrow
// past the (structurally unreachable here) 'header' variant to read a data cell's value.
function sumCell(rows: TableRow[], colIndex: number): number {
  return rows.reduce((sum, r) => (r.kind === 'header' ? sum : sum + Number(r.cells[colIndex]!.value)), 0)
}

// Grouping is entirely independent of `columns` now — these are just the table's real, always-
// visible columns (Item/Qty/Price). Warehouse/Status are never columns at all; they're bucketing
// keys supplied per-row via `groupValues` below and read by the `groups` levels on the table itself.
const groupedTableColumns: TableColumn[] = [
  { width: 3, content: headerCaption('Item') },
  { width: '56px', align: 'end', content: headerCaption('Qty') },
  { width: '72px', align: 'end', content: headerCaption('Price') },
]

const groupedDemoTable = table({
  columns: groupedTableColumns,
  cellPadding: 8,
  border: { inner: { mode: 'horizontal', color: '#dddddd' }, outer: { mode: 'horizontal', color: '#dddddd' }, headerSeparator: true },
  headerBackground: '#eef1f6',
  groups: [
    {
      header: value => text({ content: `Warehouse: ${value}`, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, }),
      background: '#eef1f6',
      totals: rows => [
        { content: text({ content: 'Warehouse total', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, }) },
        { content: text({ content: String(sumCell(rows, 1)), fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, }) },
        { content: text({ content: `$${sumCell(rows, 2).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, }) },
      ],
      // Overrides the ordinary gray inner line at this group's own header bar bottom edge / totals
      // row top edge with a heavier blue accent rule — independent of the table-wide border.inner
      // styling above.
      headerBorder: { bottom: { thickness: 2, color: '#4f7cff' } },
      totalsBorder: { top: { thickness: 2, color: '#4f7cff' } },
    },
    {
      // No custom `header` — falls back to the library default (bold text showing the value).
      // repeat: false — opts this level out of repeating on a continuation page, unlike Warehouse
      // above (left at the default `true`) — a per-level override of TableNode.repeatGroupHeaders.
      background: '#f7f9fc',
      repeat: false,
      totals: rows => [
        { content: text({ content: 'Subtotal', fontFamily: UI_FONT, fontSize: 11, color: '#666666' }) },
        { content: text({ content: String(sumCell(rows, 1)), fontFamily: UI_FONT, fontSize: 11, }) },
        { content: text({ content: `$${sumCell(rows, 2).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, }) },
      ],
    },
  ],
  rows: inventoryRows.map(r => ({
    groupValues: [r.warehouse, r.status],
    cells: [
      { content: text({ content: r.item, fontFamily: BODY_FONT, fontSize: 12, }) },
      { content: text({ content: String(r.qty), fontFamily: UI_FONT, fontSize: 12, }), value: String(r.qty) },
      { content: text({ content: `$${r.price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, }), value: String(r.price) },
    ],
  })),
})

const spansIntro = `colSpan/rowSpan use implicit HTML-table-like flow: a row's "cells" array lists only the cells that START in that row, left-to-right — table() figures out which column each one lands in by skipping whatever's still occupied by an earlier row's rowSpan, exactly like a real <table>. Below, each receipt line item is two physical rows: row one has a rowSpan: 2 quantity cell plus a colSpan: 2 product-name cell spanning the rest of the width; row two has just the two remaining ordinary cells (Detail, Price), since the quantity column is already occupied by the row above. A rowSpan cluster is atomic for pagination — enough items are listed here to force a page break, and it lands between two items, never in the middle of one. Borders correctly skip past both kinds of merged cell instead of cutting through them, and the one item with a two-line detail forces its rowSpan quantity cell's row-pair to grow taller — watch the extra height land in the SECOND row of that pair, not split evenly across both (a documented simplification, not a proportional CSS-style distribution). This table is ALSO grouped by category (Drinks/Food) — proof that grouping and spans now coexist freely in the same table, since a group's bucketing value lives on the row ("groupValues"), never on a column or cell. The category header bar itself uses colSpan too: its header() returns TableCell[] instead of a single Node — the category name spans Qty+Item, with an item count in its own Price-aligned cell — the same implicit-flow tiling totals() gets, and (unlike a plain-Node header) never indented by nesting depth since it aligns to the real column grid instead. The "Category total" row below each group also uses colSpan for its label, the same way.`

type ReceiptItem = { category: string; qty: number; name: string; detail: string; price: number }

const RECEIPT_ITEMS: ReceiptItem[] = [
  { category: 'Drinks', qty: 2, name: 'Espresso', detail: 'Double shot', price: 4.5 },
  { category: 'Food', qty: 1, name: 'Croissant', detail: 'Warmed, butter on the side', price: 3.75 },
  { category: 'Drinks', qty: 3, name: 'Cold Brew', detail: '16oz, oat milk', price: 5.25 },
  { category: 'Food', qty: 1, name: 'Avocado Toast', detail: 'Multigrain, chili flakes, extra avocado — no substitutions today, kitchen is out of sourdough', price: 8.0 },
  { category: 'Food', qty: 2, name: 'Bagel', detail: 'Plain, cream cheese', price: 3.25 },
  { category: 'Drinks', qty: 1, name: 'Orange Juice', detail: 'Fresh squeezed', price: 4.0 },
  { category: 'Food', qty: 4, name: 'Muffin', detail: 'Blueberry', price: 2.75 },
  { category: 'Drinks', qty: 1, name: 'Latte', detail: 'Oat milk, vanilla', price: 5.0 },
  { category: 'Food', qty: 2, name: 'Scone', detail: 'Cranberry orange', price: 3.5 },
  { category: 'Food', qty: 1, name: 'Breakfast Burrito', detail: 'Egg, cheese, salsa on the side', price: 7.5 },
]

const receiptColumns: TableColumn[] = [
  { width: '60px', content: headerCaption('Qty') },
  { width: 3, content: headerCaption('Item') },
  { width: '64px', align: 'end', content: headerCaption('Price') },
]

// Grouping (by category) coexists with colSpan/rowSpan (the quantity/name cells below) in this same
// table — `groupValues` lives on the row, entirely independent of `cells`, so it's unaffected by
// which columns a row's cells actually cover. rowGroup() spreads the same groupValues across both
// physical rows of this rowSpan cluster instead of repeating the array by hand on each one — they
// must agree (a cluster's rows can't disagree on group values), so this is purely a convenience.
const receiptRows: TableRow[] = RECEIPT_ITEMS.flatMap(item =>
  rowGroup([item.category], [
    {
      cells: [
        { rowSpan: 2, verticalAlign: 'center' as const, content: text({ content: `x${item.qty}`, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, align: 'center' as const }) },
        { colSpan: 2, content: text({ content: item.name, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, }) },
      ],
    },
    {
      // Column 0 (Qty) is skipped automatically — occupied by the rowSpan cell above.
      cells: [
        { content: text({ content: item.detail, fontFamily: BODY_FONT, fontSize: 11, color: '#666666' }) },
        { content: text({ content: `$${item.price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, }), value: String(item.price) },
      ],
    },
  ]),
)

// Sums the "Price" cell across a group's rows. Only the item's SECOND physical row carries a price
// cell at this array index (the first row's index-1 cell is the colSpan product-name cell instead,
// which has no `.value` — Number(undefined) is NaN, so `|| 0` skips it cleanly).
function sumReceiptPrice(rows: TableRow[]): number {
  return rows.reduce((sum, r) => (r.kind === 'header' ? sum : sum + (Number(r.cells[1]?.value) || 0)), 0)
}

const receiptTable = table({
  columns: receiptColumns,
  cellPadding: 8,
  border: { inner: { color: '#dddddd' }, outer: { color: '#dddddd' } },
  headerBackground: '#eef1f6',
  groups: [
    {
      // Returning TableCell[] instead of a single Node makes this a colSpan-aware,
      // column-grid-aligned header (same implicit-flow tiling totals() gets) — the category name
      // spans Qty+Item, and an item count sits in its own Price-aligned cell, unlike a plain Node
      // header (see groupedDemoTable's Warehouse/Status bars above), which is never indented by
      // nesting depth for this reason — it aligns to the real grid instead.
      header: (value, rows) => [
        { colSpan: 2, content: text({ content: value, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, }) },
        { content: text({ content: `${rows.length / 2} items`, fontFamily: UI_FONT, fontSize: 11, color: '#666666' }) },
      ],
      background: '#eef1f6',
      // colSpan works on a totals() row too — the label spans the Qty+Item columns instead of
      // needing a separate blank Qty cell.
      totals: rows => [
        { colSpan: 2, content: text({ content: 'Category total', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, }) },
        { content: text({ content: `$${sumReceiptPrice(rows).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, }) },
      ],
    },
  ],
  rows: receiptRows,
})

const tableStylingIntro = `Beyond the independently-styled inner/outer table borders and cellPadding above, styling now goes finer-grained: "stripe" (table-level) desugars into alternating row background at build time, same architecture column grouping already uses — table-layout.ts never knows striping happened. "padding" is resolvable per column or per cell (cell.padding ?? column.padding ?? table cellPadding), shown below on the tighter "Qty" column. And "border" on a cell draws a complete rectangle around just that cell's own box, independent of the table-wide border — shown on the one low-stock row's Qty cell — which is why it's a full, separate rectangle rather than a shared-edge line like the table-wide inner/outer lines (adjacent bordered cells would show a double-thickness line between them). This table also shows "border.inner: { mode: 'none' }" paired with an "outer" perimeter — the old single "mode: 'outer'" shorthand, now expressed as two independent groups.`

const stylingTableColumns: TableColumn[] = [
  { width: 3, content: headerCaption('Item') },
  { width: '70px', align: 'end', padding: 4, verticalAlign: 'center', content: headerCaption('Qty') },
  { width: '84px', align: 'end', content: headerCaption('Price') },
]

const stylingTableRows: TableRow[] = [
  { qty: 12, low: false },
  { qty: 3, low: true },
  { qty: 40, low: false },
  { qty: 8, low: false },
].map((r, i) => ({
  cells: [
    { content: text({ content: `Widget ${String.fromCharCode(65 + i)}`, fontFamily: BODY_FONT, fontSize: 12, }) },
    {
      content: text({ content: String(r.qty), fontFamily: UI_FONT, fontSize: 12, color: r.low ? '#b3261e' : undefined }),
      ...(r.low ? { border: { thickness: 2, color: '#b3261e' } } : {}),
      verticalAlign: 'center',
    },
    { content: text({ content: `$${(4.5 + i * 3).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, }) },
  ],
}))

const stylingTable = table({
  columns: stylingTableColumns,
  rows: stylingTableRows,
  cellPadding: 8,
  border: { inner: { mode: 'none' }, outer: { thickness: 1, color: '#dddddd' } },
  headerBackground: '#eef1f6',
  stripe: { even: '#ffffff', odd: '#f7f9fc' },
})

const imageIntro = `Image sizing is deliberately explicit rather than auto-detected from the loaded asset: paginate() stays fully synchronous, so an image node always needs enough of width, height, and aspectRatio to compute its box before anything has actually loaded. The banner below only declares an aspectRatio, so it stretches to the full column width and derives its height from that — the same behavior CSS's own aspect-ratio property gives an element with one auto dimension.`

const objectFitIntro = `Below, the same 400x300 source image is forced into a 220x140 box three times, once per objectFit value, to see how each reconciles a box whose aspect ratio does not match the asset — exactly the native CSS property doing exactly its native job on a real <img> element.`

const svgIntro = `Unlike an image() node — which rasterizes any src, SVG included, to a fixed-resolution PNG before embedding it in the PDF — an svg() node takes raw markup and draws it as true vector content: crisp at any zoom, tiny file size. The badge below mixes a linear gradient fill, a <g transform="rotate(...)"> star, and plain shape elements, all redrawn as real pdfkit vector paths in the exported PDF via svg-to-pdfkit rather than rasterized.`

const DEMO_SVG_BADGE = `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="badgeFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f7cff" />
      <stop offset="1" stop-color="#1baf7a" />
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="90" fill="url(#badgeFill)" stroke="#ffffff" stroke-width="4" />
  <g transform="translate(100 100) rotate(0)" fill="#ffffff" fill-opacity="0.9">
    <polygon points="0,-45 10,-14 42,-14 16,5 26,36 0,17 -26,36 -16,5 -42,-14 -10,-14" />
  </g>
</svg>
`

const containerIntro = `A container node is a single-child decorative wrapper (Flutter's Container is the reference point) — the one thing group deliberately never has: background, border, borderRadius, and padding. Below: a plain card; a row of badges sized via "flex" like any other row child; a chart wrapped in a container to prove background/border/padding "for free" on a node that has none of its own; two containers whose "height" is a MINIMUM rather than an exact size — one shorter than its content (the box grows to fit, content is never clipped or lost) and one taller (the extra space just sits below); a long paragraph wrapped in a container that spans a page break, to prove padding/background repaint correctly on the continuation page; a container nested inside a table cell; and an interactive, draggable container wired into the same interaction demo as everything else below.`

const richTextIntro = `A richText node mixes styled runs inline within a single paragraph — a separate node type from plain text, which stays one uniform run. Below, one paragraph carries a bold run, a colored run, and a real inline link, all wrapping and reflowing together exactly like an ordinary paragraph. The link renders as a genuine anchor element on screen and a real clickable annotation in the exported PDF, both natively clickable with no custom hit-testing involved.`

const containerSplitParagraph = `${longParagraph1} ${longParagraph2} ${longParagraph3} ${longParagraph4} ${longParagraph5}`

const chartIntro = `A chart node is an SVG built entirely by hand at render time — no charting library, consistent with the rest of this engine having no runtime dependency beyond pretext. It sizes itself the same way an image does (height or aspectRatio, resolved before anything is drawn), then chart-render.ts fills that box with axis ticks, gridlines, a legend, and the marks themselves, all as inline SVG attributes. chartKind: "categorical" merges what used to be separate bar and line chart kinds into one: each series independently declares kind: "bar" | "line" | "points" (points = markers only, no connecting stroke), so a single chart can freely mix e.g. two grouped bar series with a line series and a points series, all sharing the same category x-axis and y-domain — grouping/stacking (barMode) only ever applies among the bar-kind series. The last chart on this page turns off axis/legend/title entirely via config to show that chrome is opt-out, not baked in. The first chart is also draggable, same as the demo image above — interaction wiring needed zero chart-specific code.`

const interactionIntro = `Interactivity is opt-in per node and off by default — nothing on this page responds to a pointer unless explicitly marked. Hover and click are gated by "interactive" alone. Dragging needs a second flag, "draggable", set alongside it — an interactive node without it still hovers and clicks normally but never arms a drag. Dropping is checked against a third, fully independent flag, "droppable": a node can be a landing zone without being interactive or draggable itself, and a draggable node need not be droppable. The banner image above and the "JD" initials below are both interactive and draggable; the "Columns of Text" row above and the card below are both interactive and droppable. Try dragging the image or "JD" and releasing over either row to see the drop resolve — and notice the dragged text never gets accidentally selected mid-drag.

Drop zones can also filter by type: the image carries dragType "image" and the "Columns of Text" row only accepts "image", while "JD" carries dragType "avatar" and only the card below accepts "avatar". Drag the image over the card, or "JD" over the "Columns of Text" row, and nothing highlights — the mismatched type is filtered out and the drop resolves to nothing, live as you drag, not just at release. Drag each one over its matching zone instead and it highlights green the moment it's a valid target.`

const cardIntro = `In this card, the outer row is interactive and droppable but its contents are plain — clicking the name or the email bubbles up and resolves to the whole card, since neither of them opted in themselves. The "JD" initials are the one exception: they are ALSO marked interactive and draggable, so clicking or dragging them resolves to that text specifically instead — the more specific match always wins over an interactive ancestor.`

const splitFragmentIntro = `The paragraph below is marked "interactive: true" and is long enough that pagination splits it across several pages. Hover any fragment of it — here or several pages further down — and every fragment highlights at once, not just the one under the pointer: that's findFragments(), which recovers every page a split node landed on with zero authoring effort (no "id" needed), powered by an internal lineage id splitNode() stamps onto each fragment as it splits (src/core/behavior.ts).`

const longSplitParagraph = Array.from(
  { length: 24 },
  (_, i) =>
    `Fragment-highlighting filler sentence ${i + 1}: this run of repeated text exists purely to force this single text node to overflow one page and continue onto the next, so hovering any part of it demonstrates multi-page fragment highlighting.`,
).join(' ')

const doc = definePage(
  {
    size: 'Letter',
    margins: { top: 35, right: 35, bottom: 35, left: 35 },
    headerGap: 16,
    footerGap: 16,
    // Page-level background/border, both page-aware — resolved once per page exactly like header/
    // footer/watermark. Only page 1 gets a tinted background (no charts there yet, so no clash with
    // chart-render.ts's white "surface ring" assumption around markers, documented there); the border
    // is heavier on the cover and final page, thin everywhere else.
    background: ({ pageNumber }) => (pageNumber === 1 ? '#f5f8ff' : '#ffffff'),
    border: ({ pageNumber, totalPages }) => ({ thickness: pageNumber === 1 || pageNumber === totalPages ? 3 : 1, color: '#4f7cff' }),
    watermark: ({ pageNumber }) => pageNumber === 1 ?
      ({
        kind: 'text',
        text: 'ORIGINAL',
        fontSize: 80,
        tile: true,
        tileGapX: 0,
        opacity: 0.05,
      }) : null,
    header: () =>
      text({
        content: 'Paginator — Declarative Document Pagination Engine',
        fontFamily: UI_FONT,
        fontSize: 11,
        color: '#888888',
      }),
    footer: ({ pageNumber, totalPages }) =>
      text({
        content: `Page ${pageNumber} of ${totalPages}`,
        fontFamily: UI_FONT,
        fontSize: 10,
        color: '#888888',
        align: 'right',
      }),
  },
  group({ direction: 'column', gap: 16 }, [
    // The row itself needs no `alignSelf: 'stretch'` — a nested GROUP column child defaults to
    // that now — and its two text children need no `flex: 'shrink'` either, since a leaf child
    // defaults to that too; both are left implicit here to show the new defaults doing the work.
    group({
      direction: "row",
      mainAlign: "center",
    }, [
      text({ content: 'Title', fontFamily: UI_FONT, fontSize: 24, fontWeight: 700, }),
      separator({ thickness: 1, margin: 4, color: '#dddddd' }),
      text({ content: 'Text Flows Without Touching the DOM', fontFamily: UI_FONT, fontSize: 24, fontWeight: 700, })
    ]),
    separator({ thickness: 1, margin: 0, color: '#dddddd', style: "dashed" }),
    text({ content: longParagraph1, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    // Same story: the row stretches to full width by default (it's a GROUP), and each text child
    // shrinks to its own content by default (it's a leaf) — `mainAlign: 'start'` then left-packs
    // them with the separators, matching a compact metadata line instead of spreading across the
    // page (swap to 'space-between' for that instead, now that the row actually has free space).
    group({ direction: 'row', mainAlign: 'start', crossAlign: 'stretch', gap: 12 }, [
      text({ content: 'Prepared by: Jane Doe', fontFamily: UI_FONT, fontSize: 12, }),
      separator({ margin: 4, color: '#cccccc' }),
      text({ content: 'Date: 2026-07-01', fontFamily: UI_FONT, fontSize: 12, }),
      separator({ thickness: 1, color: '#cccccc' }),
      text({ content: 'Status: Draft', fontFamily: UI_FONT, fontSize: 12, color: '#2a7a2a' }),
    ]),
    text({ content: longParagraph2, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    // A nested GROUP column child now defaults to 'stretch' (fills the page width) and its own
    // leaf text children default to 'shrink' (hug their own content) — no explicit alignSelf/flex
    // needed for either anymore.
    group({ direction: 'row', gap: 16 }, [
      text({ content: 'Normal text', fontFamily: BODY_FONT, fontSize: 13 }),
      text({ content: 'Underlined text', fontFamily: BODY_FONT, fontSize: 13, textDecoration: 'underline' }),
      text({ content: 'Struck-through text', fontFamily: BODY_FONT, fontSize: 13, textDecoration: 'line-through' }),
    ]),
    text({ content: 'Isolation From Host CSS', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: longParagraph3, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: 'Group Layout as a Small, Literal Flexbox', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: longParagraph4, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: longParagraph5, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: 'Columns of Text', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    group({ direction: 'row', gap: 16, crossAlign: 'start', splitColumns: true, interactive: true, droppable: true, accepts: ['image'] }, [
      // Leaf text children now default to 'shrink' (hug content), not an equal flex-grow share —
      // these three columns need explicit flex weights to keep splitting the row into newspaper
      // columns instead of each hugging its own (very long) single-line natural width.
      text({ content: columnA, fontFamily: BODY_FONT, fontSize: 12, flex: 1 }),
      text({ content: columnB, fontFamily: BODY_FONT, fontSize: 12, flex: 2 }),
      text({ content: columnC, fontFamily: BODY_FONT, fontSize: 12, flex: 1, interactive: true }),
      group({ direction: 'column', gap: 4, flex: '160px' }, [
        text({ content: 'Sidebar', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, }),
        text({ content: sidebarNote, fontFamily: BODY_FONT, fontSize: 11, color: '#666666' }),
      ]),
    ]),
    pageBreak(),
    text({ content: 'Forcing a Page Break', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: pageBreakIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    pageBreak(),
    text({ content: 'This Page Starts Deliberately, Not by Accident', fontFamily: UI_FONT, fontSize: 18, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: pageBreakOutro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: 'Tables', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: tableIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    demoTable,
    text({ content: 'Column Grouping', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: groupingIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    groupedDemoTable,
    text({ content: 'Cell Spans', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: spansIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    receiptTable,
    text({ content: 'Table Styling', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: tableStylingIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    stylingTable,
    pageBreak(),
    text({ content: 'Images', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, align: 'center', alignSelf: 'stretch' }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: imageIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    image({
      src: DEMO_IMAGE_SRC,
      aspectRatio: DEMO_IMAGE_ASPECT_RATIO,
      alt: 'Demo gradient banner, stretched to the full column width',
      interactive: true,
      draggable: true,
      dragType: 'image',
    }),
    text({ content: objectFitIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', alt: 'objectFit: cover' }),
        text({ content: 'objectFit: "cover"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'contain', alt: 'objectFit: contain' }),
        text({ content: 'objectFit: "contain"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'fill', alt: 'objectFit: fill' }),
        text({ content: 'objectFit: "fill"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `An image also takes a "borderRadius" (clips the image's own pixels — a container's borderRadius only decorates around a still-rectangular image, since it doesn't know how to clip arbitrary content) and "opacity". Both below use the same 400x300 source.`,
      fontFamily: BODY_FONT,
      fontSize: 13,

    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', borderRadius: 24, alt: 'borderRadius: 24' }),
        text({ content: 'borderRadius: 24', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', opacity: 0.4, alt: 'opacity: 0.4' }),
        text({ content: 'opacity: 0.4', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({ content: 'SVG', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: svgIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    // alignSelf: 'stretch' claims the full column width for this row alone (the outer body column
    // defaults to crossAlign: 'start', which would otherwise shrink-wrap the row to its content —
    // here, just the svg's own fixed 160px — leaving mainAlign: 'center' nothing to center within).
    group({ direction: 'row', mainAlign: 'center', alignSelf: 'stretch' }, [
      svg({ markup: DEMO_SVG_BADGE, width: 160, aspectRatio: 1 }),
    ]),
    text({ content: 'Containers', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: containerIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    container(
      { background: '#f7f9fc', border: { thickness: 1, color: '#dddddd' }, borderRadius: 8, padding: 16 },
      group({ direction: 'column', gap: 4 }, [
        text({ content: 'Plain Card', fontFamily: UI_FONT, fontSize: 14, fontWeight: 700, }),
        text({
          content: 'background + border + borderRadius + padding, wrapping an ordinary column group that has none of its own.',
          fontFamily: BODY_FONT,
          fontSize: 12,

          color: '#666666',
        }),
      ]),
    ),
    group({ direction: 'row', gap: 8 }, [
      container(
        { background: '#eef1f6', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, width: 90 },
        text({ content: 'Draft', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, align: 'center' }),
      ),
      container(
        { background: '#e8f5e9', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, width: 90 },
        text({ content: 'Approved', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: '#2a7a2a', align: 'center' }),
      ),
      container(
        { background: '#fdecea', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, width: 90 },
        text({ content: 'Rejected', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: '#b3261e', align: 'center' }),
      ),
    ]),
    container(
      { background: '#ffffff', border: { thickness: 1, color: '#dddddd' }, borderRadius: 12, padding: 16 },
      chart({
        chartKind: 'categorical',
        height: 200,
        title: 'Chart Wrapped in a Container',
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: 'Revenue', data: [42, 55, 61, 58] }],
      }),
    ),
    group({ direction: 'row', gap: 16 }, [
      container(
        { height: 40, background: '#fff7e6', border: { thickness: 1, color: '#f0c36d' }, padding: 8, flex: 1 },
        text({ content: '"height: 40" — this content needs more room than that, so the box grows to fit it: height is a MINIMUM, never a clip.', fontFamily: BODY_FONT, fontSize: 12, }),
      ),
      container(
        { height: 120, background: '#eef7ff', border: { thickness: 1, color: '#a8d0f0' }, padding: 8, flex: 1 },
        text({ content: '"height: 120" — shorter content, so the extra space just sits below it.', fontFamily: BODY_FONT, fontSize: 12, }),
      ),
    ]),
    container(
      { background: '#fafafa', border: { thickness: 1, color: '#dddddd' }, padding: 16 },
      text({ content: containerSplitParagraph, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    ),
    table({
      columns: [{ width: 3, content: headerCaption('Item') }, { width: '120px', content: headerCaption('Status') }],
      cellPadding: 8,
      border: { inner: { thickness: 1, color: '#dddddd' }, outer: { thickness: 1, color: '#dddddd' } },
      headerBackground: '#eef1f6',
      rows: [
        {
          cells: [
            { content: text({ content: 'Widget A1', fontFamily: BODY_FONT, fontSize: 12, }) },
            {
              content: container(
                { background: '#e8f5e9', borderRadius: 4, padding: { top: 3, right: 8, bottom: 3, left: 8 } },
                text({ content: 'In Stock', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: '#2a7a2a', align: 'center' }),
              ),
            },
          ],
        },
      ],
    }),
    container(
      {
        background: '#ffffff',
        border: { thickness: 2, color: '#4f7cff' },
        borderRadius: 8,
        interactive: true,
        draggable: true,
        padding: 10,
        dragType: 'container'
      },
      text({ content: 'Drag me — I am an interactive, draggable container', fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, color: '#4f7cff' }),
    ),
    text({ content: 'Rich Text', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: richTextIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    richText({
      fontFamily: BODY_FONT,
      fontSize: 14,
      lineHeight: 20,

      runs: [
        { text: 'This paragraph starts in plain text, then switches to a ' },
        { text: 'bold run', fontWeight: 700 },
        { text: ' mid-sentence, continues with a ' },
        { text: 'colored run', color: '#4f7cff' },
        { text: ', and ends with an inline link to the ' },
        { text: 'pretext repository', color: '#4f7cff', textDecoration: 'underline', href: 'https://github.com/chenglou/pretext' },
        { text: ' — the same rich-inline layout engine this node is built on.' },
      ],
    }),
    text({ content: 'Charts', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: chartIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Revenue vs. Target (Mixed Series Kinds)',
          categories: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'North', kind: 'bar', data: [42, 55, 61, 58] },
            { name: 'South', kind: 'bar', data: [30, 34, 39, 45] },
            { name: 'Target', kind: 'line', curve: 'monotone', data: [38, 48, 58, 60] },
            { name: 'Forecast', kind: 'points', data: [40, 50, 55, 62] },
          ],
          interactive: true,
          draggable: true,
          dragType: 'chart',
        }),
        text({ content: 'one series.kind per series: "bar" + "bar" + "line" + "points"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Weekly Active Users',
          categories: ['W1', 'W2', 'W3', 'W4', 'W5'],
          lineCurve: 'monotone',
          series: [
            { name: '2025', kind: 'line', data: [120, 132, 145, 140, 158], fill: true },
            { name: '2026', kind: 'line', data: [140, 151, 149, 162, 171], fill: true },
          ],
        }),
        text({ content: 'every series kind: "line" (multi-series)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `chartKind: "radial" merges what used to be separate pie and donut chart kinds into one — a hole is now just innerRadiusRatio (default 0 = a solid pie), not a different kind. Every radial chart is authored as "rings": a single-ring pie/donut is just rings: [{ slices: [...] }], since there's no separate top-level "slices" shorthand anymore. Below: a plain single-ring pie; a single-ring donut (innerRadiusRatio, title/axis/legend all off); and a two-ring sunburst, where the outer ring's slices each declare a parentIndex into the inner ring, nesting their arc inside their parent's own — a ring's slices are either ALL parented or NONE (chart() throws on a ring that mixes both), so "some nested, some not" only ever means different rings.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'radial',
          height: 220,
          sliceGap: 2,
          title: 'Traffic Sources',
          rings: [
            {
              slices: [
                { label: 'Organic', value: 48 },
                { label: 'Referral', value: 22 },
                { label: 'Social', value: 18 },
                { label: 'Direct', value: 12 },
              ],
            },
          ],
        }),
        text({ content: 'rings: [{ slices }] — a plain pie', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'radial',
          height: 220,
          sliceGap: 2,
          innerRadiusRatio: 0.6,
          rings: [
            {
              slices: [
                { label: 'Passed', value: 82 },
                { label: 'Failed', value: 9 },
                { label: 'Skipped', value: 9 },
              ],
            },
          ],
          axis: { show: false },
          legend: { show: false },
        }),
        text({
          content: 'innerRadiusRatio: 0.6, title/axis/legend all off',
          fontFamily: UI_FONT,
          fontSize: 11,

          color: '#666666',
          align: 'center',
        }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'radial',
          height: 220,
          sliceGap: 1.5,
          innerRadiusRatio: 0.3,
          title: 'Sunburst: Traffic by Source & Device',
          rings: [
            {
              slices: [
                { label: 'Organic', value: 48 },
                { label: 'Paid', value: 30 },
                { label: 'Direct', value: 22 },
              ],
            },
            {
              slices: [
                { label: 'Desktop', value: 30, parentIndex: 0 },
                { label: 'Mobile', value: 18, parentIndex: 0 },
                { label: 'Desktop', value: 20, parentIndex: 1 },
                { label: 'Mobile', value: 10, parentIndex: 1 },
                { label: 'Desktop', value: 14, parentIndex: 2 },
                { label: 'Mobile', value: 8, parentIndex: 2 },
              ],
              colors: ['#a8c8ee', '#f5c98c', '#a8c8ee', '#f5c98c', '#a8c8ee', '#f5c98c'],
            },
          ],
          legend: { show: false },
        }),
        text({
          content: 'two rings, outer ring parentIndex-nested under the inner one; long title auto-wraps instead of overflowing',
          fontFamily: UI_FONT,
          fontSize: 11,

          color: '#666666',
          align: 'center',
        }),
      ]),
    ]),
    text({
      content: `Every chart text role has an independently configurable size: axis.tickFontSize (y-axis numbers), axis.categoryFontSize (x-axis labels), legend.fontSize, and title's own fontSize — set unevenly below (large category labels, small tick numbers, larger legend) to prove margins/row-heights/baselines all recompute from whatever size you pick, rather than a fixed layout that only happens to fit the default 11px.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    chart({
      chartKind: 'categorical',
      height: 240,
      title: { text: 'Custom Text Sizing', fontSize: 22 },
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { name: 'North', data: [42, 55, 61, 58] },
        { name: 'South', data: [30, 34, 39, 45] },
      ],
      axis: { tickFontSize: 9, categoryFontSize: 16 },
      legend: { fontSize: 15 },
    }),
    text({
      content: `Bar charts also take a barMode: the default "grouped" places each category's series side by side (see "Quarterly Revenue by Region" above); "stacked" below sums them into one bar per category instead, positive segments growing up from zero and negative ones growing down, each in series order, with the rounded bar-end reserved for the outermost segment only. Segments render fully flush by default — opt into a gap between them with barSegmentGap (px), shown on the right below. Pie/donut slices similarly default to flush at sliceGap: 0 (no stroke, no residual seam) and take an explicit "colors" palette override, replacing the default categorical palette wholesale — see the donut further down.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Stacked, Flush (Default)',
          barMode: 'stacked',
          categories: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'Revenue', data: [42, 55, 61, 58] },
            { name: 'Costs', data: [-28, -31, -35, -33] },
            { name: 'Other', data: [8, 6, 9, 7] },
          ],
        }),
        text({ content: 'barMode: "stacked" (barSegmentGap defaults to 0)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Stacked, With a Gap',
          barMode: 'stacked',
          barSegmentGap: 3,
          categories: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'Revenue', data: [42, 55, 61, 58] },
            { name: 'Costs', data: [-28, -31, -35, -33] },
            { name: 'Other', data: [8, 6, 9, 7] },
          ],
        }),
        text({ content: 'barSegmentGap: 3', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `The y-axis domain is controlled by "view", separate from "axis" (which only ever draws chrome — ticks/gridlines/labels — on top of whatever domain view resolves). view.domain defaults to 'zero': auto-computed, always including 0. 'auto' instead computes a domain tight to the data's own min/max — not forced through zero — then widened by view.padding (a fraction of that range, default 0.1) on each side, so the lowest/highest mark isn't flush against the plot's own edge. An explicit { min, max } object overrides either mode outright. Below, the same daily-temperature line is plotted three ways: the default zero-based domain, where a tight real-world range of 68-79°F reads as a nearly flat line; an explicit view: { domain: { min: 50, max: 80 } } zoomed in by hand; and view: { domain: 'auto' } letting the chart pick that same kind of tight range automatically. Bars behave the same way — if zero falls outside the resolved domain, a bar simply grows from whichever domain edge is nearer instead of from zero, since zero is no longer on the visible axis to grow from.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Default Domain (Includes 0)',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [{ name: 'High °F', kind: 'line', data: [72, 75, 79, 74, 68] }],
        }),
        text({ content: "view: {} (default, 'zero' — always includes 0)", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Custom Domain: 50-80',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [{ name: 'High °F', kind: 'line', data: [72, 75, 79, 74, 68] }],
          view: { domain: { min: 50, max: 80 } },
        }),
        text({ content: "view: { domain: { min: 50, max: 80 } }", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Auto Domain + Padding',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [{ name: 'High °F', kind: 'line', data: [72, 75, 79, 74, 68] }],
          view: { domain: 'auto', padding: 0.2 },
        }),
        text({ content: "view: { domain: 'auto', padding: 0.2 }", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `Both bar and line charts also take orientation: "horizontal", swapping which axis carries categories vs. values — categories run top-to-bottom on the left, values run left-to-right along the bottom, and bars grow rightward instead of upward. It's a separate rendering path rather than a single axis-agnostic function (same reasoning group-layout.ts's layoutRow/layoutColumn split gives), so every other option — barMode, barSegmentGap, view.domain, custom font sizes — works identically in both orientations.`,
      fontFamily: BODY_FONT,
      fontSize: 13,

    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 240,
          title: 'Horizontal Bar',
          orientation: 'horizontal',
          categories: ['Organic', 'Referral', 'Social', 'Direct', 'Email'],
          series: [{ name: 'Sessions', data: [4820, 2210, 1840, 1200, 640] }],
        }),
        text({ content: 'orientation: "horizontal"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 240,
          title: 'Horizontal Line',
          orientation: 'horizontal',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [
            { name: 'North', kind: 'line', data: [42, 55, 61, 58, 66] },
            { name: 'South', kind: 'line', data: [30, 34, 39, 45, 41] },
          ],
        }),
        text({ content: 'orientation: "horizontal" (multi-series)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'radial',
          height: 220,
          title: 'Custom Palette, Zero Gap',
          innerRadiusRatio: 0.6,
          rings: [
            {
              slices: [
                { label: 'Passed', value: 82 },
                { label: 'Failed', value: 9 },
                { label: 'Skipped', value: 9 },
              ],
            },
          ],
          colors: ['#0f7a3d', '#b3261e', '#8a8a8a'],
          sliceGap: 0,
        }),
        text({ content: 'colors: [...], sliceGap: 0', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `Beyond series colors, a chart's chrome is themeable too: axis.color/gridlineColor/tickColor override the axis line, gridlines, and tick/category text independently of each other; legend.color overrides legend text; and fontFamily (chart-level) applies to every text role — on the PDF export specifically, this now goes through the SAME font registry text() nodes use, so a chart can render in a registered custom font instead of always falling back to a system font in the exported PDF. Mark geometry is configurable too: barCornerRadius (bar charts), lineStrokeWidth and markerRadius (line charts).`,
      fontFamily: BODY_FONT,
      fontSize: 13,

    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Custom Theme + Font',
          fontFamily: BODY_FONT,
          categories: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [{ name: 'Revenue', data: [42, 55, 61, 58] }],
          axis: { color: '#8a5a00', gridlineColor: '#f3e0b8', tickColor: '#8a5a00' },
          legend: { color: '#8a5a00' },
          colors: ['#c98a1a'],
          barCornerRadius: 10,
        }),
        text({ content: 'axis/gridline/tick/legend colors + fontFamily + barCornerRadius: 10', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'categorical',
          height: 220,
          title: 'Custom Mark Geometry',
          categories: ['W1', 'W2', 'W3', 'W4', 'W5'],
          series: [{ name: '2026', kind: 'line', data: [140, 151, 149, 162, 171] }],
          lineStrokeWidth: 4,
          markerRadius: 7,
        }),
        text({ content: 'lineStrokeWidth: 4, markerRadius: 7', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `chartKind: "scatter" is this library's first chart with two genuinely independent NUMERIC axes — every other kind has at most one (the other side is a category band), so scatter draws a full axis frame (a left baseline for y, a bottom baseline for x) instead of a single baseline on whichever edge carries the category axis. xView/yView default to 'auto' rather than 'zero' (unlike every other chart's y-domain) since scatter data routinely sits far from either axis' zero. Points can optionally be sized by an arbitrary data value via sizeScale — its mere presence (even {}) opts every point WITH a "size" into bubble sizing, mapped through a sqrt (area-proportional, the standard bubble-chart convention) or linear scale onto a px radius range.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'scatter',
          height: 240,
          title: 'Height vs. Weight',
          series: [
            {
              name: 'Group A',
              points: [
                { x: 61, y: 105 }, { x: 64, y: 115 }, { x: 66, y: 128 }, { x: 68, y: 141 }, { x: 70, y: 155 }, { x: 72, y: 168 },
              ],
            },
            {
              name: 'Group B',
              points: [
                { x: 62, y: 118 }, { x: 65, y: 130 }, { x: 67, y: 138 }, { x: 69, y: 150 }, { x: 71, y: 160 }, { x: 73, y: 175 },
              ],
            },
          ],
        }),
        text({ content: "xView/yView default to 'auto' (tight to data)", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'scatter',
          height: 240,
          title: 'Cities: Income vs. Cost of Living',
          series: [
            {
              name: 'Metro Areas',
              points: [
                { x: 52, y: 62, size: 0.9 },
                { x: 61, y: 71, size: 2.4 },
                { x: 58, y: 66, size: 1.3 },
                { x: 74, y: 88, size: 8.8 },
                { x: 68, y: 79, size: 4.6 },
                { x: 65, y: 74, size: 2.1 },
                { x: 80, y: 95, size: 20.1 },
              ],
            },
          ],
          sizeScale: { range: [5, 26] },
        }),
        text({ content: 'sizeScale: bubble radius ∝ √size (population, millions)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `chartKind: "gantt" plots tasks as pill-shaped bars over a single numeric time axis (xAxis/xView — the same ChartNumericAxisConfig scatter's axes use, defaulting to 'auto' rather than 'zero' for the same reason). Task start/end are plain numbers, never Date objects — this library does no date math anywhere, so a real schedule is pre-converted to numeric offsets by the caller, with xAxis.formatTick rendering them back as dates. Tasks sharing a "group" value in a CONTIGUOUS run get a header band above them — deliberately much simpler than table's column grouping: no reordering, no aggregation, just a divider wherever the group value changes. Header bands are themeable: groupHeaderColor/groupHeaderBackground set a chart-wide default, and a "groups" lookup (keyed by group name) overrides either for one group's own band specifically — below, "Build" gets its own color while every other band falls back to the chart-level default. Task row-label text is independently themeable too: taskLabelColor sets a chart-wide default, and a task's own labelColor overrides it — independent of that task's bar color entirely (below, "Launch" gets a red label to flag it as the critical milestone, while its bar stays the default palette color).`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    chart({
      chartKind: 'gantt',
      height: 260,
      title: 'Product Launch Plan',
      xAxis: { formatTick: v => `Day ${Math.round(v)}` },
      groupHeaderColor: '#4a3aa7',
      groupHeaderBackground: '#efecfb',
      groups: {
        Build: { color: '#8a5a00', background: '#fdf1d8' },
      },
      taskLabelColor: '#52514e',
      tasks: [
        { label: 'Kickoff', start: 0, end: 0, group: 'Discovery' },
        { label: 'User Research', start: 0, end: 8, group: 'Discovery' },
        { label: 'Wireframes', start: 6, end: 14, group: 'Design' },
        { label: 'Visual Design', start: 12, end: 24, group: 'Design' },
        { label: 'Backend API', start: 14, end: 34, group: 'Build' },
        { label: 'Frontend UI', start: 20, end: 38, group: 'Build' },
        { label: 'Integration', start: 34, end: 42, group: 'Build' },
        { label: 'QA Pass', start: 40, end: 48, group: 'Launch' },
        { label: 'Launch', start: 48, end: 48, group: 'Launch', labelColor: '#b3261e' },
      ],
    }),
    text({
      content: 'groupHeaderColor/Background (purple default, amber "Build" override) + taskLabelColor (default) with a per-task labelColor override on "Launch"',
      fontFamily: UI_FONT,
      fontSize: 11,

      color: '#666666',
      align: 'center',
    }),
    text({
      content: `chartKind: "radar" (spider chart) reuses the familiar categories/series shape — each category becomes a spoke arranged evenly around the circle (0°=top, clockwise, same convention the radial chart's own slices use), each series becomes one closed polygon connecting a vertex per spoke. The shared radial domain reuses the exact same zero/auto/explicit resolution as a categorical chart's y-domain, so unlike a pie's always-positive slice values, radar values CAN go negative — the domain's own minimum simply becomes the center (radius 0), not a hard-coded literal zero. A polygon's fill (series.fill) is flat solid-color-at-opacity rather than line's gradient-to-baseline fade, since a closed radial shape has no single edge that reads as "the baseline."`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'radar',
          height: 260,
          title: 'Skill Assessment',
          categories: ['Speed', 'Power', 'Defense', 'Stamina', 'Tech', 'Agility'],
          series: [
            { name: 'Player A', data: [80, 65, 70, 90, 60, 75], fill: true },
            { name: 'Player B', data: [60, 85, 55, 70, 80, 65], fill: true },
          ],
        }),
        text({ content: 'two filled polygons, shared zero-based domain', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'radar',
          height: 260,
          title: 'Quarterly Change (Can Go Negative)',
          categories: ['North', 'South', 'East', 'West', 'Central'],
          series: [{ name: 'Δ vs. last Q', data: [12, -8, 4, -15, 6] }],
          markerRadius: 5,
          lineStrokeWidth: 3,
        }),
        text({ content: 'negative values: domain min (not 0) sits at the center', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `chartKind: "candlestick" plots OHLC (open/high/low/close) bars over the same category-band x-axis a categorical chart's vertical orientation uses — always vertical, since real candlestick charts have no meaningful horizontal-orientation counterpart. Each candle's data is entirely caller-supplied (this library computes no statistics anywhere) — chart() only validates the shape is internally consistent (low <= min(open,close), high >= max(open,close)). A candle's fill color comes from whether it closed up or down (close >= open), not from a series identity, defaulting to green/red with per-series upColor/downColor overrides. Like scatter/gantt, view defaults to 'auto' rather than 'zero', since real price data rarely sits near zero.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    chart({
      chartKind: 'candlestick',
      height: 280,
      title: 'Weekly Close Price',
      categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
      series: [
        {
          name: 'Stock A',
          data: [
            { open: 142, high: 148, low: 140, close: 146 },
            { open: 146, high: 150, low: 144, close: 145 },
            { open: 145, high: 147, low: 138, close: 140 },
            { open: 140, high: 143, low: 136, close: 141 },
            { open: 141, high: 152, low: 141, close: 150 },
            { open: 150, high: 155, low: 148, close: 153 },
            { open: 153, high: 154, low: 147, close: 149 },
            { open: 149, high: 158, low: 149, close: 157 },
          ],
        },
      ],
    }),
    text({ content: 'green: close >= open, red: close < open — same domain "auto" default as scatter/gantt', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    text({
      content: `chartKind: "treemap" is the last new kind, and the odd one out: no axis, no domain, no ticks — the whole plot box IS the chart. Rectangle area is proportional to each item's value, packed via the standard squarified layout algorithm (Bruls/Huizing/van Wijk) to keep rectangles close to square instead of the thin slivers a naive left-to-right slice-and-dice would produce. Flat, single level only — a hierarchical drill-down treemap was considered and deliberately scoped out. formatLabel lets the caller format each rectangle's own content as rich ChartText — receiving the whole item, not just its label, so a name run and a value run can be styled independently (bigger/bolder name, smaller/faded value on the line below). A rectangle too small to fit its own (possibly multi-line) content at labelFontSize simply omits it rather than overflowing past its own edge or wrapping; formatLabel returning "" does the same on purpose, hiding the label for the smallest items below.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20
    }),
    chart({
      chartKind: 'treemap',
      height: 280,
      title: 'Disk Usage by Folder',
      formatLabel(item) {
        if (item.value < 10) return ''
        return [
          { text: `${item.label}\n`, fontSize: 11, fontWeight: 700 },
          { text: `${item.value} MB`, fontSize: 9, opacity: 0.7 },
        ]
      },
      items: [
        { label: 'node_modules', value: 420 },
        { label: 'src', value: 85 },
        { label: 'dist', value: 60 },
        { label: 'public', value: 38 },
        { label: '.git', value: 150 },
        { label: 'test', value: 22 },
        { label: 'docs', value: 9 },
        { label: '.cache', value: 4 },
      ],
    }),
    text({
      content: 'formatLabel: big bold name run + smaller, lower-opacity value run — area ∝ value, tiny items just go label-less',
      fontFamily: UI_FONT,
      fontSize: 11,

      color: '#666666',
      align: 'center',
    }),
    text({ content: 'Interaction Events', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: interactionIntro, fontFamily: BODY_FONT, fontSize: 13, }),
    text({ content: cardIntro, fontFamily: BODY_FONT, fontSize: 13, }),
    group({ direction: 'row', gap: 12, crossAlign: 'center', interactive: true, droppable: true, accepts: ['avatar'] }, [
      text({
        content: 'JD',
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: 700,

        color: '#4f7cff',
        flex: '48px',
        align: 'center',
        interactive: true, // more specific than the card — wins when clicked or dragged directly
        draggable: true,
        dragType: 'avatar',
      }),
      group({ direction: 'column', gap: 2 }, [
        text({ content: 'Jane Doe', fontFamily: UI_FONT, fontSize: 14, fontWeight: 700, }),
        text({ content: 'jane@example.com', fontFamily: BODY_FONT, fontSize: 12, color: '#666666' }),
      ]),
    ]),
    text({ content: 'Split-Node Fragment Highlighting', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: splitFragmentIntro, fontFamily: BODY_FONT, fontSize: 13, }),
    text({ content: longSplitParagraph, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20, interactive: true }),
  ]),
)

// Wires attachInteractions() up to a visible highlight outline (so hovering/clicking is obvious
// without opening devtools) plus console logging (for the full event payloads: node type, box,
// page number, and — for clicks — the ancestor chain). This is a consumer of the public API only,
// the same way an editor built on this library would be — nothing here reaches into internals.
function setupInteractionDemo(pdfDoc: Paginator, result: PaginatedResult, host: HTMLDivElement, zoom: ZoomController): void {
  const controller = pdfDoc.attachInteractions(result, host, { zoom: zoom.getZoom })
  const registry = pdfDoc.buildHitRegistry(result)
  const shadowRoot = host.shadowRoot!

  function makeHighlightEl(): HTMLElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      border: '2px solid #4f7cff',
      background: 'rgba(79, 124, 255, 0.10)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '10',
    })
    return el
  }

  // A pool rather than one fixed div: a hovered node that was split across pages resolves (via
  // findFragments()) to one InteractionTarget per fragment, each needing its own box on its own
  // page — reused/grown across hovers instead of recreated every time.
  const highlightPool: HTMLElement[] = []

  // Highlights EVERY fragment of the hovered node, not just the one under the pointer — findFragments()
  // is the automatic, id-free counterpart to findById(): degrades to just `target` for a node that
  // was never split, so this is safe to call unconditionally on every hover.
  function showHighlights(targets: InteractionTarget[]): void {
    while (highlightPool.length < targets.length) highlightPool.push(makeHighlightEl())
    highlightPool.forEach((el, i) => {
      const target = targets[i]
      const pageEl = target === undefined ? null : shadowRoot.querySelector<HTMLElement>(`[data-page-number="${target.pageNumber}"]`)
      if (target === undefined || pageEl === null) {
        el.style.display = 'none'
        return
      }
      if (el.parentElement !== pageEl) pageEl.appendChild(el)
      Object.assign(el.style, {
        display: 'block',
        left: `${target.box.x - 5}px`,
        top: `${target.box.y - 5}px`,
        width: `${target.box.width + 10}px`,
        height: `${target.box.height + 10}px`,
      })
    })
  }

  function hideHighlights(): void {
    for (const el of highlightPool) el.style.display = 'none'
  }

  // Separate from `highlight` (which tracks hover) so live valid-drop-zone feedback during a drag
  // doesn't fight with it — green rather than blue, and only ever driven by overDropTarget.
  const dropZoneHighlight = document.createElement('div')
  Object.assign(dropZoneHighlight.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    border: '2px solid #2a9d5c',
    background: 'rgba(42, 157, 92, 0.14)',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '11',
  })

  function showDropZoneHighlight(target: InteractionTarget): void {
    const pageEl = shadowRoot.querySelector<HTMLElement>(`[data-page-number="${target.pageNumber}"]`)
    if (pageEl === null) return
    if (dropZoneHighlight.parentElement !== pageEl) pageEl.appendChild(dropZoneHighlight)
    Object.assign(dropZoneHighlight.style, {
      display: 'block',
      left: `${target.box.x - 5}px`,
      top: `${target.box.y - 5}px`,
      width: `${target.box.width + 10}px`,
      height: `${target.box.height + 10}px`,
    })
  }

  function hideDropZoneHighlight(): void {
    dropZoneHighlight.style.display = 'none'
  }

  controller.on('hover', e => {
    showHighlights(pdfDoc.findFragments(registry, e.target))
    console.log('[hover]', e.target.node.type, e.target.box, `page ${e.target.pageNumber}`)
  })
  controller.on('hoverend', e => {
    hideHighlights()
    console.log('[hoverend]', e.target.node.type)
  })
  controller.on('click', e => {
    console.log(
      '[click]',
      e.target.node.type,
      e.target.box,
      `page ${e.target.pageNumber}`,
      'ancestors:',
      e.target.ancestors.map(a => a.node.type),
    )
  })
  // Drag preview: a floating, pixel-identical copy of whatever's being dragged, built via
  // renderPreview() from the exact RenderedNode subtree the event already carries (target.rendered)
  // — no DOM element lookup needed, since rendering is flat and a group's real DOM element wouldn't
  // include its children's visual content anyway. Positioned with `position: fixed` in viewport
  // coordinates so it tracks the cursor correctly regardless of scroll or which page it strays over.
  let dragPreviewEl: HTMLElement | null = null
  let dragPreviewOffsetX = 0
  let dragPreviewOffsetY = 0

  function positionPreview(clientX: number, clientY: number): void {
    if (dragPreviewEl === null) return
    dragPreviewEl.style.left = `${clientX - dragPreviewOffsetX}px`
    dragPreviewEl.style.top = `${clientY - dragPreviewOffsetY}px`
  }

  controller.on('dragstart', e => {
    console.log('[dragstart]', e.target.node.type, e.start, 'overDropTarget:', e.overDropTarget?.node.type ?? 'none')

    const preview = pdfDoc.renderPreview(e.target.rendered)
    Object.assign(preview.style, {
      position: 'fixed',
      zIndex: '1000',
      opacity: '0.85',
      // `boxShadow` is a non-starter here: it always follows the element's own rectangular box,
      // but renderPreview()'s wrapper has no border-radius of its own (it can't — it's generic
      // across every node type, not just a rounded container/table), so a plain box-shadow would
      // cast a square-cornered halo poking out past a rounded node's actual clipped corners.
      // `drop-shadow` instead follows the alpha shape of what's actually painted inside — the same
      // rounded, clipped shape the borderRadius/overflow:hidden wrapper already produces.
      filter: 'drop-shadow(0 4px 16px rgba(0, 0, 0, 0.3))',
      pointerEvents: 'none',
    })
    document.body.appendChild(preview)
    dragPreviewEl = preview

    // Preserve the offset between where the pointer grabbed the node and the node's own top-left,
    // so the preview doesn't jump to align its corner with the cursor.
    dragPreviewOffsetX = e.start.x - e.target.box.x
    dragPreviewOffsetY = e.start.y - e.target.box.y
    positionPreview(e.sourceEvent.clientX, e.sourceEvent.clientY)

    if (e.overDropTarget !== null) showDropZoneHighlight(e.overDropTarget)
    else hideDropZoneHighlight()
  })
  controller.on('drag', e => {
    console.log('[drag]', e.delta, 'overDropTarget:', e.overDropTarget?.node.type ?? 'none')
    positionPreview(e.sourceEvent.clientX, e.sourceEvent.clientY)

    // Live valid/invalid drop-zone feedback: overDropTarget is already filtered by the dragged
    // node's dragType against each candidate's accepts list, so a type mismatch simply never
    // shows up here — no separate "invalid" check needed on this end.
    if (e.overDropTarget !== null) showDropZoneHighlight(e.overDropTarget)
    else hideDropZoneHighlight()
  })
  controller.on('dragend', e => {
    console.log('[dragend]', e.delta, 'cancelled:', e.cancelled)
    dragPreviewEl?.remove()
    dragPreviewEl = null
    hideDropZoneHighlight()
  })
  controller.on('drop', e => {
    console.log('[drop]', e.target.node.type, '->', e.dropTarget === null ? 'nothing' : e.dropTarget.node.type)
    if (e.dropTarget === null) return
    // Brief green flash on the drop target so a drop landing somewhere is visible without the console.
    showHighlights([e.dropTarget])
    const el = highlightPool[0]!
    const originalBorder = el.style.border
    el.style.border = '2px solid #2a9d5c'
    setTimeout(() => {
      el.style.border = originalBorder
    }, 250)
  })
}

// Lives outside the shadow root (light DOM), so it's free to use a class name + external CSS
// (`.no-print` in style.css) instead of the inline-styles-only rule that governs the paginated
// document itself — that rule exists to isolate the document from host CSS, not this demo chrome.
// Fixed in the viewport, not the document, and appended directly to <body> — this is demo chrome,
// not part of the paginated content pdfDoc.mount() renders into #app.
function createToolbar(): HTMLDivElement {
  const toolbar = document.createElement('div')
  toolbar.className = 'no-print'
  Object.assign(toolbar.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '1000',
    display: 'flex',
    gap: '12px',
  })
  document.body.appendChild(toolbar)
  return toolbar
}

function demoButton(toolbar: HTMLDivElement, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = label
  Object.assign(button.style, {
    padding: '10px 18px',
    fontFamily: UI_FONT,
    fontSize: '14px',
    fontWeight: '700',
    color: '#ffffff',
    background: '#4f7cff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  })
  toolbar.appendChild(button)
  return button
}

// Demo-only UI on top of the library's headless createZoomController(): the library owns zoom
// state/clamping/animation and (via attachInteractions' `zoom` option, wired in
// setupInteractionDemo above) keeping hit-testing aligned at any zoom level; buttons, the percentage
// label, and disabling at the bounds are all just this demo's own choices, not library concerns.
function setupZoomButtons(toolbar: HTMLDivElement, zoom: ZoomController): void {
  const outButton = demoButton(toolbar, '−')
  const label = document.createElement('span')
  Object.assign(label.style, {
    display: 'flex',
    alignItems: 'center',
    fontFamily: UI_FONT,
    fontSize: '14px',
    fontWeight: '700',
    color: '#333333',
    minWidth: '44px',
    justifyContent: 'center',
  })
  toolbar.appendChild(label)
  const inButton = demoButton(toolbar, '+')
  const resetButton = demoButton(toolbar, 'Reset')

  function refresh(): void {
    const value = zoom.getZoom()
    label.textContent = `${Math.round(value * 100)}%`
    outButton.disabled = value <= 0.5
    inButton.disabled = value >= 2.5
  }

  // getZoom() updates every animation frame while a zoom change is in flight (see zoom.ts) rather
  // than jumping to the target immediately, so a single refresh() right after zoomIn()/zoomOut()/
  // reset() would just show the pre-animation value and then never update again. Polling every frame
  // until the live value reaches the target — itself the return value of those calls — keeps the
  // label animating in step with the zoom instead of lagging a click behind.
  let pollFrame: number | null = null
  function trackTo(target: number): void {
    if (pollFrame !== null) cancelAnimationFrame(pollFrame)
    const tick = (): void => {
      refresh()
      pollFrame = Math.abs(zoom.getZoom() - target) > 0.001 ? requestAnimationFrame(tick) : null
    }
    tick()
  }

  outButton.addEventListener('click', () => trackTo(zoom.zoomOut()))
  inButton.addEventListener('click', () => trackTo(zoom.zoomIn()))
  resetButton.addEventListener('click', () => trackTo(zoom.reset()))

  refresh()
}

// Printing/PDF-viewing chrome is plain browser-native UI, not part of the library's API — the
// library only produces data (a mounted shadow host, or generatePdf()'s PDF bytes); what the demo
// does with that data to open a print dialog or a PDF preview is entirely up to this file.

function printDocument(host: HTMLElement): void {
  if (host.shadowRoot === null) {
    throw new Error('printDocument() called on a host that has no mount() output yet — call pdfDoc.mount(result, host) first.')
  }
  window.print()
}

const PDF_MIME_TYPE = 'application/pdf'

// The object URL is intentionally never revoked — the new tab needs it for its own lifetime, and
// closing that *other* tab fires no event this function could listen for; this accepts the same
// small per-call resource cost common blob-URL download patterns do rather than risking revoking a
// URL a slow-loading tab still needs.
function openPdfInNewTab(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF_MIME_TYPE }))
  window.open(url, '_blank')
}

// Shows a modal <dialog> with an <iframe> displaying the PDF (native PDF viewer inside the iframe).
// Lives in the light DOM, like the demo's other toolbar chrome — it's page chrome, not paginated
// document content.
function showPdfDialog(bytes: Uint8Array, options?: { title?: string }): { close(): void } {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF_MIME_TYPE }))

  const dialog = document.createElement('dialog')
  Object.assign(dialog.style, {
    padding: '0',
    border: 'none',
    borderRadius: '8px',
    width: '90vw',
    height: '90vh',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35)',
  })

  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #ddd',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '14px',
  })
  const titleEl = document.createElement('span')
  titleEl.textContent = options?.title ?? 'PDF Preview'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = 'Close'
  closeButton.onclick = () => dialog.close()
  header.append(titleEl, closeButton)

  const iframe = document.createElement('iframe')
  iframe.src = url
  Object.assign(iframe.style, { width: '100%', height: 'calc(100% - 41px)', border: 'none' })

  dialog.append(header, iframe)
  document.body.appendChild(dialog)
  dialog.addEventListener('close', () => {
    URL.revokeObjectURL(url)
    dialog.remove()
  })
  dialog.showModal()

  return { close: () => dialog.close() }
}

function setupPrintButton(toolbar: HTMLDivElement, host: HTMLDivElement): void {
  const button = demoButton(toolbar, 'Print')
  button.addEventListener('click', () => printDocument(host))
}

// generatePdf() walks the same PaginatedResult mount() already rendered above — see pdf-render.ts's
// header comment. Both buttons regenerate on each click rather than caching the bytes, since this is
// a demo of the API surface, not a perf-sensitive app; a real integration would generate once and
// reuse the bytes for both actions if the user might invoke either.
function setupPdfButtons(toolbar: HTMLDivElement, pdfDoc: Paginator, result: PaginatedResult): void {
  const openButton = demoButton(toolbar, 'Open PDF')
  openButton.addEventListener('click', () => {
    void (async () => {
      openButton.disabled = true
      openButton.textContent = 'Generating…'
      try {
        openPdfInNewTab(await pdfDoc.generatePdf(result, { title: 'Paginator Demo' }))
      } finally {
        openButton.disabled = false
        openButton.textContent = 'Open PDF'
      }
    })()
  })

  const previewButton = demoButton(toolbar, 'Preview PDF')
  previewButton.addEventListener('click', () => {
    void (async () => {
      previewButton.disabled = true
      previewButton.textContent = 'Generating…'
      try {
        showPdfDialog(await pdfDoc.generatePdf(result, { title: 'Paginator Demo' }), { title: 'PDF Preview' })
      } finally {
        previewButton.disabled = false
        previewButton.textContent = 'Preview PDF'
      }
    })()
  })
}

function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// Unlike PDF (openPdfInNewTab/showPdfDialog), browsers have no native inline viewer for .docx/.xlsx
// — a synthetic anchor + Blob URL is the standard way to hand the browser a same-origin download.
// generateDocx()/generateXlsx() take the raw PageDef directly (not a PaginatedResult) — see
// paginator.ts's header comment on generateDocx: Word/Excel reflow their own content, so there's no
// pixel-box pagination step to run first.
// doc.footer interpolates the REAL pageNumber/totalPages — correct for PDF/DOM, which resolve it
// once per actual page during paginate(). generateDocx() instead resolves header/footer content
// ONCE with a placeholder {pageNumber:1,totalPages:1} (Word paginates the body itself), so reusing
// that same footer verbatim would bake in the literal, wrong-past-page-1 text "Page 1 of 1". A
// docx-only footer swaps in the `{{pageNumber}}`/`{{totalPages}}` sentinel instead, which
// generateDocx() splices into live PAGE/NUMPAGES Word fields — see docx-export.ts's header comment.
function docxFooter(): ReturnType<typeof text> {
  return text({
    content: 'Page {{pageNumber}} of {{totalPages}}',
    fontFamily: UI_FONT,
    fontSize: 10,

    color: '#888888',
    align: 'right',
  })
}

function setupExportButtons(toolbar: HTMLDivElement, pdfDoc: Paginator, doc: PageDef): void {
  const wordButton = demoButton(toolbar, 'Export Word')
  wordButton.addEventListener('click', () => {
    void (async () => {
      wordButton.disabled = true
      wordButton.textContent = 'Generating…'
      try {
        const bytes = await pdfDoc.generateDocx({ ...doc, footer: docxFooter }, { title: 'Paginator Demo' })
        downloadBytes(bytes, 'paginator-demo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      } finally {
        wordButton.disabled = false
        wordButton.textContent = 'Export Word'
      }
    })()
  })

  const excelButton = demoButton(toolbar, 'Export Excel')
  excelButton.addEventListener('click', () => {
    void (async () => {
      excelButton.disabled = true
      excelButton.textContent = 'Generating…'
      try {
        const bytes = await pdfDoc.generateXlsx(doc, { title: 'Paginator Demo' })
        downloadBytes(bytes, 'paginator-demo.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } finally {
        excelButton.disabled = false
        excelButton.textContent = 'Export Excel'
      }
    })()
  })
}

async function main(): Promise<void> {
  const pdfDoc = new Paginator()

  // Registers the literal font FILES this demo's text is set in, before ready()/paginate() ever run
  // — so pretext's canvas measurement and generatePdf()'s embedded PDF glyphs use the exact same
  // bytes (see font-registry.ts). Without this, UI_FONT/BODY_FONT would resolve to whatever system
  // font stack is installed, which generatePdf() cannot embed (no accessible file), and PDF export
  // would fall back to Helvetica with a console warning instead of matching the preview exactly.
  await Promise.all([
    pdfDoc.registerFont({ family: 'Inter', weight: 400, url: INTER_REGULAR_URL }),
    pdfDoc.registerFont({ family: 'Inter', weight: 700, url: INTER_BOLD_URL }),
    pdfDoc.registerFont({ family: 'Source Serif 4', weight: 400, url: SOURCE_SERIF_REGULAR_URL }),
    pdfDoc.registerFont({ family: 'Source Serif 4', weight: 700, url: SOURCE_SERIF_BOLD_URL }),
  ])
  await ready()
  const result = pdfDoc.paginate(doc)
  const app = document.querySelector<HTMLDivElement>('#app')
  if (app === null) throw new Error('#app not found')
  pdfDoc.mount(result, app)
  const zoom = pdfDoc.createZoomController(app)
  setupInteractionDemo(pdfDoc, result, app, zoom)
  const toolbar = createToolbar()
  setupZoomButtons(toolbar, zoom)
  setupPrintButton(toolbar, app)
  setupPdfButtons(toolbar, pdfDoc, result)
  setupExportButtons(toolbar, pdfDoc, doc)
}

void main()
