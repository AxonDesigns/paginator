import { group, rowGroup, separator, table, text } from '../../src/index.ts'
import type { Node, TableCell, TableColumn, TableRow } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'
import { headerCaption } from '../helpers.ts'

const tableIntro = `A table is a fixed grid of rows and columns, not a semantically "correct" HTML table — no thead element, though colSpan/rowSpan cell merging IS supported (see the "Cell Spans" section further down). Column widths use the exact same fixed-px/flex-weight model as a row group's children: "#", "Qty", and "Price" below are fixed-px, "Item" is flexible. Each column's header caption lives directly on the column definition ("content", right alongside "width"/"align") — table() derives one auto-repeating header row from them, so there's no separate row to keep in sync with column order by hand. It repeats automatically at the top of every page this table spans — enough rows are generated here to force at least one page break, so watch for the header reappearing. A cell can hold arbitrary nested content, not just text — row 13's "Item" cell nests a column group containing a row group (SKU + a vertical divider + status), i.e. groups nested inside groups inside a cell, and the last row's "Item" cell opts itself into hover/click/drag independent of the table (try dragging it). Cell/row/column background color, alignment overrides, and independently-configurable inner grid lines vs. outer perimeter ("border.inner"/"border.outer", each with their own mode/thickness/color/style) are all supported — this demo matches them (dashed, same color) and rounds the outer perimeter via "border.outer.borderRadius".`

// Enough rows to force at least one page break. Row 12 (0-indexed) gets a nested group + longer
// content to demonstrate mixed cell heights within one row (paired with verticalAlign: 'center');
// row 5's "Price" cell gets a one-off background override; row 3's "#" cell gets a per-cell
// alignment override; the last row's "Item" cell opts into its own interaction (delegation).
const TABLE_ROW_COUNT = 32

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
        text({ content: `Widget Deluxe Pro ${i}`, fontFamily: BODY_FONT, fontSize: 12 }),
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
        : text({ content: `Widget ${String.fromCharCode(65 + (i % 26))}${i}`, fontFamily: BODY_FONT, fontSize: 12 })

    const hashCell: TableCell = {
      content: text({ content: String(i + 1), fontFamily: UI_FONT, fontSize: 11, color: '#888888' }),
      ...(i === 3 ? { align: 'center' as const } : {}),
    }
    const priceCell: TableCell = {
      content: text({ content: `$${price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12 }),
      ...(i === 5 ? { background: '#ffe8e8' } : {}),
    }

    return {
      background: i % 2 === 1 ? '#f7f9fc' : undefined,
      verticalAlign: isTall ? ('center' as const) : undefined,
      cells: [hashCell, { content: itemContent }, { content: text({ content: String(qty), fontFamily: UI_FONT, fontSize: 12 }) }, priceCell],
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
      header: value => text({ content: `Warehouse: ${value}`, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700 }),
      background: '#eef1f6',
      totals: rows => [
        { content: text({ content: 'Warehouse total', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 }) },
        { content: text({ content: String(sumCell(rows, 1)), fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 }) },
        { content: text({ content: `$${sumCell(rows, 2).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 }) },
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
        { content: text({ content: String(sumCell(rows, 1)), fontFamily: UI_FONT, fontSize: 11 }) },
        { content: text({ content: `$${sumCell(rows, 2).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11 }) },
      ],
    },
  ],
  rows: inventoryRows.map(r => ({
    groupValues: [r.warehouse, r.status],
    cells: [
      { content: text({ content: r.item, fontFamily: BODY_FONT, fontSize: 12 }) },
      { content: text({ content: String(r.qty), fontFamily: UI_FONT, fontSize: 12 }), value: String(r.qty) },
      { content: text({ content: `$${r.price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12 }), value: String(r.price) },
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
        { colSpan: 2, content: text({ content: item.name, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700 }) },
      ],
    },
    {
      // Column 0 (Qty) is skipped automatically — occupied by the rowSpan cell above.
      cells: [
        { content: text({ content: item.detail, fontFamily: BODY_FONT, fontSize: 11, color: '#666666' }) },
        { content: text({ content: `$${item.price.toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12 }), value: String(item.price) },
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
        { colSpan: 2, content: text({ content: value, fontFamily: UI_FONT, fontSize: 13, fontWeight: 700 }) },
        { content: text({ content: `${rows.length / 2} items`, fontFamily: UI_FONT, fontSize: 11, color: '#666666' }) },
      ],
      background: '#eef1f6',
      // colSpan works on a totals() row too — the label spans the Qty+Item columns instead of
      // needing a separate blank Qty cell.
      totals: rows => [
        { colSpan: 2, content: text({ content: 'Category total', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 }) },
        { content: text({ content: `$${sumReceiptPrice(rows).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 }) },
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
    { content: text({ content: `Widget ${String.fromCharCode(65 + i)}`, fontFamily: BODY_FONT, fontSize: 12 }) },
    {
      content: text({ content: String(r.qty), fontFamily: UI_FONT, fontSize: 12, color: r.low ? '#b3261e' : undefined }),
      ...(r.low ? { border: { thickness: 2, color: '#b3261e' } } : {}),
      verticalAlign: 'center',
    },
    { content: text({ content: `$${(4.5 + i * 3).toFixed(2)}`, fontFamily: UI_FONT, fontSize: 12 }) },
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

// Plain table, column grouping, cell spans (colSpan/rowSpan), and finer-grained styling — the four
// "Tables" sub-sections of the demo document.
export const tablesSection: Node[] = [
  text({ content: 'Tables', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: tableIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
  demoTable,
  text({ content: 'Column Grouping', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: groupingIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
  groupedDemoTable,
  text({ content: 'Cell Spans', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: spansIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
  receiptTable,
  text({ content: 'Table Styling', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: tableStylingIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
  stylingTable,
]
