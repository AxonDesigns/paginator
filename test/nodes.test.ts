// Layout tests for the DOM-independent built-in node types, driven entirely through the public
// generic dispatchers in behavior.ts (measureNodeHeight/layoutNodeFull/splitNode/isSplittable) —
// never each node module's internal functions directly — so these tests double as end-to-end proof
// that every migrated type still self-registers and dispatches correctly post-refactor.
//
// text/richText/svg are excluded here: they depend on browser-only APIs (canvas text measurement,
// DOMParser) unavailable under `bun test` — see test/behavior.test.ts's header comment. Every node
// type used below (image/separator/page-break/container/group/table/chart) is pure arithmetic, so
// importing them is enough to self-register with no DOM required.

import { describe, expect, test } from 'bun:test'
import '../src/nodes/image.ts'
import '../src/nodes/separator.ts'
import '../src/nodes/page-break.ts'
import '../src/nodes/container.ts'
import '../src/nodes/group.ts'
import '../src/nodes/table/index.ts'
import '../src/nodes/chart/index.ts'
import { isSplittable, layoutNodeFull, measureNodeHeight, splitNode } from '../src/core/behavior.ts'
import { chart, container, group, image, pageBreak, separator, table } from '../src/core/nodes.ts'
import type { RenderedNode } from '../src/core/geometry.ts'

describe('image', () => {
  test('measureHeight uses explicit height', () => {
    const node = image({ src: 'a.png', width: 100, height: 50 })
    expect(measureNodeHeight(node, 100)).toBe(50)
  })

  test('measureHeight derives height from aspectRatio at the given width', () => {
    const node = image({ src: 'a.png', aspectRatio: 2 })
    expect(measureNodeHeight(node, 200)).toBe(100)
  })

  test('is not splittable', () => {
    expect(isSplittable(image({ src: 'a.png', width: 10, height: 10 }))).toBe(false)
  })
})

describe('separator', () => {
  test('measureHeight = thickness + 2*margin', () => {
    expect(measureNodeHeight(separator({ thickness: 3, margin: 5 }), 100)).toBe(13)
  })

  test('defaults to thickness 1, margin 0', () => {
    expect(measureNodeHeight(separator(), 100)).toBe(1)
  })

  test('is not splittable', () => {
    expect(isSplittable(separator())).toBe(false)
  })
})

describe('page-break', () => {
  test('measures zero height and is not splittable', () => {
    const node = pageBreak()
    expect(measureNodeHeight(node, 100)).toBe(0)
    expect(isSplittable(node)).toBe(false)
  })
})

describe('chart', () => {
  test('measureHeight uses explicit height', () => {
    const node = chart({ chartKind: 'bar', categories: ['a'], series: [{ data: [1] }], width: 100, height: 80 })
    expect(measureNodeHeight(node, 100)).toBe(80)
  })

  test('is not splittable (atomic)', () => {
    const node = chart({ chartKind: 'pie', slices: [{ label: 'a', value: 1 }], width: 100, height: 80 })
    expect(isSplittable(node)).toBe(false)
  })
})

describe('container', () => {
  test('measureHeight is max(height, childHeight + padding)', () => {
    const node = container({ padding: 10, height: 20 }, separator({ thickness: 4 }))
    // child height = 4 (separator), + 2*10 padding = 24 > explicit height 20
    expect(measureNodeHeight(node, 100)).toBe(24)
  })

  test('honors an explicit height taller than the child', () => {
    const node = container({ height: 500 }, separator({ thickness: 4 }))
    expect(measureNodeHeight(node, 100)).toBe(500)
  })

  test('isSplittable delegates to whether its child is splittable', () => {
    // A column group with children is splittable; a bare separator is not.
    expect(isSplittable(container({}, separator()))).toBe(false)
    expect(isSplittable(container({}, group({ direction: 'column' }, [separator(), separator()])))).toBe(true)
  })

  test('layout insets the child by padding on every side', () => {
    const node = container({ padding: { top: 1, right: 2, bottom: 3, left: 4 } }, image({ src: 'a.png', width: 50, height: 50 }))
    const rendered = layoutNodeFull(node, 100) as Extract<RenderedNode, { type: 'container' }>
    expect(rendered.child.box.x).toBe(4)
    expect(rendered.child.box.y).toBe(1)
    expect(rendered.box.height).toBe(50 + 1 + 3)
  })
})

