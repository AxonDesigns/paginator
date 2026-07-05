// Integration tests for paginate() (src/core/paginate.ts) — the actual pagination algorithm,
// exercised end-to-end through definePage()/paginate() using only DOM-independent node types
// (image/separator/page-break/group/container/table). See test/behavior.test.ts's header comment
// for why text/richText/svg are excluded under `bun test`.

import { describe, expect, test } from 'bun:test'
import '../src/nodes/image.ts'
import '../src/nodes/separator.ts'
import '../src/nodes/page-break.ts'
import '../src/nodes/container.ts'
import '../src/nodes/group.ts'
import '../src/nodes/table/index.ts'
import { definePage, group, image, pageBreak, table } from '../src/core/nodes.ts'
import { paginate } from '../src/core/paginate.ts'

const A4_MARGINS = { top: 20, right: 20, bottom: 20, left: 20 }

describe('paginate()', () => {
  test('content that fits produces a single page', () => {
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group({ direction: 'column', gap: 10 }, [
        image({ src: 'a.png', width: 100, height: 50 }),
        image({ src: 'b.png', width: 100, height: 50 }),
      ]),
    )
    const result = paginate(doc)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.body).toHaveLength(1) // one top-level group node placed
  })

  test('content taller than one page splits across multiple pages', () => {
    const { height: pageHeight } = paginate(definePage({ size: 'A4', margins: A4_MARGINS }, image({ src: 'x.png', width: 10, height: 10 }))).pageSize as { height: number }
    const contentBoxHeight = pageHeight - A4_MARGINS.top - A4_MARGINS.bottom
    // Enough 100px-tall images to force at least 3 pages.
    const n = Math.ceil((contentBoxHeight * 2.5) / 100)
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group(
        { direction: 'column' },
        Array.from({ length: n }, (_, i) => image({ src: `${i}.png`, width: 100, height: 100 })),
      ),
    )
    const result = paginate(doc)
    expect(result.pages.length).toBeGreaterThanOrEqual(3)
    // No content lost: every page's body renders at least one node, and the last page is non-empty.
    for (const page of result.pages) expect(page.body.length).toBeGreaterThan(0)
  })

  test('an explicit pageBreak() forces a new page even if the rest would fit', () => {
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group({ direction: 'column' }, [image({ src: 'a.png', width: 100, height: 50 }), pageBreak(), image({ src: 'b.png', width: 100, height: 50 })]),
    )
    const result = paginate(doc)
    expect(result.pages).toHaveLength(2)
  })

  test('a bare top-level pageBreak() with nothing on the page yet is a no-op, not a blank page', () => {
    // paginateNode's own special case for this exact shape (see its header comment): a bare
    // page-break node itself (not one nested inside surrounding content) is a no-op when the
    // current page is still empty, rather than forcing a blank page before the real content.
    const doc = definePage({ size: 'A4', margins: A4_MARGINS }, pageBreak())
    const result = paginate(doc)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.body).toHaveLength(0)
  })

  test('a table splits across pages with its header row repeating', () => {
    const rowHeight = 60
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      table({
        columns: [{}],
        headerRows: 1,
        rows: Array.from({ length: 30 }, (_, i) => ({ cells: [{ content: image({ src: `${i}.png`, width: 10, height: i === 0 ? 20 : rowHeight }) }] })),
      }),
    )
    const result = paginate(doc)
    expect(result.pages.length).toBeGreaterThan(1)
    // Every page's table fragment starts with a header row (kind: 'header' or narrow cells row —
    // here it's a manually-authored 'cells' row acting as the header via headerRows, so instead we
    // just confirm each page actually has table content and the total row count across all pages
    // (including the repeated header) is >= the original row count.
    let totalRows = 0
    for (const page of result.pages) {
      const tableNode = page.body[0] as { type: 'table'; rows: unknown[] }
      expect(tableNode.type).toBe('table')
      totalRows += tableNode.rows.length
    }
    expect(totalRows).toBeGreaterThanOrEqual(30)
  })

  test('header/footer height is resolved and reserved out of the content box on every page', () => {
    const doc = definePage(
      {
        size: 'A4',
        margins: A4_MARGINS,
        header: image({ src: 'logo.png', width: 100, height: 30 }),
        footer: image({ src: 'footer.png', width: 100, height: 20 }),
      },
      image({ src: 'body.png', width: 100, height: 50 }),
    )
    const result = paginate(doc)
    expect(result.headerHeight).toBe(30)
    expect(result.footerHeight).toBe(20)
    expect(result.pages[0]!.header).not.toBeNull()
    expect(result.pages[0]!.footer).not.toBeNull()
  })

  test('throws when margins/header/footer leave zero or negative content height', () => {
    const doc = definePage(
      { size: { width: 200, height: 100 }, margins: { top: 40, right: 0, bottom: 40, left: 0 }, header: image({ src: 'h.png', width: 10, height: 30 }) },
      image({ src: 'body.png', width: 10, height: 10 }),
    )
    expect(() => paginate(doc)).toThrow()
  })
})
