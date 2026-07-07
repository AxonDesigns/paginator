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
import { squarifyTreemap } from '../src/render/chart-geometry.ts'

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
    const node = chart({ chartKind: 'categorical', categories: ['a'], series: [{ data: [1] }], width: 100, height: 80 })
    expect(measureNodeHeight(node, 100)).toBe(80)
  })

  test('is not splittable (atomic)', () => {
    const node = chart({ chartKind: 'radial', rings: [{ slices: [{ label: 'a', value: 1 }] }], width: 100, height: 80 })
    expect(isSplittable(node)).toBe(false)
  })

  describe('categorical (merged bar+line)', () => {
    test('series.kind defaults to "bar" and mixes freely with "line"/"points"', () => {
      const node = chart({
        chartKind: 'categorical',
        categories: ['a', 'b'],
        series: [
          { data: [1, 2] }, // defaults to 'bar'
          { kind: 'line', data: [3, 4], curve: 'monotone', strokeWidth: 3, markerRadius: 5, fill: true },
          { kind: 'points', data: [5, 6], markerRadius: 2 },
        ],
        width: 100,
        height: 80,
      })
      expect(node.series[0]!.kind).toBeUndefined()
      expect(node.series[1]!.kind).toBe('line')
    })

    test('throws when a non-"line" series sets "fill"', () => {
      expect(() =>
        chart({ chartKind: 'categorical', categories: ['a'], series: [{ kind: 'bar', data: [1], fill: true }], width: 100, height: 80 }),
      ).toThrow(/"fill"/)
      expect(() =>
        chart({ chartKind: 'categorical', categories: ['a'], series: [{ kind: 'points', data: [1], fill: true }], width: 100, height: 80 }),
      ).toThrow(/"fill"/)
    })

    test('throws when a "bar" series sets "curve"', () => {
      expect(() =>
        chart({ chartKind: 'categorical', categories: ['a'], series: [{ kind: 'bar', data: [1], curve: 'monotone' }], width: 100, height: 80 }),
      ).toThrow(/"curve"/)
    })

    test('throws when a non-"line" series sets "strokeWidth"', () => {
      expect(() =>
        chart({ chartKind: 'categorical', categories: ['a'], series: [{ kind: 'points', data: [1], strokeWidth: 2 }], width: 100, height: 80 }),
      ).toThrow(/"strokeWidth"/)
    })

    test('throws when a "bar" series sets "markerRadius"', () => {
      expect(() =>
        chart({ chartKind: 'categorical', categories: ['a'], series: [{ kind: 'bar', data: [1], markerRadius: 3 }], width: 100, height: 80 }),
      ).toThrow(/"markerRadius"/)
    })

    test('"points" series may set "curve"/"markerRadius" but not "fill"/"strokeWidth"', () => {
      expect(() =>
        chart({ chartKind: 'categorical', categories: ['a'], series: [{ kind: 'points', data: [1], curve: 'linear', markerRadius: 3 }], width: 100, height: 80 }),
      ).not.toThrow()
    })
  })

  describe('radial (merged pie+donut, rings)', () => {
    test('a plain single-ring pie is rings: [{ slices }]', () => {
      const node = chart({ chartKind: 'radial', rings: [{ slices: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }], width: 100, height: 80 })
      expect(node.rings.length).toBe(1)
    })

    test('throws on a top-level "slices" field', () => {
      expect(() =>
        // @ts-expect-error — exercising the plain-JS-caller guard against the removed top-level shorthand
        chart({ chartKind: 'radial', slices: [{ label: 'a', value: 1 }], width: 100, height: 80 }),
      ).toThrow(/"slices"/)
    })

    test('throws on an empty "rings" array', () => {
      expect(() => chart({ chartKind: 'radial', rings: [], width: 100, height: 80 })).toThrow(/non-empty "rings"/)
    })

    test('throws when ring 0 sets "parentIndex"', () => {
      expect(() =>
        chart({ chartKind: 'radial', rings: [{ slices: [{ label: 'a', value: 1, parentIndex: 0 }] }], width: 100, height: 80 }),
      ).toThrow(/ring 0/)
    })

    test('throws when a ring mixes parented and unparented slices', () => {
      expect(() =>
        chart({
          chartKind: 'radial',
          rings: [
            { slices: [{ label: 'a', value: 1 }] },
            { slices: [{ label: 'x', value: 1, parentIndex: 0 }, { label: 'y', value: 1 }] },
          ],
          width: 100,
          height: 80,
        }),
      ).toThrow(/mixes slices/)
    })

    test('throws when "parentIndex" is out of bounds for the previous ring', () => {
      expect(() =>
        chart({
          chartKind: 'radial',
          rings: [{ slices: [{ label: 'a', value: 1 }] }, { slices: [{ label: 'x', value: 1, parentIndex: 5 }] }],
          width: 100,
          height: 80,
        }),
      ).toThrow(/out of bounds/)
    })

    test('accepts a fully hierarchical sunburst with two rings', () => {
      expect(() =>
        chart({
          chartKind: 'radial',
          rings: [
            { slices: [{ label: 'Fruit', value: 2 }, { label: 'Veg', value: 1 }] },
            {
              slices: [
                { label: 'Apple', value: 1, parentIndex: 0 },
                { label: 'Pear', value: 1, parentIndex: 0 },
                { label: 'Carrot', value: 1, parentIndex: 1 },
              ],
            },
          ],
          width: 100,
          height: 80,
        }),
      ).not.toThrow()
    })

    test('throws on innerRadiusRatio outside [0, 1)', () => {
      expect(() => chart({ chartKind: 'radial', rings: [{ slices: [{ label: 'a', value: 1 }] }], innerRadiusRatio: 1, width: 100, height: 80 })).toThrow(
        /innerRadiusRatio/,
      )
    })
  })

  describe('scatter', () => {
    test('constructs with numeric x/y points', () => {
      const node = chart({ chartKind: 'scatter', series: [{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], width: 100, height: 80 })
      expect(node.series[0]!.points.length).toBe(2)
    })

    test('throws on an empty "series" array', () => {
      expect(() => chart({ chartKind: 'scatter', series: [], width: 100, height: 80 })).toThrow(/non-empty "series"/)
    })

    test('throws on a series with an empty "points" array', () => {
      expect(() => chart({ chartKind: 'scatter', series: [{ points: [] }], width: 100, height: 80 })).toThrow(/non-empty "points"/)
    })

    test('throws on a negative point "size"', () => {
      expect(() => chart({ chartKind: 'scatter', series: [{ points: [{ x: 1, y: 2, size: -1 }] }], width: 100, height: 80 })).toThrow(/"size"/)
    })

    test('throws on an invalid "sizeScale.range"', () => {
      expect(() =>
        chart({ chartKind: 'scatter', series: [{ points: [{ x: 1, y: 2 }] }], sizeScale: { range: [10, 5] }, width: 100, height: 80 }),
      ).toThrow(/sizeScale\.range/)
    })

    test('throws when "xView.domain.min" >= "xView.domain.max"', () => {
      expect(() =>
        chart({ chartKind: 'scatter', series: [{ points: [{ x: 1, y: 2 }] }], xView: { domain: { min: 10, max: 5 } }, width: 100, height: 80 }),
      ).toThrow(/xView\.domain/)
    })

    test('throws on top-level "categories"/"slices"/"rings"', () => {
      expect(() =>
        // @ts-expect-error — exercising the plain-JS-caller guard against fields from other chart kinds
        chart({ chartKind: 'scatter', series: [{ points: [{ x: 1, y: 2 }] }], categories: ['a'], width: 100, height: 80 }),
      ).toThrow(/"categories"/)
    })
  })

  describe('gantt', () => {
    test('constructs with tasks', () => {
      const node = chart({ chartKind: 'gantt', tasks: [{ label: 'A', start: 0, end: 5 }], width: 100, height: 80 })
      expect(node.tasks.length).toBe(1)
    })

    test('passes through chart-level and per-group/per-task header/label styling', () => {
      const node = chart({
        chartKind: 'gantt',
        groupHeaderColor: '#111',
        groupHeaderBackground: '#eee',
        groups: { Build: { color: '#222', background: '#ddd' } },
        taskLabelColor: '#333',
        tasks: [{ label: 'A', start: 0, end: 5, group: 'Build', labelColor: '#b3261e' }],
        width: 100,
        height: 80,
      })
      expect(node.groupHeaderColor).toBe('#111')
      expect(node.groups!.Build!.color).toBe('#222')
      expect(node.taskLabelColor).toBe('#333')
      expect(node.tasks[0]!.labelColor).toBe('#b3261e')
    })

    test('throws on an empty "tasks" array', () => {
      expect(() => chart({ chartKind: 'gantt', tasks: [], width: 100, height: 80 })).toThrow(/non-empty "tasks"/)
    })

    test('throws when a task\'s "end" is before "start"', () => {
      expect(() => chart({ chartKind: 'gantt', tasks: [{ label: 'A', start: 10, end: 5 }], width: 100, height: 80 })).toThrow(/before "start"/)
    })

    test('allows a zero-width milestone task (end === start)', () => {
      expect(() => chart({ chartKind: 'gantt', tasks: [{ label: 'Launch', start: 5, end: 5 }], width: 100, height: 80 })).not.toThrow()
    })

    test('throws on a non-positive "rowHeight"', () => {
      expect(() => chart({ chartKind: 'gantt', tasks: [{ label: 'A', start: 0, end: 5 }], rowHeight: 0, width: 100, height: 80 })).toThrow(/rowHeight/)
    })

    test('throws on top-level "series"', () => {
      expect(() =>
        // @ts-expect-error — exercising the plain-JS-caller guard against fields from other chart kinds
        chart({ chartKind: 'gantt', tasks: [{ label: 'A', start: 0, end: 5 }], series: [], width: 100, height: 80 }),
      ).toThrow(/"series"/)
    })
  })

  describe('radar', () => {
    test('constructs with categories/series, allowing negative values', () => {
      const node = chart({ chartKind: 'radar', categories: ['a', 'b', 'c'], series: [{ data: [1, -2, 3] }], width: 100, height: 80 })
      expect(node.series[0]!.data).toEqual([1, -2, 3])
    })

    test('throws on an empty "categories" array', () => {
      expect(() => chart({ chartKind: 'radar', categories: [], series: [{ data: [] }], width: 100, height: 80 })).toThrow(/non-empty "categories"/)
    })

    test('throws when a series\' "data" length mismatches "categories"', () => {
      expect(() => chart({ chartKind: 'radar', categories: ['a', 'b'], series: [{ data: [1] }], width: 100, height: 80 })).toThrow(/data points/)
    })

    test('throws on an invalid "fill.opacity"', () => {
      expect(() =>
        chart({ chartKind: 'radar', categories: ['a'], series: [{ data: [1], fill: { opacity: 2 } }], width: 100, height: 80 }),
      ).toThrow(/fill\.opacity/)
    })

    test('throws on a negative "markerRadius"', () => {
      expect(() => chart({ chartKind: 'radar', categories: ['a'], series: [{ data: [1] }], markerRadius: -1, width: 100, height: 80 })).toThrow(
        /markerRadius/,
      )
    })

    test('throws on top-level "slices"/"rings"/"tasks"', () => {
      expect(() =>
        // @ts-expect-error — exercising the plain-JS-caller guard against fields from other chart kinds
        chart({ chartKind: 'radar', categories: ['a'], series: [{ data: [1] }], slices: [], width: 100, height: 80 }),
      ).toThrow(/"slices"/)
    })
  })

  describe('candlestick', () => {
    const candle = { open: 10, high: 12, low: 8, close: 11 }

    test('constructs with categories/series of OHLC candles', () => {
      const node = chart({ chartKind: 'candlestick', categories: ['a'], series: [{ data: [candle] }], width: 100, height: 80 })
      expect(node.series[0]!.data[0]).toEqual(candle)
    })

    test('throws on an empty "categories" array', () => {
      expect(() => chart({ chartKind: 'candlestick', categories: [], series: [{ data: [] }], width: 100, height: 80 })).toThrow(/non-empty "categories"/)
    })

    test('throws when a series\' "data" length mismatches "categories"', () => {
      expect(() => chart({ chartKind: 'candlestick', categories: ['a', 'b'], series: [{ data: [candle] }], width: 100, height: 80 })).toThrow(
        /candles/,
      )
    })

    test('throws when "low" is above min(open, close)', () => {
      expect(() =>
        chart({ chartKind: 'candlestick', categories: ['a'], series: [{ data: [{ open: 10, high: 12, low: 11, close: 11 }] }], width: 100, height: 80 }),
      ).toThrow(/"low"/)
    })

    test('throws when "high" is below max(open, close)', () => {
      expect(() =>
        chart({ chartKind: 'candlestick', categories: ['a'], series: [{ data: [{ open: 10, high: 9, low: 8, close: 11 }] }], width: 100, height: 80 }),
      ).toThrow(/"high"/)
    })

    test('throws on a negative "candleWidth"/"wickWidth"', () => {
      expect(() =>
        chart({ chartKind: 'candlestick', categories: ['a'], series: [{ data: [candle] }], candleWidth: -1, width: 100, height: 80 }),
      ).toThrow(/candleWidth/)
      expect(() =>
        chart({ chartKind: 'candlestick', categories: ['a'], series: [{ data: [candle] }], wickWidth: -1, width: 100, height: 80 }),
      ).toThrow(/wickWidth/)
    })

    test('throws on top-level "slices"/"rings"/"tasks"', () => {
      expect(() =>
        // @ts-expect-error — exercising the plain-JS-caller guard against fields from other chart kinds
        chart({ chartKind: 'candlestick', categories: ['a'], series: [{ data: [candle] }], tasks: [], width: 100, height: 80 }),
      ).toThrow(/"slices"/)
    })
  })

  describe('treemap', () => {
    test('constructs with items', () => {
      const node = chart({ chartKind: 'treemap', items: [{ label: 'a', value: 10 }, { label: 'b', value: 5 }], width: 100, height: 80 })
      expect(node.items.length).toBe(2)
    })

    test('throws on an empty "items" array', () => {
      expect(() => chart({ chartKind: 'treemap', items: [], width: 100, height: 80 })).toThrow(/non-empty "items"/)
    })

    test('throws on a negative "value"', () => {
      expect(() => chart({ chartKind: 'treemap', items: [{ label: 'a', value: -1 }], width: 100, height: 80 })).toThrow(/"value"/)
    })

    test('allows a zero "value" (degenerates to no visible rectangle)', () => {
      expect(() => chart({ chartKind: 'treemap', items: [{ label: 'a', value: 0 }, { label: 'b', value: 5 }], width: 100, height: 80 })).not.toThrow()
    })

    test('throws on a non-finite "value"', () => {
      expect(() => chart({ chartKind: 'treemap', items: [{ label: 'a', value: Infinity }], width: 100, height: 80 })).toThrow(/"value"/)
    })

    test('throws on a negative "itemGap"', () => {
      expect(() => chart({ chartKind: 'treemap', items: [{ label: 'a', value: 1 }], itemGap: -1, width: 100, height: 80 })).toThrow(/itemGap/)
    })

    test('throws on top-level "categories"/"series"', () => {
      expect(() =>
        // @ts-expect-error — exercising the plain-JS-caller guard against fields from other chart kinds
        chart({ chartKind: 'treemap', items: [{ label: 'a', value: 1 }], categories: ['a'], width: 100, height: 80 }),
      ).toThrow(/"categories"/)
    })
  })
})

