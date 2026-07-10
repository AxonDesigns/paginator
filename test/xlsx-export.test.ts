// generateXlsx() is fully bun-testable: it never touches measureNodeHeight/pretext/canvas, only
// reads TextNode.content/RichTextRun.runs as plain data (see src/export/xlsx-export.ts's header
// comment) — so round-tripping the output through ExcelJS's own reader is enough to verify
// structural + styling correctness with no browser required.
import { describe, expect, test } from 'bun:test'
import ExcelJS from 'exceljs'
import { container, definePage, group, image, richText, rowGroup, table, text } from '../src/core/nodes.ts'
import type { TableColumn, TableRow } from '../src/core/nodes.ts'
import { generateXlsx } from '../src/export/xlsx-export.ts'

const PAGE = { size: 'Letter' as const, margins: { top: 35, right: 35, bottom: 35, left: 35 } }

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes))
  return workbook
}

describe('generateXlsx', () => {
  test('throws when the document has no table() nodes', async () => {
    const doc = definePage(PAGE, text({ content: 'no tables here', fontFamily: 'Arial', fontSize: 12 }))
    await expect(generateXlsx(doc)).rejects.toThrow(/no table\(\) nodes found/)
  })

  // Runs before any other test that triggers the same "nested content flattened" warning — the
  // exporter warns only ONCE per process (module-level flag, matching this codebase's existing
  // warn-once convention, e.g. font-registry.ts's missing-font warning), so asserting a fresh
  // `console.warn` call only works the first time it's ever triggered in this test file.
  test('nested layout in a cell (e.g. a container) is flattened to plain text with a warning', async () => {
    const warnSpy = Reflect.get(console, 'warn') as typeof console.warn
    let warned = false
    console.warn = (...args: unknown[]) => {
      warned = true
      warnSpy(...args)
    }
    try {
      const t = table({
        columns: [{ width: 200 }],
        rows: [{ cells: [{ content: container({ background: '#eee' }, text({ content: 'nested', fontFamily: 'Arial', fontSize: 10 })) }] }],
      })
      const doc = definePage(PAGE, t)
      const workbook = await loadWorkbook(await generateXlsx(doc))
      expect(workbook.worksheets[0]!.getCell(1, 1).value).toBe('nested')
      expect(warned).toBe(true)
    } finally {
      console.warn = warnSpy
    }
  })

  test('table border.outer.borderRadius is ignored (square corners) with a one-time warning', async () => {
    const warnSpy = Reflect.get(console, 'warn') as typeof console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    try {
      const t = table({
        columns: [{ width: 100 }, { width: 100 }],
        rows: [{ cells: [{ content: text({ content: 'a', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: 'b', fontFamily: 'Arial', fontSize: 10 }) }] }],
        border: { inner: { mode: 'none' }, outer: { borderRadius: 8 } },
      })
      const doc = definePage(PAGE, t)
      await generateXlsx(doc)
      await generateXlsx(doc) // second export must not warn again
      expect(warnings.filter(w => w.includes('borderRadius')).length).toBe(1)
    } finally {
      console.warn = warnSpy
    }
  })

  test('table border.headerSeparator and a row topBorder are each skipped with a one-time warning', async () => {
    const warnSpy = Reflect.get(console, 'warn') as typeof console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    try {
      const t = table({
        columns: [{ width: 100, content: text({ content: 'Item', fontFamily: 'Arial', fontSize: 10 }) }],
        rows: [{ cells: [{ content: text({ content: 'a', fontFamily: 'Arial', fontSize: 10 }) }], topBorder: { thickness: 2 } }],
        border: { headerSeparator: true },
      })
      const doc = definePage(PAGE, t)
      await generateXlsx(doc)
      await generateXlsx(doc) // second export must not warn again
      expect(warnings.filter(w => w.includes('headerSeparator')).length).toBe(1)
      expect(warnings.filter(w => w.includes('topBorder/bottomBorder')).length).toBe(1)
    } finally {
      console.warn = warnSpy
    }
  })

  test('independent border.inner/border.outer thickness resolve to different Excel border styles', async () => {
    const t = table({
      columns: [{ width: 100 }, { width: 100 }],
      rows: [
        { cells: [{ content: text({ content: 'a', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: 'b', fontFamily: 'Arial', fontSize: 10 }) }] },
        { cells: [{ content: text({ content: 'c', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: 'd', fontFamily: 'Arial', fontSize: 10 }) }] },
      ],
      border: { inner: { thickness: 1, color: '#aaaaaa' }, outer: { thickness: 3, color: '#000000' } },
    })
    const doc = definePage(PAGE, t)
    const workbook = await loadWorkbook(await generateXlsx(doc))
    const sheet = workbook.worksheets[0]!
    // Top-left cell: top/left edges are OUTER (thick/black), the shared edge with its row/column
    // neighbor (bottom/right) is INNER (thin/gray).
    const topLeft = sheet.getCell(1, 1).border!
    expect(topLeft.top!.style).toBe('thick')
    expect(topLeft.top!.color!.argb).toBe('FF000000')
    expect(topLeft.bottom!.style).toBe('thin')
    expect(topLeft.bottom!.color!.argb).toBe('FFAAAAAA')
  })

  test('emits one worksheet per table, in document order', async () => {
    const t1 = table({ columns: [{ width: 100, content: text({ content: 'A', fontFamily: 'Arial', fontSize: 10 }) }], rows: [] })
    const t2 = table({ columns: [{ width: 100, content: text({ content: 'B', fontFamily: 'Arial', fontSize: 10 }) }], rows: [] })
    const doc = definePage(PAGE, group({ direction: 'column' }, [t1, t2]))
    const workbook = await loadWorkbook(await generateXlsx(doc))
    expect(workbook.worksheets.map(s => s.name)).toEqual(['Table 1', 'Table 2'])
  })

  test('finds a table nested inside a table cell', async () => {
    const inner = table({ columns: [{ width: 50, content: text({ content: 'X', fontFamily: 'Arial', fontSize: 10 }) }], rows: [] })
    const outer = table({
      columns: [{ width: 200, content: text({ content: 'Outer', fontFamily: 'Arial', fontSize: 10 }) }],
      rows: [{ cells: [{ content: inner }] }],
    })
    const doc = definePage(PAGE, outer)
    const workbook = await loadWorkbook(await generateXlsx(doc))
    expect(workbook.worksheets).toHaveLength(2)
  })

  // Uses image() cells rather than text() deliberately — a 'shrink' column reuses the SAME real
  // resolveColumnWidths() layoutTable does (unlike generateDocx()'s DOM/pretext-free
  // reimplementation), so text content here would pull in pretext's canvas-based measurement, which
  // this file's own header comment already flags as unavailable under `bun test`.
  test('column width: "shrink" sizes an Excel column to its widest colSpan-1 cell', async () => {
    const t = table({
      columns: [{ width: 'shrink' }, { width: 'shrink' }],
      rows: [
        { cells: [{ content: image({ src: 'a.png', width: 40, height: 10 }) }, { content: image({ src: 'b.png', width: 200, height: 10 }) }] },
        { cells: [{ content: image({ src: 'c.png', width: 10, height: 10 }) }, { content: image({ src: 'd.png', width: 20, height: 10 }) }] },
      ],
    })
    const doc = definePage(PAGE, t)
    const workbook = await loadWorkbook(await generateXlsx(doc))
    const columns = workbook.worksheets[0]!.columns
    // Excel column width is in character units (px/7, floored at 4) — column 1's widest cell (200px)
    // should come out visibly wider than column 0's (40px), proportional to their pixel widths.
    expect(columns[1]!.width!).toBeGreaterThan(columns[0]!.width!)
    expect(columns[0]!.width!).toBeCloseTo(40 / 7, 0)
    expect(columns[1]!.width!).toBeCloseTo(200 / 7, 0)
  })

  test('column grouping (header/totals) and stripe desugar into plain rows the exporter reads directly', async () => {
    const columns: TableColumn[] = [
      { width: 3, content: text({ content: 'Item', fontFamily: 'Arial', fontSize: 11, fontWeight: 700 }) },
      { width: '60px', content: text({ content: 'Qty', fontFamily: 'Arial', fontSize: 11, fontWeight: 700 }) },
    ]
    const rows: TableRow[] = [
      { groupValues: ['West'], cells: [{ content: text({ content: 'Widget A', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: '3', fontFamily: 'Arial', fontSize: 10 }), value: '3' }] },
      { groupValues: ['West'], cells: [{ content: text({ content: 'Widget B', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: '5', fontFamily: 'Arial', fontSize: 10 }), value: '5' }] },
      { groupValues: ['East'], cells: [{ content: text({ content: 'Widget C', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: '2', fontFamily: 'Arial', fontSize: 10 }), value: '2' }] },
    ]
    const t = table({
      columns,
      rows,
      cellPadding: 4,
      border: { inner: { color: '#dddddd' }, outer: { color: '#dddddd' } },
      headerBackground: '#eef1f6',
      stripe: { even: '#ffffff', odd: '#f7f9fc' },
      groups: [
        {
          header: value => text({ content: `Warehouse: ${value}`, fontFamily: 'Arial', fontSize: 12, fontWeight: 700 }),
          background: '#eef1f6',
          totals: groupRows => [
            { content: text({ content: 'Total', fontFamily: 'Arial', fontSize: 10, fontWeight: 700 }) },
            { content: text({ content: String(groupRows.reduce((sum, r) => sum + Number(r.cells[1]!.value ?? 0), 0)), fontFamily: 'Arial', fontSize: 10, fontWeight: 700 }) },
          ],
        },
      ],
    })
    const doc = definePage(PAGE, t)
    const workbook = await loadWorkbook(await generateXlsx(doc))
    const sheet = workbook.worksheets[0]!

    // Row 1: auto-generated column-caption header ("Item"/"Qty"), row 2: "Warehouse: West" banner
    // (merged across both columns), rows 3-4: data, row 5: totals, row 6: "Warehouse: East" banner, row 7: data.
    expect(sheet.getCell(1, 1).value).toBe('Item')
    expect(sheet.getCell(2, 1).value).toBe('Warehouse: West')
    expect(sheet.getCell(2, 1).isMerged).toBe(true)
    expect(sheet.getCell(3, 1).value).toBe('Widget A')
    expect(sheet.getCell(4, 1).value).toBe('Widget B')
    expect(sheet.getCell(5, 1).value).toBe('Total')
    expect(sheet.getCell(5, 2).value).toBe('8')
    expect(sheet.getCell(6, 1).value).toBe('Warehouse: East')
    expect(sheet.getCell(7, 1).value).toBe('Widget C')

    // headerBackground fill applied to the auto-generated header row.
    const headerFill = sheet.getCell(1, 1).fill as ExcelJS.FillPattern
    expect(headerFill.fgColor?.argb).toBe('FFEEF1F6')
  })

  test('colSpan/rowSpan merges cells; a rowSpan cell + adjacent ordinary cells share the row', async () => {
    const columns: TableColumn[] = [
      { width: 60 },
      { width: 3 },
      { width: 80 },
    ]
    const rows: TableRow[] = rowGroup(['ignored'], [
      {
        cells: [
          { rowSpan: 2, content: text({ content: 'x2', fontFamily: 'Arial', fontSize: 10 }) },
          { colSpan: 2, content: text({ content: 'Espresso', fontFamily: 'Arial', fontSize: 10 }) },
        ],
      },
      {
        cells: [
          { content: text({ content: 'Double shot', fontFamily: 'Arial', fontSize: 10 }) },
          { content: text({ content: '$4.50', fontFamily: 'Arial', fontSize: 10 }) },
        ],
      },
    ])
    const t = table({ columns, rows, border: { inner: {}, outer: {} } })
    const doc = definePage(PAGE, t)
    const workbook = await loadWorkbook(await generateXlsx(doc))
    const sheet = workbook.worksheets[0]!

    expect(sheet.getCell(1, 1).value).toBe('x2')
    expect(sheet.getCell(1, 1).isMerged).toBe(true) // rowSpan 2 over column 1
    expect(sheet.getCell(2, 1).isMerged).toBe(true)
    expect(sheet.getCell(1, 2).value).toBe('Espresso') // colSpan 2 starting at column 2
    expect(sheet.getCell(1, 3).isMerged).toBe(true)
    expect(sheet.getCell(2, 2).value).toBe('Double shot')
    expect(sheet.getCell(2, 3).value).toBe('$4.50')
  })

  test('richText cells become ExcelJS rich-text values preserving per-run styling', async () => {
    const t = table({
      columns: [{ width: 200 }],
      rows: [
        {
          cells: [
            {
              content: richText({
                fontFamily: 'Arial',
                fontSize: 12,
                runs: [{ text: 'plain ' }, { text: 'bold', fontWeight: 700, color: '#ff0000' }],
              }),
            },
          ],
        },
      ],
    })
    const doc = definePage(PAGE, t)
    const workbook = await loadWorkbook(await generateXlsx(doc))
    const cell = workbook.worksheets[0]!.getCell(1, 1)
    const value = cell.value as ExcelJS.CellRichTextValue
    expect(value.richText.map(r => r.text)).toEqual(['plain ', 'bold'])
    expect(value.richText[1]!.font?.bold).toBe(true)
    expect(value.richText[1]!.font?.color?.argb).toBe('FFFF0000')
  })
})
