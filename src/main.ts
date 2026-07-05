import './style.css'
import {
  attachInteractions,
  chart,
  container,
  definePage,
  generatePdf,
  group,
  image,
  mount,
  openPdfInNewTab,
  pageBreak,
  paginate,
  printDocument,
  ready,
  registerFont,
  renderPreview,
  richText,
  rowGroup,
  separator,
  showPdfDialog,
  table,
  text,
} from './index.ts'
import type { InteractionTarget, TableCell, TableColumn, TableRow } from './index.ts'

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

const tableIntro = `A table is a fixed grid of rows and columns, not a semantically "correct" HTML table — no thead element, though colSpan/rowSpan cell merging IS supported (see the "Cell Spans" section further down). Column widths use the exact same fixed-px/flex-weight model as a row group's children: "#", "Qty", and "Price" below are fixed-px, "Item" is flexible. Each column's header caption lives directly on the column definition ("content", right alongside "width"/"align") — table() derives one auto-repeating header row from them, so there's no separate row to keep in sync with column order by hand. It repeats automatically at the top of every page this table spans — enough rows are generated here to force at least one page break, so watch for the header reappearing. A cell can hold arbitrary nested content, not just text — row 13's "Item" cell nests a column group containing a row group (SKU + a vertical divider + status), i.e. groups nested inside groups inside a cell, and the last row's "Item" cell opts itself into hover/click/drag independent of the table (try dragging it). Cell/row/column background color, alignment overrides, and every border mode (none/all/outer/horizontal/vertical) are all supported — this demo uses "all".`

// Enough rows to force at least one page break. Row 12 (0-indexed) gets a nested group + longer
// content to demonstrate mixed cell heights within one row (paired with verticalAlign: 'center');
// row 5's "Price" cell gets a one-off background override; row 3's "#" cell gets a per-cell
// alignment override; the last row's "Item" cell opts into its own interaction (delegation).
const TABLE_ROW_COUNT = 32

// Header captions live directly on each column — table() derives a single auto-repeating header
// row from them (see column.content in GUIDE.md), rather than requiring a hand-authored row kept
// in sync with column order by hand.
function headerCaption(content: string): ReturnType<typeof text> {
  return text({ content, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 14 })
}