describe('group (column)', () => {
  test('measureHeight sums children heights plus gaps', () => {
    const node = group({ direction: 'column', gap: 5 }, [separator({ thickness: 2 }), separator({ thickness: 3 }), separator({ thickness: 4 })])
    // 2 + 3 + 4 + 2 gaps * 5 = 19
    expect(measureNodeHeight(node, 100)).toBe(19)
  })

  test('is splittable', () => {
    expect(isSplittable(group({ direction: 'column' }, [separator()]))).toBe(true)
  })

  test('split cuts between children at the page boundary', () => {
    const node = group({ direction: 'column' }, [
      image({ src: 'a.png', width: 100, height: 30 }),
      image({ src: 'b.png', width: 100, height: 30 }),
      image({ src: 'c.png', width: 100, height: 30 }),
    ])
    const outcome = splitNode(node, 100, 50) // only the first child (30px) fits within 50
    expect(outcome).not.toBeNull()
    expect(outcome!.consumedHeight).toBe(30)
    const rendered = outcome!.rendered as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children).toHaveLength(1)
    expect(outcome!.rest).not.toBeNull()
    expect((outcome!.rest as { children: unknown[] }).children).toHaveLength(2)
  })
})

describe('group (row)', () => {
  test('measureHeight is the max of its children (cross axis)', () => {
    const node = group({ direction: 'row', gap: 5 }, [
      image({ src: 'a.png', width: 50, height: 10 }),
      image({ src: 'b.png', width: 50, height: 40 }),
    ])
    expect(measureNodeHeight(node, 200)).toBe(40)
  })

  test('is atomic (not splittable) unless splitColumns is set', () => {
    const plain = group({ direction: 'row' }, [image({ src: 'a.png', width: 10, height: 10 })])
    const splittable = group({ direction: 'row', splitColumns: true }, [image({ src: 'a.png', width: 10, height: 10 })])
    expect(isSplittable(plain)).toBe(false)
    expect(isSplittable(splittable)).toBe(true)
  })
})

describe('table', () => {
  test('measureHeight sums row heights', () => {
    const node = table({
      columns: [{}, {}],
      rows: [
        { cells: [{ content: image({ src: 'a.png', width: 10, height: 10 }) }, { content: image({ src: 'a.png', width: 10, height: 10 }) }] },
        { cells: [{ content: image({ src: 'a.png', width: 10, height: 20 }) }, { content: image({ src: 'a.png', width: 10, height: 20 }) }] },
      ],
    })
    expect(measureNodeHeight(node, 200)).toBe(30)
  })

  test('is splittable and split() fits as many whole rows as possible', () => {
    const rowHeight = 20
    const node = table({
      columns: [{}],
      rows: Array.from({ length: 5 }, (_, i) => ({ cells: [{ content: image({ src: `${i}.png`, width: 10, height: rowHeight }) }] })),
    })
    expect(isSplittable(node)).toBe(true)
    const outcome = splitNode(node, 100, 50) // fits 2 full rows (40px), not a 3rd (60px > 50px)
    expect(outcome).not.toBeNull()
    expect(outcome!.consumedHeight).toBe(40)
    const rendered = outcome!.rendered as Extract<RenderedNode, { type: 'table' }>
    expect(rendered.rows).toHaveLength(2)
    expect((outcome!.rest as { rows: unknown[] }).rows).toHaveLength(3)
  })

  test('headerRows repeat on the continuation table', () => {
    const node = table({
      columns: [{}],
      headerRows: 1,
      rows: [
        { cells: [{ content: image({ src: 'h.png', width: 10, height: 10 }) }] }, // header row
        { cells: [{ content: image({ src: '1.png', width: 10, height: 20 }) }] },
        { cells: [{ content: image({ src: '2.png', width: 10, height: 20 }) }] },
      ],
    })
    // header (10) + row 1 (20) = 30 fits within 35; header (10) + row1 (20) + row2 (20) = 50 doesn't.
    const outcome = splitNode(node, 100, 35)
    expect(outcome).not.toBeNull()
    expect(outcome!.consumedHeight).toBe(30) // header + 1 data row
    const rendered = outcome!.rendered as Extract<RenderedNode, { type: 'table' }>
    expect(rendered.rows).toHaveLength(2) // header + 1 data row
    const rest = outcome!.rest as { rows: unknown[]; headerRows: number } | null
    expect(rest).not.toBeNull()
    expect(rest!.headerRows).toBe(1)
    expect(rest!.rows).toHaveLength(2) // repeated header + remaining data row
  })
})
