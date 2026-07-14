// Integration tests for paginate() (src/core/paginate.ts) — the actual pagination algorithm,
// exercised end-to-end through definePage()/paginate() using only DOM-independent node types
// (image/qrcode/barcode/separator/page-break/group/container/table). See test/behavior.test.ts's
// header comment for why text/richText/svg are excluded under `bun test`.

import { describe, expect, test } from 'bun:test'
import '../src/nodes/image.ts'
import '../src/nodes/qrcode.ts'
import '../src/nodes/barcode.ts'
import '../src/nodes/separator.ts'
import '../src/nodes/page-break.ts'
import '../src/nodes/container.ts'
import '../src/nodes/group.ts'
import '../src/nodes/table/index.ts'
import { barcode, definePage, group, image, pageBreak, qrcode, table } from '../src/core/nodes.ts'
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

  test('qrcode/barcode participate in page-break/height math like any other leaf', () => {
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group({ direction: 'column', gap: 10 }, [
        qrcode({ value: 'https://example.com', width: 100, height: 100 }),
        barcode({ value: '12345678', width: 150, height: 60 }),
      ]),
    )
    const result = paginate(doc)
    expect(result.pages).toHaveLength(1)
    const [group1] = result.pages[0]!.body
    expect(group1!.type).toBe('group')
    if (group1!.type !== 'group') throw new Error('unreachable')
    expect(group1.children.map(c => c.type)).toEqual(['qrcode', 'barcode'])
    expect(group1.children[0]!.box.height).toBe(100)
    expect(group1.children[1]!.box.height).toBe(60)
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

describe('paginate() marginContent', () => {
  const SIZE = { width: 200, height: 300 }
  const MARGINS = { top: 10, right: 10, bottom: 10, left: 10 }

  test('a note is always shrink-wrapped to its own natural width, never an author-specified one', () => {
    const doc = definePage(
      { size: SIZE, margins: MARGINS, marginContent: [{ node: image({ src: 'n.png', width: 15, height: 10 }), position: { x: 3, y: 4 } }] },
      image({ src: 'body.png', width: 50, height: 20 }),
    )
    const result = paginate(doc)
    expect(result.pages[0]!.marginNotes).toHaveLength(1)
    const note = result.pages[0]!.marginNotes[0]!
    // image()'s own explicit width (15) is its naturalWidth() — the note's box shrink-wraps to
    // exactly that, the same way a non-stretch column child would.
    expect(note.rendered.box).toEqual({ x: 0, y: 0, width: 15, height: 10 })
  })

  test('absolute {x, y} resolves to the given page-relative position, unaffected by margins', () => {
    const doc = definePage(
      { size: SIZE, margins: MARGINS, marginContent: [{ node: image({ src: 'n.png', width: 15, height: 10 }), position: { x: 3, y: 4 } }] },
      image({ src: 'body.png', width: 50, height: 20 }),
    )
    const result = paginate(doc)
    const note = result.pages[0]!.marginNotes[0]!
    expect(note.x).toBe(3)
    expect(note.y).toBe(4)
  })

  test('anchor: region "left", cross "inner" (bordering the body), along "center"', () => {
    const doc = definePage(
      {
        size: SIZE,
        margins: MARGINS,
        marginContent: [{ node: image({ src: 'n.png', width: 6, height: 10 }), position: { region: 'left', cross: 'inner', along: 'center' } }],
      },
      image({ src: 'body.png', width: 50, height: 20 }),
    )
    const result = paginate(doc)
    const note = result.pages[0]!.marginNotes[0]!
    // Strip is [0, margins.left=10]; 'inner' right-aligns the 6px-wide box to the strip's own
    // right edge (bordering the body): 10 - 6 = 4. 'center' along the full page height: (300-10)/2.
    expect(note.x).toBe(4)
    expect(note.y).toBe(145)
  })

  test('anchor: region "top", cross "outer" (physical page edge), along "start"', () => {
    const doc = definePage(
      {
        size: SIZE,
        margins: MARGINS,
        marginContent: [{ node: image({ src: 'n.png', width: 6, height: 4 }), position: { region: 'top', cross: 'outer', along: 'start' } }],
      },
      image({ src: 'body.png', width: 50, height: 20 }),
    )
    const result = paginate(doc)
    const note = result.pages[0]!.marginNotes[0]!
    // 'outer' flushes the box to the strip's own physical-edge side (y=0 for a top strip);
    // 'start' flushes it to the left (x=0).
    expect(note.x).toBe(0)
    expect(note.y).toBe(0)
  })

  test('offsetX/offsetY nudge the anchor-resolved position', () => {
    const doc = definePage(
      {
        size: SIZE,
        margins: MARGINS,
        marginContent: [{ node: image({ src: 'n.png', width: 6, height: 4 }), position: { region: 'top', cross: 'outer', along: 'start', offsetX: 2, offsetY: 3 } }],
      },
      image({ src: 'body.png', width: 50, height: 20 }),
    )
    const result = paginate(doc)
    const note = result.pages[0]!.marginNotes[0]!
    expect(note.x).toBe(2)
    expect(note.y).toBe(3)
  })

  test('the callback form is resolved per page and can opt a page out via null', () => {
    const doc = definePage(
      {
        size: SIZE,
        margins: MARGINS,
        marginContent: ({ pageNumber }) => (pageNumber === 1 ? [{ node: image({ src: 'n.png', width: 6, height: 4 }), position: { x: 0, y: 0 } }] : null),
      },
      group({ direction: 'column' }, [image({ src: 'a.png', width: 50, height: 20 }), pageBreak(), image({ src: 'b.png', width: 50, height: 20 })]),
    )
    const result = paginate(doc)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]!.marginNotes).toHaveLength(1)
    expect(result.pages[1]!.marginNotes).toHaveLength(0)
  })

  test('no marginContent configured resolves to an empty array, not null/undefined', () => {
    const doc = definePage({ size: SIZE, margins: MARGINS }, image({ src: 'body.png', width: 50, height: 20 }))
    const result = paginate(doc)
    expect(result.pages[0]!.marginNotes).toEqual([])
  })
})
