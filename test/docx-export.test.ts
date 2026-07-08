// generateDocx() is mostly bun-testable for the same reason generateXlsx() is: it never touches
// measureNodeHeight/pretext/canvas, only reads TextNode.content/RichTextRun.runs as plain data (see
// src/export/docx-export.ts's header comment). The one path worth flagging is ImageNode -> fetch() —
// verified empirically here to work fine under Bun's fetch() for data: URIs, so it's covered below
// too rather than pushed to browser-only testing.
//
// `docx` has no object-model "load back" API (unlike ExcelJS), so verification unzips the produced
// .docx (a standard OOXML zip) and asserts on word/document.xml's raw markup via substring checks.
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { chart, container, definePage, group, image, pageBreak, richText, rowGroup, separator, table, text } from '../src/core/nodes.ts'
import type { TableColumn, TableRow } from '../src/core/nodes.ts'
import { generateDocx } from '../src/export/docx-export.ts'

const PAGE = { size: 'Letter' as const, margins: { top: 35, right: 35, bottom: 35, left: 35 } }
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  return zip.file('word/document.xml')!.async('string')
}

describe('generateDocx', () => {
  test('renders a text paragraph with bold/color styling', async () => {
    const doc = definePage(PAGE, text({ content: 'Hello World', fontFamily: 'Arial', fontSize: 14, fontWeight: 700, color: '#ff0000' }))
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('Hello World')
    expect(xml).toMatch(/<w:b\/>|<w:b\s/)
    expect(xml).toContain('<w:color w:val="FF0000"/>')
  })

  test('a column group stacks paragraphs in document order', async () => {
    const doc = definePage(
      PAGE,
      group({ direction: 'column' }, [
        text({ content: 'First', fontFamily: 'Arial', fontSize: 12 }),
        text({ content: 'Second', fontFamily: 'Arial', fontSize: 12 }),
      ]),
    )
    const xml = await documentXml(await generateDocx(doc))
    expect(xml.indexOf('First')).toBeLessThan(xml.indexOf('Second'))
  })

  test('a column group\'s gap becomes a real exact-height spacer paragraph between children', async () => {
    const doc = definePage(
      PAGE,
      group({ direction: 'column', gap: 16 }, [
        text({ content: 'First', fontFamily: 'Arial', fontSize: 12 }),
        separator({ thickness: 1, color: '#dddddd' }),
        text({ content: 'Second', fontFamily: 'Arial', fontSize: 12 }),
      ]),
    )
    const xml = await documentXml(await generateDocx(doc))
    // pxToTwip(16) = 240 — one spacer before the separator, one after it (gap applies between EVERY
    // pair of adjacent children, including a separator with no margin of its own).
    expect(xml.match(/w:line="240" w:lineRule="exact"/g)).toHaveLength(2)
  })

  test('a row group\'s gap becomes a right-margin trimmed from each non-last cell', async () => {
    const doc = definePage(PAGE, group({ direction: 'row', gap: 16 }, [text({ content: 'A', fontFamily: 'Arial', fontSize: 12 }), text({ content: 'B', fontFamily: 'Arial', fontSize: 12 })]))
    const xml = await documentXml(await generateDocx(doc))
    // pxToTwip(16) = 240 on the first cell's right margin; the last cell gets 0.
    expect(xml).toContain('<w:tcMar><w:top w:type="dxa" w:w="0"/><w:left w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/><w:right w:type="dxa" w:w="240"/></w:tcMar>')
  })

  test('a row group becomes a borderless single-row table', async () => {
    const doc = definePage(
      PAGE,
      group({ direction: 'row' }, [
        text({ content: 'Left', fontFamily: 'Arial', fontSize: 12 }),
        text({ content: 'Right', fontFamily: 'Arial', fontSize: 12 }),
      ]),
    )
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('Left')
    expect(xml).toContain('Right')
    expect(xml).toContain('<w:insideH w:val="none"/>')
  })

  test('a container becomes a single-cell table carrying background shading', async () => {
    const doc = definePage(PAGE, container({ background: '#eef1f6', padding: 8 }, text({ content: 'Card', fontFamily: 'Arial', fontSize: 12 })))
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('w:fill="EEF1F6"')
    expect(xml).toContain('Card')
  })

  test('a separator becomes a paragraph with only a bottom border', async () => {
    const doc = definePage(PAGE, separator({ thickness: 2, color: '#ff0000' }))
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('<w:pBdr>')
    expect(xml).toContain('w:color="FF0000"')
  })

  test('a separator\'s own paragraph line height is pinned to its thickness, not a default text line', async () => {
    const doc = definePage(PAGE, separator({ thickness: 3 }))
    const xml = await documentXml(await generateDocx(doc))
    // pxToTwip(3) = 45 — the paragraph's own line, not a default ~11pt text line (~220-260 twips).
    expect(xml).toContain('w:line="45" w:lineRule="exact"')
  })

  test('page background is skipped with a warning; page border is not applied at all', async () => {
    const warnSpy = Reflect.get(console, 'warn') as typeof console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    try {
      const doc = definePage(
        { ...PAGE, background: '#f5f8ff', border: { thickness: 3, color: '#4f7cff' } },
        text({ content: 'Body', fontFamily: 'Arial', fontSize: 12 }),
      )
      const xml = await documentXml(await generateDocx(doc))
      expect(xml).not.toContain('pageBorderTop')
      expect(warnings.some(w => w.includes('page background'))).toBe(true)
    } finally {
      console.warn = warnSpy
    }
  })

  // Watermark rendering is currently disabled in docx-export.ts (see its header comment) — re-enable
  // this test alongside that code.
  test.skip('watermark rendering gracefully skips outside a browser (no OffscreenCanvas), with a warning', async () => {
    const warnSpy = Reflect.get(console, 'warn') as typeof console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    try {
      const doc = definePage(
        { ...PAGE, watermark: { kind: 'text', text: 'CONFIDENTIAL' } },
        text({ content: 'Body', fontFamily: 'Arial', fontSize: 12 }),
      )
      const bytes = await generateDocx(doc)
      expect(bytes.length).toBeGreaterThan(0)
      expect(warnings.some(w => w.includes('watermark rendering needs a browser'))).toBe(true)
    } finally {
      console.warn = warnSpy
    }
  })

  test('pageBreak() becomes a native page break run', async () => {
    const doc = definePage(PAGE, group({ direction: 'column' }, [text({ content: 'A', fontFamily: 'Arial', fontSize: 12 }), pageBreak()]))
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('<w:br w:type="page"/>')
  })

  test('richText renders styled runs and a real hyperlink for href', async () => {
    const doc = definePage(
      PAGE,
      richText({
        fontFamily: 'Arial',
        fontSize: 12,
        runs: [{ text: 'plain ' }, { text: 'bold', fontWeight: 700 }, { text: ' and ' }, { text: 'linked', href: 'https://example.com' }],
      }),
    )
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('plain ')
    expect(xml).toContain('bold')
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('linked')
  })

  test('an image node embeds real image data fetched from a data: URI', async () => {
    const doc = definePage(PAGE, image({ src: TINY_PNG, width: 40, height: 40 }))
    const bytes = await generateDocx(doc)
    const zip = await JSZip.loadAsync(bytes)
    const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith('word/media/') && f.endsWith('.png'))
    expect(mediaFiles).toHaveLength(1)
    const xml = await documentXml(bytes)
    expect(xml).toContain('<w:drawing>')
  })

  test('an embedded image explicitly declares no outline (some renderers default to a border otherwise)', async () => {
    const doc = definePage(PAGE, image({ src: TINY_PNG, width: 40, height: 40 }))
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('<a:ln><a:noFill/></a:ln>')
  })

  test('svg nodes are skipped (unsupported in v1), rest of the document still renders', async () => {
    const doc = definePage(
      PAGE,
      group({ direction: 'column' }, [
        text({ content: 'Before', fontFamily: 'Arial', fontSize: 12 }),
        { type: 'svg' as const, markup: '<svg/>', width: 10, height: 10 },
        text({ content: 'After', fontFamily: 'Arial', fontSize: 12 }),
      ]),
    )
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('Before')
    expect(xml).toContain('After')
  })

  // Chart rasterization needs a real DOM (renderChartSvg) + OffscreenCanvas — unavailable under
  // `bun test` (same gap as the watermark's canvas rasterization) — so under bun this should degrade
  // gracefully: skip with a warning, keep the rest of the document intact, never throw. Real
  // rendering is verified separately in a real browser.
  test('chart nodes gracefully skip outside a browser (no DOM/OffscreenCanvas), with a warning', async () => {
    const warnSpy = Reflect.get(console, 'warn') as typeof console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    try {
      const doc = definePage(
        PAGE,
        group({ direction: 'column' }, [
          text({ content: 'Before', fontFamily: 'Arial', fontSize: 12 }),
          chart({ chartKind: 'categorical', categories: ['a', 'b'], series: [{ data: [1, 2] }], width: 200, height: 120 }),
          text({ content: 'After', fontFamily: 'Arial', fontSize: 12 }),
        ]),
      )
      const xml = await documentXml(await generateDocx(doc))
      expect(xml).toContain('Before')
      expect(xml).toContain('After')
      expect(warnings.some(w => w.includes('chart rendering needs a browser'))).toBe(true)
    } finally {
      console.warn = warnSpy
    }
  })

  test('table() renders rows/cells, and a rowSpan cell produces vMerge restart/continue', async () => {
    const columns: TableColumn[] = [{ width: 100 }, { width: 100 }]
    const rows: TableRow[] = rowGroup(['x'], [
      { cells: [{ rowSpan: 2, content: text({ content: 'span', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: 'a', fontFamily: 'Arial', fontSize: 10 }) }] },
      { cells: [{ content: text({ content: 'b', fontFamily: 'Arial', fontSize: 10 }) }] },
    ])
    const doc = definePage(PAGE, table({ columns, rows, border: { mode: 'all' } }))
    const xml = await documentXml(await generateDocx(doc))
    expect(xml).toContain('w:val="restart"')
    expect(xml).toContain('w:val="continue"')
    expect(xml).toContain('span')
    expect(xml).toContain('>a<'.replace('>', '>')) // sanity: cell text present
    expect(xml).toContain('b')
  })

  test('a nested group inside a table cell gets real paragraph breaks and per-run styling, not flattened text', async () => {
    const cellContent = group({ direction: 'column', gap: 2 }, [
      text({ content: 'Widget Deluxe Pro 12', fontFamily: 'Georgia', fontSize: 12, lineHeight: 17 }),
      group({ direction: 'row', gap: 8 }, [
        text({ content: 'SKU: WD-1042', fontFamily: 'Arial', fontSize: 10, lineHeight: 13, color: '#666666', flex: '90px' }),
        text({ content: 'Backordered', fontFamily: 'Arial', fontSize: 10, lineHeight: 13, color: '#b45309' }),
      ]),
    ])
    const doc = definePage(PAGE, table({ columns: [{ width: 300 }], rows: [{ cells: [{ content: cellContent }] }] }))
    const xml = await documentXml(await generateDocx(doc))

    // Two separate paragraphs (title, then the row-as-table below it) — not one flattened run.
    expect(xml.indexOf('Widget Deluxe Pro 12')).toBeLessThan(xml.indexOf('SKU: WD-1042'))
    expect(xml).toContain('w:ascii="Georgia"')
    // Per-run styling preserved: gray SKU label, orange status text — not the flattened fallback
    // (which used to hardcode plain Arial/12/black regardless of the real node's own styling).
    expect(xml).toContain('<w:color w:val="666666"/>')
    expect(xml).toContain('<w:color w:val="B45309"/>')
  })

  test('table cellPadding/column padding/cell padding resolve to real docx cell margins', async () => {
    const doc = definePage(
      PAGE,
      table({
        columns: [{ width: 100 }, { width: 100, padding: 20 }],
        cellPadding: 8,
        rows: [
          {
            cells: [
              { content: text({ content: 'default', fontFamily: 'Arial', fontSize: 10 }) },
              { content: text({ content: 'column-padding', fontFamily: 'Arial', fontSize: 10 }) },
            ],
          },
          { cells: [{ content: text({ content: 'cell-override', fontFamily: 'Arial', fontSize: 10 }), padding: 30 }, { content: text({ content: 'x', fontFamily: 'Arial', fontSize: 10 }) }] },
        ],
      }),
    )
    const xml = await documentXml(await generateDocx(doc))
    // pxToTwip(8) = 120, pxToTwip(20) = 300, pxToTwip(30) = 450 — table default, column override, cell override.
    expect(xml).toContain('<w:tcMar><w:top w:type="dxa" w:w="120"/>')
    expect(xml).toContain('<w:tcMar><w:top w:type="dxa" w:w="300"/>')
    expect(xml).toContain('<w:tcMar><w:top w:type="dxa" w:w="450"/>')
  })

  test('header/footer page-number sentinels become live PAGE/NUMPAGES fields, not literal text', async () => {
    const doc = definePage(
      { ...PAGE, header: () => text({ content: 'Page {{pageNumber}} of {{totalPages}}', fontFamily: 'Arial', fontSize: 10 }) },
      text({ content: 'Body', fontFamily: 'Arial', fontSize: 12 }),
    )
    const bytes = await generateDocx(doc)
    const zip = await JSZip.loadAsync(bytes)
    const headerXml = await zip.file('word/header1.xml')!.async('string')
    expect(headerXml).not.toContain('{{pageNumber}}')
    expect(headerXml).toContain('PAGE')
    expect(headerXml).toContain('NUMPAGES')
  })

  test('metadata maps to document core properties', async () => {
    const doc = definePage(PAGE, text({ content: 'x', fontFamily: 'Arial', fontSize: 12 }))
    const bytes = await generateDocx(doc, { title: 'My Title', author: 'Jane Doe', subject: 'My Subject', keywords: ['a', 'b'] })
    const zip = await JSZip.loadAsync(bytes)
    const coreXml = await zip.file('docProps/core.xml')!.async('string')
    expect(coreXml).toContain('My Title')
    expect(coreXml).toContain('Jane Doe')
    expect(coreXml).toContain('My Subject')
  })
})