const tableColumns: TableColumn[] = [
  { width: '40px', align: 'end', content: headerCaption('#') },
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
        text({ content: `Widget Deluxe Pro ${i}`, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 17 }),
        group({ direction: 'row', gap: 8, crossAlign: 'center' }, [
          text({ content: 'SKU: WD-1042', fontFamily: UI_FONT, fontSize: 10, lineHeight: 13, color: '#666666', flex: '90px' }),
          separator({ thickness: 1, color: '#dddddd' }),
          text({ content: 'Backordered — extended lead time', fontFamily: UI_FONT, fontSize: 10, lineHeight: 13, color: '#b45309' }),
        ]),
      ])
      : isLast
        ? group({ direction: 'column', interactive: true, draggable: true }, [
          text({ content: `Widget ${String.fromCharCode(65 + (i % 26))}${i}`, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 16, color: '#4f7cff', fontWeight: 700 }),
        ])
        : text({ content: `Widget ${String.fromCharCode(65 + (i % 26))}${i}`, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 16 })

    const hashCell: TableCell = {
      content: text({ content: String(i + 1), fontFamily: UI_FONT, fontSize: 11, lineHeight: 15, color: '#888888' }),
      ...(i === 3 ? { align: 'center' as const } : {}),
    }
    const priceCell: TableCell = {
      content: text({ content: `$${price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, lineHeight: 16 }),
      ...(i === 5 ? { background: '#ffe8e8' } : {}),
    }

    return {
      background: i % 2 === 1 ? '#f7f9fc' : undefined,
      verticalAlign: isTall ? ('center' as const) : undefined,
      cells: [hashCell, { content: itemContent }, { content: text({ content: String(qty), fontFamily: UI_FONT, fontSize: 12, lineHeight: 16 }) }, priceCell],
    }
  })
}

const demoTable = table({
  columns: tableColumns,
  rows: tableDataRows(),
  cellPadding: 8,
  border: { mode: 'all', thickness: 1, color: '#dddddd' },
  headerBackground: '#eef1f6',
})

const groupingIntro = `Column grouping is a TABLE-level concept, entirely independent of "columns" — it never marks or removes a column. Instead, "groups: [...]" on the table declares report-style bucketing levels, and each row supplies its bucketing value(s) via "groupValues" (one entry per level), unrelated to that row's "cells". Below, Warehouse (outermost) and Status (innermost) are nested groups, yet neither has a column of its own — the table's only real columns are Item/Qty/Price, each still getting its own repeating column header exactly like the plain table above. Because a group never touches columns/cells, it's freely combinable with colSpan/rowSpan in the very same table (see the receipt table further down, grouped by category). Grouping is a "global regroup by value": rows sharing a value merge into one group wherever they appear in the authored row order, not just when adjacent — the rows below deliberately cycle through warehouses every row, yet every "Warehouse: West" row still ends up gathered under one heading. Each level can opt into its own totals() row, aggregating across all of that group's rows (including nested subgroups) via a fully custom callback — Warehouse's total sums every status beneath it, not just rows directly at that level. Enough rows are generated here to force a page split in the middle of a group's own data (not just at a group boundary) — watch "Warehouse: X" reappear at the top of the next page, since Warehouse defaults to "repeat: true", while "Pending"/"Shipped" do NOT reappear, since Status opts out with "repeat: false".`

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
  border: { mode: 'horizontal', color: '#dddddd' },
  headerBackground: '#eef1f6',
  groups: [
    {
      header: value => text({ content: `Warehouse: ${value}`, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, lineHeight: 17 }),
      background: '#eef1f6',
      totals: rows => [
        { content: text({ content: 'Warehouse total', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 15 }) },
        { content: text({ content: String(sumCell(rows, 1)), fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 15 }) },
        { content: text({ content: `$${sumCell(rows, 2).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 15 }) },
      ],
    },
    {
      // No custom `header` — falls back to the library default (bold text showing the value).
      // repeat: false — opts this level out of repeating on a continuation page, unlike Warehouse
      // above (left at the default `true`) — a per-level override of TableNode.repeatGroupHeaders.
      background: '#f7f9fc',
      repeat: false,
      totals: rows => [
        { content: text({ content: 'Subtotal', fontFamily: UI_FONT, fontSize: 11, lineHeight: 15, color: '#666666' }) },
        { content: text({ content: String(sumCell(rows, 1)), fontFamily: UI_FONT, fontSize: 11, lineHeight: 15 }) },
        { content: text({ content: `$${sumCell(rows, 2).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, lineHeight: 15 }) },
      ],
    },
  ],
  rows: inventoryRows.map(r => ({
    groupValues: [r.warehouse, r.status],
    cells: [
      { content: text({ content: r.item, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 16 }) },
      { content: text({ content: String(r.qty), fontFamily: UI_FONT, fontSize: 12, lineHeight: 16 }), value: String(r.qty) },
      { content: text({ content: `$${r.price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, lineHeight: 16 }), value: String(r.price) },
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
        { rowSpan: 2, verticalAlign: 'center' as const, content: text({ content: `x${item.qty}`, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, lineHeight: 16, align: 'center' as const }) },
        { colSpan: 2, content: text({ content: item.name, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, lineHeight: 17 }) },
      ],
    },
    {
      // Column 0 (Qty) is skipped automatically — occupied by the rowSpan cell above.
      cells: [
        { content: text({ content: item.detail, fontFamily: BODY_FONT, fontSize: 11, lineHeight: 14, color: '#666666' }) },
        { content: text({ content: `$${item.price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, lineHeight: 16 }), value: String(item.price) },
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
  border: { mode: 'all', color: '#dddddd' },
  headerBackground: '#eef1f6',
  groups: [
    {
      // Returning TableCell[] instead of a single Node makes this a colSpan-aware,
      // column-grid-aligned header (same implicit-flow tiling totals() gets) — the category name
      // spans Qty+Item, and an item count sits in its own Price-aligned cell, unlike a plain Node
      // header (see groupedDemoTable's Warehouse/Status bars above), which is never indented by
      // nesting depth for this reason — it aligns to the real grid instead.
      header: (value, rows) => [
        { colSpan: 2, content: text({ content: value, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, lineHeight: 17 }) },
        { content: text({ content: `${rows.length / 2} items`, fontFamily: UI_FONT, fontSize: 11, lineHeight: 15, color: '#666666' }) },
      ],
      background: '#eef1f6',
      // colSpan works on a totals() row too — the label spans the Qty+Item columns instead of
      // needing a separate blank Qty cell.
      totals: rows => [
        { colSpan: 2, content: text({ content: 'Category total', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 15 }) },
        { content: text({ content: `$${sumReceiptPrice(rows).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 15 }) },
      ],
    },
  ],
  rows: receiptRows,
})