describe('squarifyTreemap (chart-geometry.ts)', () => {
  const box = { x: 0, y: 0, width: 200, height: 100 }

  test('tiles the box exactly — every rect area sums to the box area', () => {
    const items = [{ value: 40 }, { value: 30 }, { value: 20 }, { value: 10 }]
    const rects = squarifyTreemap(items, box)
    const totalArea = rects.reduce((acc, r) => acc + r.width * r.height, 0)
    expect(totalArea).toBeCloseTo(box.width * box.height, 5)
  })

  test('each rect area is proportional to its item\'s value', () => {
    const items = [{ value: 40 }, { value: 30 }, { value: 20 }, { value: 10 }]
    const rects = squarifyTreemap(items, box)
    const totalValue = items.reduce((acc, it) => acc + it.value, 0)
    rects.forEach((r, i) => {
      const expectedArea = (items[i]!.value / totalValue) * box.width * box.height
      expect(r.width * r.height).toBeCloseTo(expectedArea, 5)
    })
  })

  test('returns rects in the SAME order as the input items, not sorted order', () => {
    // Smallest value first in the input — squarify sorts internally but must un-sort on the way out.
    const items = [{ value: 5 }, { value: 50 }, { value: 15 }]
    const rects = squarifyTreemap(items, box)
    expect(rects.length).toBe(3)
    const totalValue = 70
    expect(rects[0]!.width * rects[0]!.height).toBeCloseTo((5 / totalValue) * box.width * box.height, 5)
    expect(rects[1]!.width * rects[1]!.height).toBeCloseTo((50 / totalValue) * box.width * box.height, 5)
  })

  test('a zero-value item gets a degenerate zero-area rect', () => {
    const rects = squarifyTreemap([{ value: 0 }, { value: 10 }], box)
    expect(rects[0]!.width * rects[0]!.height).toBe(0)
    expect(rects[1]!.width * rects[1]!.height).toBeCloseTo(box.width * box.height, 5)
  })

  test('empty items produces an empty result', () => {
    expect(squarifyTreemap([], box)).toEqual([])
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