const tableStylingIntro = `Beyond the table-wide border modes and cellPadding above, styling now goes finer-grained: "stripe" (table-level) desugars into alternating row background at build time, same architecture column grouping already uses — table-layout.ts never knows striping happened. "padding" is resolvable per column or per cell (cell.padding ?? column.padding ?? table cellPadding), shown below on the tighter "Qty" column. And "border" on a cell draws a complete rectangle around just that cell's own box, independent of the table-wide border — shown on the one low-stock row's Qty cell — which is why it's a full, separate rectangle rather than a shared-edge line like the table-wide modes (adjacent bordered cells would show a double-thickness line between them).`

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
    { content: text({ content: `Widget ${String.fromCharCode(65 + i)}`, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 16 }) },
    {
      content: text({ content: String(r.qty), fontFamily: UI_FONT, fontSize: 12, lineHeight: 16, color: r.low ? '#b3261e' : undefined }),
      ...(r.low ? { border: { thickness: 2, color: '#b3261e' } } : {}),
      verticalAlign: 'center',
    },
    { content: text({ content: `$${(4.5 + i * 3).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12, lineHeight: 16 }) },
  ],
}))

const stylingTable = table({
  columns: stylingTableColumns,
  rows: stylingTableRows,
  cellPadding: 8,
  border: { mode: 'outer', thickness: 1, color: '#dddddd' },
  headerBackground: '#eef1f6',
  stripe: { even: '#ffffff', odd: '#f7f9fc' },
})

const imageIntro = `Image sizing is deliberately explicit rather than auto-detected from the loaded asset: paginate() stays fully synchronous, so an image node always needs enough of width, height, and aspectRatio to compute its box before anything has actually loaded. The banner below only declares an aspectRatio, so it stretches to the full column width and derives its height from that — the same behavior CSS's own aspect-ratio property gives an element with one auto dimension.`

const objectFitIntro = `Below, the same 400x300 source image is forced into a 220x140 box three times, once per objectFit value, to see how each reconciles a box whose aspect ratio does not match the asset — exactly the native CSS property doing exactly its native job on a real <img> element.`

const containerIntro = `A container node is a single-child decorative wrapper (Flutter's Container is the reference point) — the one thing group deliberately never has: background, border, borderRadius, and padding. Below: a plain card; a row of badges sized via "flex" like any other row child; a chart wrapped in a container to prove background/border/padding "for free" on a node that has none of its own; two containers whose "height" is a MINIMUM rather than an exact size — one shorter than its content (the box grows to fit, content is never clipped or lost) and one taller (the extra space just sits below); a long paragraph wrapped in a container that spans a page break, to prove padding/background repaint correctly on the continuation page; a container nested inside a table cell; and an interactive, draggable container wired into the same interaction demo as everything else below.`

const richTextIntro = `A richText node mixes styled runs inline within a single paragraph — a separate node type from plain text, which stays one uniform run. Below, one paragraph carries a bold run, a colored run, and a real inline link, all wrapping and reflowing together exactly like an ordinary paragraph. The link renders as a genuine anchor element on screen and a real clickable annotation in the exported PDF, both natively clickable with no custom hit-testing involved.`

const containerSplitParagraph = `${longParagraph1} ${longParagraph2} ${longParagraph3} ${longParagraph4} ${longParagraph5}`

const chartIntro = `A chart node is an SVG built entirely by hand at render time — no charting library, consistent with the rest of this engine having no runtime dependency beyond pretext. It sizes itself the same way an image does (height or aspectRatio, resolved before anything is drawn), then chart-render.ts fills that box with axis ticks, gridlines, a legend, and the marks themselves, all as inline SVG attributes. The four kinds below share one chartKind-discriminated node type: two grouped-bar/multi-line series prove the series[] array isn't limited to a single line, and the last chart turns off axis/legend/title entirely via config to show that chrome is opt-out, not baked in. The first chart is also draggable, same as the demo image above — interaction wiring needed zero chart-specific code.`

const interactionIntro = `Interactivity is opt-in per node and off by default — nothing on this page responds to a pointer unless explicitly marked. Hover and click are gated by "interactive" alone. Dragging needs a second flag, "draggable", set alongside it — an interactive node without it still hovers and clicks normally but never arms a drag. Dropping is checked against a third, fully independent flag, "droppable": a node can be a landing zone without being interactive or draggable itself, and a draggable node need not be droppable. The banner image above and the "JD" initials below are both interactive and draggable; the "Columns of Text" row above and the card below are both interactive and droppable. Try dragging the image or "JD" and releasing over either row to see the drop resolve — and notice the dragged text never gets accidentally selected mid-drag.

Drop zones can also filter by type: the image carries dragType "image" and the "Columns of Text" row only accepts "image", while "JD" carries dragType "avatar" and only the card below accepts "avatar". Drag the image over the card, or "JD" over the "Columns of Text" row, and nothing highlights — the mismatched type is filtered out and the drop resolves to nothing, live as you drag, not just at release. Drag each one over its matching zone instead and it highlights green the moment it's a valid target.`

const cardIntro = `In this card, the outer row is interactive and droppable but its contents are plain — clicking the name or the email bubbles up and resolves to the whole card, since neither of them opted in themselves. The "JD" initials are the one exception: they are ALSO marked interactive and draggable, so clicking or dragging them resolves to that text specifically instead — the more specific match always wins over an interactive ancestor.`

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
    watermark: ({ pageNumber }) => ({ kind: 'text', text: pageNumber === 1 ? 'ORIGINAL' : 'COPY', fontSize: 150 }),
    header: () =>
      text({
        content: 'Paginator — Declarative Document Pagination Engine',
        fontFamily: UI_FONT,
        fontSize: 11,
        lineHeight: 14,
        color: '#888888',
      }),
    footer: ({ pageNumber, totalPages }) =>
      text({
        content: `Page ${pageNumber} of ${totalPages}`,
        fontFamily: UI_FONT,
        fontSize: 10,
        lineHeight: 13,
        color: '#888888',
        align: 'right',
      }),
  },
  group({ direction: 'column', gap: 16 }, [
    text({ content: 'Text Flows Without Touching the DOM', fontFamily: UI_FONT, fontSize: 24, fontWeight: 700, lineHeight: 30 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: longParagraph1, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    group({ direction: 'row', mainAlign: 'space-between', crossAlign: 'stretch', gap: 12 }, [
      // Fixed (px) flex opts these out of the row's default equal-column sizing, so they hug
      // their own content width and let `space-between` spread the leftover space between them —
      // the same look the row had before explicit sizing existed, now expressed explicitly.
      text({ content: 'Prepared by: Jane Doe', fontFamily: UI_FONT, fontSize: 12, lineHeight: 16, flex: '150px' }),
      separator({ thickness: 1, color: '#cccccc' }),
      text({ content: 'Date: 2026-07-01', fontFamily: UI_FONT, fontSize: 12, lineHeight: 16, flex: '120px' }),
      separator({ thickness: 1, color: '#cccccc' }),
      text({ content: 'Status: Draft', fontFamily: UI_FONT, fontSize: 12, lineHeight: 16, color: '#2a7a2a', flex: '100px' }),
    ]),
    text({ content: longParagraph2, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    group({ direction: 'row', gap: 16 }, [
      text({ content: 'Normal text', fontFamily: BODY_FONT, fontSize: 13, lineHeight: 18 }),
      text({ content: 'Underlined text', fontFamily: BODY_FONT, fontSize: 13, lineHeight: 18, textDecoration: 'underline' }),
      text({ content: 'Struck-through text', fontFamily: BODY_FONT, fontSize: 13, lineHeight: 18, textDecoration: 'line-through' }),
    ]),
    text({ content: 'Isolation From Host CSS', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: longParagraph3, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: 'Group Layout as a Small, Literal Flexbox', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: longParagraph4, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: longParagraph5, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: 'Columns of Text', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    group({ direction: 'row', gap: 16, crossAlign: 'start', splitColumns: true, interactive: true, droppable: true, accepts: ['image'] }, [
      text({ content: columnA, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 18 }), // flex: 1 (default)
      text({ content: columnB, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 18, flex: 2 }),
      text({ content: columnC, fontFamily: BODY_FONT, fontSize: 12, lineHeight: 18, interactive: true }), // flex: 1 (default)
      group({ direction: 'column', gap: 4, flex: '160px' }, [
        text({ content: 'Sidebar', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 14 }),
        text({ content: sidebarNote, fontFamily: BODY_FONT, fontSize: 11, lineHeight: 15, color: '#666666' }),
      ]),
    ]),
    pageBreak(),
    text({ content: 'Forcing a Page Break', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: pageBreakIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    pageBreak(),
    text({ content: 'This Page Starts Deliberately, Not by Accident', fontFamily: UI_FONT, fontSize: 18, fontWeight: 700, lineHeight: 24 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: pageBreakOutro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: 'Tables', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: tableIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    demoTable,
    text({ content: 'Column Grouping', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: groupingIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    groupedDemoTable,
    text({ content: 'Cell Spans', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: spansIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    receiptTable,
    text({ content: 'Table Styling', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: tableStylingIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    stylingTable,
    pageBreak(),
    group({ direction: 'column', crossAlign: 'stretch' }, [
      text({ content: 'Images', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26, align: 'center' }),
    ]),
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
        text({ content: 'objectFit: "cover"', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'contain', alt: 'objectFit: contain' }),
        text({ content: 'objectFit: "contain"', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'fill', alt: 'objectFit: fill' }),
        text({ content: 'objectFit: "fill"', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `An image also takes a "borderRadius" (clips the image's own pixels — a container's borderRadius only decorates around a still-rectangular image, since it doesn't know how to clip arbitrary content) and "opacity". Both below use the same 400x300 source.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20,
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', borderRadius: 24, alt: 'borderRadius: 24' }),
        text({ content: 'borderRadius: 24', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', opacity: 0.4, alt: 'opacity: 0.4' }),
        text({ content: 'opacity: 0.4', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({ content: 'Containers', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: containerIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    container(
      { background: '#f7f9fc', border: { thickness: 1, color: '#dddddd' }, borderRadius: 8, padding: 16 },
      group({ direction: 'column', gap: 4 }, [
        text({ content: 'Plain Card', fontFamily: UI_FONT, fontSize: 14, fontWeight: 700, lineHeight: 18 }),
        text({
          content: 'background + border + borderRadius + padding, wrapping an ordinary column group that has none of its own.',
          fontFamily: BODY_FONT,
          fontSize: 12,
          lineHeight: 17,
          color: '#666666',
        }),
      ]),
    ),
    group({ direction: 'row', gap: 8 }, [
      container(
        { background: '#eef1f6', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, flex: '90px' },
        text({ content: 'Draft', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 14, align: 'center' }),
      ),
      container(
        { background: '#e8f5e9', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, flex: '90px' },
        text({ content: 'Approved', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 14, color: '#2a7a2a', align: 'center' }),
      ),
      container(
        { background: '#fdecea', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, flex: '90px' },
        text({ content: 'Rejected', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 14, color: '#b3261e', align: 'center' }),
      ),
    ]),
    container(
      { background: '#ffffff', border: { thickness: 1, color: '#dddddd' }, borderRadius: 12, padding: 16 },
      chart({
        chartKind: 'bar',
        height: 200,
        title: 'Chart Wrapped in a Container',
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: 'Revenue', data: [42, 55, 61, 58] }],
      }),
    ),
    group({ direction: 'row', gap: 16 }, [
      container(
        { height: 40, background: '#fff7e6', border: { thickness: 1, color: '#f0c36d' }, padding: 8, flex: 1 },
        text({ content: '"height: 40" — this content needs more room than that, so the box grows to fit it: height is a MINIMUM, never a clip.', fontFamily: BODY_FONT, fontSize: 12, lineHeight: 17 }),
      ),
      container(
        { height: 120, background: '#eef7ff', border: { thickness: 1, color: '#a8d0f0' }, padding: 8, flex: 1 },
        text({ content: '"height: 120" — shorter content, so the extra space just sits below it.', fontFamily: BODY_FONT, fontSize: 12, lineHeight: 17 }),
      ),
    ]),
    container(
      { background: '#fafafa', border: { thickness: 1, color: '#dddddd' }, padding: 16 },
      text({ content: containerSplitParagraph, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    ),
    table({
      columns: [{ width: 3, content: headerCaption('Item') }, { width: '120px', content: headerCaption('Status') }],
      cellPadding: 8,
      border: { mode: 'all', thickness: 1, color: '#dddddd' },
      headerBackground: '#eef1f6',
      rows: [
        {
          cells: [
            { content: text({ content: 'Widget A1', fontFamily: BODY_FONT, fontSize: 12, lineHeight: 16 }) },
            {
              content: container(
                { background: '#e8f5e9', borderRadius: 4, padding: { top: 3, right: 8, bottom: 3, left: 8 } },
                text({ content: 'In Stock', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, lineHeight: 14, color: '#2a7a2a', align: 'center' }),
              ),
            },
          ],
        },
      ],
    }),
    container(
      { background: '#ffffff', border: { thickness: 2, color: '#4f7cff' }, borderRadius: 8, padding: 12, interactive: true, draggable: true, dragType: 'container' },
      text({ content: 'Drag me — I am an interactive, draggable container', fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, lineHeight: 17, color: '#4f7cff' }),
    ),
    text({ content: 'Rich Text', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: richTextIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    richText({
      fontFamily: BODY_FONT,
      fontSize: 14,
      lineHeight: 21,
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
    text({ content: 'Charts', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: chartIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'bar',
          height: 220,
          title: 'Quarterly Revenue by Region',
          categories: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'North', data: [42, 55, 61, 58] },
            { name: 'South', data: [30, 34, 39, 45] },
          ],
          interactive: true,
          draggable: true,
          dragType: 'chart',
        }),
        text({ content: 'chartKind: "bar" (multi-series)', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'line',
          height: 220,
          title: 'Weekly Active Users',
          categories: ['W1', 'W2', 'W3', 'W4', 'W5'],
          lineCurve: 'monotone',
          series: [
            { name: '2025', data: [120, 132, 145, 140, 158], fill: true },
            { name: '2026', data: [140, 151, 149, 162, 171], fill: true },
          ],
        }),
        text({ content: 'chartKind: "line" (multi-series)', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'pie',
          height: 220,
          sliceGap: 2,
          title: 'Traffic Sources',
          slices: [
            { label: 'Organic', value: 48 },
            { label: 'Referral', value: 22 },
            { label: 'Social', value: 18 },
            { label: 'Direct', value: 12 },
          ],
        }),
        text({ content: 'chartKind: "pie"', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'donut',
          height: 220,
          sliceGap: 2,
          slices: [
            { label: 'Passed', value: 82 },
            { label: 'Failed', value: 9 },
            { label: 'Skipped', value: 9 },
          ],
          axis: { show: false },
          legend: { show: false },
        }),
        text({
          content: 'chartKind: "donut", title/axis/legend all off',
          fontFamily: UI_FONT,
          fontSize: 11,
          lineHeight: 14,
          color: '#666666',
          align: 'center',
        }),
      ]),
    ]),
    text({
      content: `Every chart text role has an independently configurable size: axis.tickFontSize (y-axis numbers), axis.categoryFontSize (x-axis labels), legend.fontSize, and title's own fontSize — set unevenly below (large category labels, small tick numbers, larger legend) to prove margins/row-heights/baselines all recompute from whatever size you pick, rather than a fixed layout that only happens to fit the default 11px.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20,
    }),
    chart({
      chartKind: 'bar',
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
      lineHeight: 20,
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'bar',
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
        text({ content: 'barMode: "stacked" (barSegmentGap defaults to 0)', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'bar',
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
        text({ content: 'barSegmentGap: 3', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `The y-axis domain is controlled by "view", separate from "axis" (which only ever draws chrome — ticks/gridlines/labels — on top of whatever domain view resolves). view.domain defaults to 'zero': auto-computed, always including 0. 'auto' instead computes a domain tight to the data's own min/max — not forced through zero — then widened by view.padding (a fraction of that range, default 0.1) on each side, so the lowest/highest mark isn't flush against the plot's own edge. An explicit { min, max } object overrides either mode outright. Below, the same daily-temperature line is plotted three ways: the default zero-based domain, where a tight real-world range of 68-79°F reads as a nearly flat line; an explicit view: { domain: { min: 50, max: 80 } } zoomed in by hand; and view: { domain: 'auto' } letting the chart pick that same kind of tight range automatically. Bars behave the same way — if zero falls outside the resolved domain, a bar simply grows from whichever domain edge is nearer instead of from zero, since zero is no longer on the visible axis to grow from.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20,
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'line',
          height: 220,
          title: 'Default Domain (Includes 0)',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [{ name: 'High °F', data: [72, 75, 79, 74, 68] }],
        }),
        text({ content: "view: {} (default, 'zero' — always includes 0)", fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'line',
          height: 220,
          title: 'Custom Domain: 50-80',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [{ name: 'High °F', data: [72, 75, 79, 74, 68] }],
          view: { domain: { min: 50, max: 80 } },
        }),
        text({ content: "view: { domain: { min: 50, max: 80 } }", fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'line',
          height: 220,
          title: 'Auto Domain + Padding',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [{ name: 'High °F', data: [72, 75, 79, 74, 68] }],
          view: { domain: 'auto', padding: 0.2 },
        }),
        text({ content: "view: { domain: 'auto', padding: 0.2 }", fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `Both bar and line charts also take orientation: "horizontal", swapping which axis carries categories vs. values — categories run top-to-bottom on the left, values run left-to-right along the bottom, and bars grow rightward instead of upward. It's a separate rendering path rather than a single axis-agnostic function (same reasoning group-layout.ts's layoutRow/layoutColumn split gives), so every other option — barMode, barSegmentGap, view.domain, custom font sizes — works identically in both orientations.`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20,
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'bar',
          height: 240,
          title: 'Horizontal Bar',
          orientation: 'horizontal',
          categories: ['Organic', 'Referral', 'Social', 'Direct', 'Email'],
          series: [{ name: 'Sessions', data: [4820, 2210, 1840, 1200, 640] }],
        }),
        text({ content: 'orientation: "horizontal"', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'line',
          height: 240,
          title: 'Horizontal Line',
          orientation: 'horizontal',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          series: [
            { name: 'North', data: [42, 55, 61, 58, 66] },
            { name: 'South', data: [30, 34, 39, 45, 41] },
          ],
        }),
        text({ content: 'orientation: "horizontal" (multi-series)', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'donut',
          height: 220,
          title: 'Custom Palette, Zero Gap',
          slices: [
            { label: 'Passed', value: 82 },
            { label: 'Failed', value: 9 },
            { label: 'Skipped', value: 9 },
          ],
          colors: ['#0f7a3d', '#b3261e', '#8a8a8a'],
          sliceGap: 0,
        }),
        text({ content: 'colors: [...], sliceGap: 0', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({
      content: `Beyond series colors, a chart's chrome is themeable too: axis.color/gridlineColor/tickColor override the axis line, gridlines, and tick/category text independently of each other; legend.color overrides legend text; and fontFamily (chart-level) applies to every text role — on the PDF export specifically, this now goes through the SAME font registry text() nodes use, so a chart can render in a registered custom font instead of always falling back to a system font in the exported PDF. Mark geometry is configurable too: barCornerRadius (bar charts), lineStrokeWidth and markerRadius (line charts).`,
      fontFamily: BODY_FONT,
      fontSize: 13,
      lineHeight: 20,
    }),
    group({ direction: 'row', gap: 16 }, [
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'bar',
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
        text({ content: 'axis/gridline/tick/legend colors + fontFamily + barCornerRadius: 10', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
      group({ direction: 'column', gap: 6 }, [
        chart({
          chartKind: 'line',
          height: 220,
          title: 'Custom Mark Geometry',
          categories: ['W1', 'W2', 'W3', 'W4', 'W5'],
          series: [{ name: '2026', data: [140, 151, 149, 162, 171] }],
          lineStrokeWidth: 4,
          markerRadius: 7,
        }),
        text({ content: 'lineStrokeWidth: 4, markerRadius: 7', fontFamily: UI_FONT, fontSize: 11, lineHeight: 14, color: '#666666', align: 'center' }),
      ]),
    ]),
    text({ content: 'Interaction Events', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, lineHeight: 26 }),
    separator({ thickness: 1, color: '#dddddd' }),
    text({ content: interactionIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    text({ content: cardIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
    group({ direction: 'row', gap: 12, crossAlign: 'center', interactive: true, droppable: true, accepts: ['avatar'] }, [
      text({
        content: 'JD',
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 22,
        color: '#4f7cff',
        flex: '48px',
        align: 'center',
        interactive: true, // more specific than the card — wins when clicked or dragged directly
        draggable: true,
        dragType: 'avatar',
      }),
      group({ direction: 'column', gap: 2 }, [
        text({ content: 'Jane Doe', fontFamily: UI_FONT, fontSize: 14, fontWeight: 700, lineHeight: 18 }),
        text({ content: 'jane@example.com', fontFamily: BODY_FONT, fontSize: 12, lineHeight: 16, color: '#666666' }),
      ]),
    ]),
  ]),
)

// Wires attachInteractions() up to a visible highlight outline (so hovering/clicking is obvious
// without opening devtools) plus console logging (for the full event payloads: node type, box,
// page number, and — for clicks — the ancestor chain). This is a consumer of the public API only,
// the same way an editor built on this library would be — nothing here reaches into internals.
function setupInteractionDemo(result: ReturnType<typeof paginate>, host: HTMLDivElement): void {
  const controller = attachInteractions(result, host)
  const shadowRoot = host.shadowRoot!

  const highlight = document.createElement('div')
  Object.assign(highlight.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    border: '2px solid #4f7cff',
    background: 'rgba(79, 124, 255, 0.10)',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '10',
  })

  function showHighlight(target: InteractionTarget): void {
    const pageEl = shadowRoot.querySelector<HTMLElement>(`[data-page-number="${target.pageNumber}"]`)
    if (pageEl === null) return
    if (highlight.parentElement !== pageEl) pageEl.appendChild(highlight)
    Object.assign(highlight.style, {
      display: 'block',
      left: `${target.box.x - 5}px`,
      top: `${target.box.y - 5}px`,
      width: `${target.box.width + 10}px`,
      height: `${target.box.height + 10}px`,
    })
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
    showHighlight(e.target)
    console.log('[hover]', e.target.node.type, e.target.box, `page ${e.target.pageNumber}`)
  })
  controller.on('hoverend', e => {
    highlight.style.display = 'none'
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

    const preview = renderPreview(e.target.rendered)
    Object.assign(preview.style, {
      position: 'fixed',
      zIndex: '1000',
      opacity: '0.85',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
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
    const originalBorder = highlight.style.border
    showHighlight(e.dropTarget)
    highlight.style.border = '2px solid #2a9d5c'
    setTimeout(() => {
      highlight.style.border = originalBorder
    }, 250)
  })
}

// Lives outside the shadow root (light DOM), so it's free to use a class name + external CSS
// (`.no-print` in style.css) instead of the inline-styles-only rule that governs the paginated
// document itself — that rule exists to isolate the document from host CSS, not this demo chrome.
function demoButton(label: string, rightOffsetPx: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = label
  button.className = 'no-print'
  Object.assign(button.style, {
    position: 'fixed',
    top: '16px',
    right: `${rightOffsetPx}px`,
    zIndex: '1000',
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
  document.body.appendChild(button)
  return button
}

function setupPrintButton(host: HTMLDivElement): void {
  const button = demoButton('Print', 16)
  button.addEventListener('click', () => printDocument(host))
}

// generatePdf() walks the same PaginatedResult mount() already rendered above — see pdf-render.ts's
// header comment. Both buttons regenerate on each click rather than caching the bytes, since this is
// a demo of the API surface, not a perf-sensitive app; a real integration would generate once and
// reuse the bytes for both actions if the user might invoke either.
function setupPdfButtons(result: ReturnType<typeof paginate>): void {
  const openButton = demoButton('Open PDF', 108)
  openButton.addEventListener('click', () => {
    void (async () => {
      openButton.disabled = true
      openButton.textContent = 'Generating…'
      try {
        openPdfInNewTab(await generatePdf(result, { title: 'Paginator Demo' }))
      } finally {
        openButton.disabled = false
        openButton.textContent = 'Open PDF'
      }
    })()
  })

  const previewButton = demoButton('Preview PDF', 220)
  previewButton.addEventListener('click', () => {
    void (async () => {
      previewButton.disabled = true
      previewButton.textContent = 'Generating…'
      try {
        showPdfDialog(await generatePdf(result, { title: 'Paginator Demo' }), { title: 'PDF Preview' })
      } finally {
        previewButton.disabled = false
        previewButton.textContent = 'Preview PDF'
      }
    })()
  })
}

async function main(): Promise<void> {
  // Registers the literal font FILES this demo's text is set in, before ready()/paginate() ever run
  // — so pretext's canvas measurement and generatePdf()'s embedded PDF glyphs use the exact same
  // bytes (see font-registry.ts). Without this, UI_FONT/BODY_FONT would resolve to whatever system
  // font stack is installed, which generatePdf() cannot embed (no accessible file), and PDF export
  // would fall back to Helvetica with a console warning instead of matching the preview exactly.
  await Promise.all([
    registerFont({ family: 'Inter', weight: 400, url: INTER_REGULAR_URL }),
    registerFont({ family: 'Inter', weight: 700, url: INTER_BOLD_URL }),
    registerFont({ family: 'Source Serif 4', weight: 400, url: SOURCE_SERIF_REGULAR_URL }),
    registerFont({ family: 'Source Serif 4', weight: 700, url: SOURCE_SERIF_BOLD_URL }),
  ])
  await ready()
  const result = paginate(doc)
  const app = document.querySelector<HTMLDivElement>('#app')
  if (app === null) throw new Error('#app not found')
  mount(result, app)
  setupInteractionDemo(result, app)
  setupPrintButton(app)
  setupPdfButtons(result)
}

void main()
