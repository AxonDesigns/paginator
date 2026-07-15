// Layout tests for the DOM-independent built-in node types, driven entirely through the public
// generic dispatchers in behavior.ts (measureNodeHeight/layoutNodeFull/splitNode/isSplittable) —
// never each node module's internal functions directly — so these tests double as end-to-end proof
// that every migrated type still self-registers and dispatches correctly post-refactor.
//
// text/richText/svg are excluded here: they depend on browser-only APIs (canvas text measurement,
// DOMParser) unavailable under `bun test` — see test/behavior.test.ts's header comment. Every node
// type used below (image/qrcode/barcode/separator/page-break/container/group/table/chart) is pure
// arithmetic at layout time — qrcode/barcode's own encode step runs synchronously with no DOM
// dependency either — so importing them is enough to self-register with no DOM required.

import { describe, expect, test } from 'bun:test'
import '../src/nodes/image.ts'
import '../src/nodes/qrcode.ts'
import '../src/nodes/barcode.ts'
import '../src/nodes/separator.ts'
import '../src/nodes/page-break.ts'
import '../src/nodes/container.ts'
import '../src/nodes/group.ts'
import '../src/nodes/table/index.ts'
import '../src/nodes/chart/index.ts'
import { isSplittable, layoutNodeFull, measureNodeHeight, splitNode } from '../src/core/behavior.ts'
import { barcode, chart, container, group, image, pageBreak, qrcode, separator, table, text } from '../src/core/nodes.ts'
import type { TableRow } from '../src/core/nodes.ts'
import type { RenderedNode, RenderedTableRow } from '../src/core/geometry.ts'
import { estimateChartTextWidth, estimateTextWidth, normalizeChartText, squarifyTreemap, wrapChartTextToWidth } from '../src/render/chart-geometry.ts'

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

describe('qrcode', () => {
  test('measureHeight uses explicit height', () => {
    const node = qrcode({ value: 'hello', width: 100, height: 50 })
    expect(measureNodeHeight(node, 100)).toBe(50)
  })

  test('measureHeight derives height from aspectRatio at the given width', () => {
    const node = qrcode({ value: 'hello', aspectRatio: 2 })
    expect(measureNodeHeight(node, 200)).toBe(100)
  })

  test('moduleSize derives a square width/height from the encoded module count', () => {
    const node = qrcode({ value: 'hello', moduleSize: 4, quietZone: 4 })
    expect(node.width).toBeDefined()
    expect(node.width).toBe(node.height)
    // Every QR module count is 21 + 4n; width = (moduleCount + 2*quietZone) * moduleSize.
    const moduleCount = node.width! / 4 - 4 * 2
    expect((moduleCount - 21) % 4).toBe(0)
  })

  test('throws when given none of width/height/aspectRatio/moduleSize', () => {
    expect(() => qrcode({ value: 'hello' })).toThrow(/"moduleSize"/)
  })

  test('throws on an empty value', () => {
    expect(() => qrcode({ value: '', width: 100, height: 100 })).toThrow(/non-empty/)
  })

  test('is not splittable', () => {
    expect(isSplittable(qrcode({ value: 'hello', width: 100, height: 100 }))).toBe(false)
  })
})

describe('barcode', () => {
  test('measureHeight uses explicit height', () => {
    const node = barcode({ value: '12345678', width: 200, height: 60 })
    expect(measureNodeHeight(node, 200)).toBe(60)
  })

  test('measureHeight derives height from aspectRatio at the given width', () => {
    const node = barcode({ value: '12345678', width: 200, aspectRatio: 4 })
    expect(measureNodeHeight(node, 200)).toBe(50)
  })

  test('barWidth derives width from the encoded module count', () => {
    const node = barcode({ value: 'CODE39', symbology: 'code39', barWidth: 2, quietZone: 10, height: 60 })
    // 8 chars * 15 modules + 7 gaps = 127 modules (see barcode-encode.test.ts) -> 2*127 + 2*10 = 274.
    expect(node.width).toBe(2 * 127 + 2 * 10)
  })

  test('throws when given neither width nor barWidth', () => {
    expect(() => barcode({ value: '12345678', height: 60 })).toThrow(/"width" or "barWidth"/)
  })

  test('throws when given neither height nor aspectRatio', () => {
    expect(() => barcode({ value: '12345678', width: 200 })).toThrow(/"height" or "aspectRatio"/)
  })

  test('rotation: 90/-90 makes barWidth derive height instead of width', () => {
    const node90 = barcode({ value: 'CODE39', symbology: 'code39', rotation: 90, barWidth: 2, quietZone: 10, width: 60 })
    const nodeMinus90 = barcode({ value: 'CODE39', symbology: 'code39', rotation: -90, barWidth: 2, quietZone: 10, width: 60 })
    expect(node90.height).toBe(2 * 127 + 2 * 10)
    expect(nodeMinus90.height).toBe(2 * 127 + 2 * 10)
    expect(node90.width).toBe(60)
  })

  test('rotation: 90/-90 throws when given neither height nor barWidth', () => {
    expect(() => barcode({ value: '12345678', rotation: 90, width: 60 })).toThrow(/"height" or "barWidth"/)
  })

  test('rotation: 90/-90 throws when given neither width nor aspectRatio', () => {
    expect(() => barcode({ value: '12345678', rotation: 90, barWidth: 2 })).toThrow(/"width" or "aspectRatio"/)
  })

  test('throws on an invalid rotation value', () => {
    // @ts-expect-error exercising the runtime guard for a non-literal-typed caller
    expect(() => barcode({ value: '12345678', rotation: 45, width: 60, height: 200 })).toThrow(/"rotation" must be 0, 90, or -90/)
  })

  test('measureHeight/naturalWidth reflect the FINAL (rotated) box regardless of rotation', () => {
    const node = barcode({ value: '12345678', rotation: 90, barWidth: 2, quietZone: 10, width: 60 })
    // The rotated box's width/height participate in layout exactly like an unrotated one — width
    // stays the declared 60, height is whatever barWidth derived.
    expect(measureNodeHeight(node, 60)).toBe(node.height)
  })

  test('throws on a value invalid for the chosen symbology (ean13 needs 12-13 digits)', () => {
    expect(() => barcode({ value: 'not-digits', symbology: 'ean13', width: 200, height: 60 })).toThrow()
  })

  test('is not splittable', () => {
    expect(isSplittable(barcode({ value: '12345678', width: 200, height: 60 }))).toBe(false)
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

  test('style does not affect measureHeight (thickness/margin still drive main-axis size)', () => {
    expect(measureNodeHeight(separator({ thickness: 3, margin: 5, style: 'dotted' }), 100)).toBe(13)
  })
})

describe('text', () => {
  // Only the builder's own construction, never layout/measurement (which needs pretext's
  // canvas-based text measurement — see this file's header comment) — `orientation` round-trips
  // onto the node with no validation of its own (unlike image()'s required dimensions), since
  // vertical text wraps against the exact same ambient width ordinary text does.
  test('orientation round-trips onto the node unvalidated', () => {
    const node = text({ content: 'hi', fontFamily: 'Arial', fontSize: 10, orientation: 'vertical-inverted' })
    expect(node.orientation).toBe('vertical-inverted')
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

describe('normalizeChartText (chart-geometry.ts)', () => {
  test('a plain string resolves to one line, one run, at the ambient defaults', () => {
    const lines = normalizeChartText('hello', { fontSize: 11, color: '#111' })
    expect(lines).toEqual([[{ text: 'hello', fontSize: 11, color: '#111', opacity: 1, fontWeight: undefined, fontStyle: undefined }]])
  })

  test('a run without a "\\n" resolves to one line with that run\'s own style falling back to the ambient default', () => {
    const lines = normalizeChartText([{ text: 'big', fontSize: 20, fontWeight: 700 }, { text: ' small', opacity: 0.6 }], { fontSize: 11, color: '#111' })
    expect(lines.length).toBe(1)
    expect(lines[0]).toEqual([
      { text: 'big', fontSize: 20, color: '#111', opacity: 1, fontWeight: 700, fontStyle: undefined },
      { text: ' small', fontSize: 11, color: '#111', opacity: 0.6, fontWeight: undefined, fontStyle: undefined },
    ])
  })

  test('"\\n" inside a run forces a line break, continuing subsequent runs on the new line', () => {
    const lines = normalizeChartText([{ text: 'node_modules\n' }, { text: '420 MB', opacity: 0.6 }], { fontSize: 12, color: '#fff' })
    expect(lines.length).toBe(2)
    expect(lines[0]!.map(r => r.text)).toEqual(['node_modules'])
    expect(lines[1]!.map(r => r.text)).toEqual(['420 MB'])
  })

  test('a run whose text is only "\\n" produces a blank line with no runs', () => {
    const lines = normalizeChartText([{ text: 'a\n\nb' }], { fontSize: 12, color: '#000' })
    expect(lines.length).toBe(3)
    expect(lines[1]).toEqual([])
  })

  test('an empty string produces a single blank line', () => {
    expect(normalizeChartText('', { fontSize: 12, color: '#000' })).toEqual([[]])
  })
})

describe('estimateChartTextWidth (chart-geometry.ts)', () => {
  test('matches estimateTextWidth for a plain string', () => {
    expect(estimateChartTextWidth('hello', 12)).toBeCloseTo(estimateTextWidth('hello', 12), 5)
  })

  test('sums per-run widths at each run\'s own font size, widest line wins', () => {
    const width = estimateChartTextWidth([{ text: 'ab', fontSize: 20 }, { text: 'cd', fontSize: 10 }], 12)
    expect(width).toBeCloseTo(estimateTextWidth('ab', 20) + estimateTextWidth('cd', 10), 5)
  })

  test('a multi-line value uses the widest line, not the sum of all lines', () => {
    const width = estimateChartTextWidth([{ text: 'short\n' }, { text: 'a much longer second line' }], 12)
    expect(width).toBeCloseTo(estimateTextWidth('a much longer second line', 12), 5)
  })
})

describe('wrapChartTextToWidth (chart-geometry.ts)', () => {
  test('a short title fits on one line unchanged', () => {
    const lines = wrapChartTextToWidth('Short Title', 300, 14, '#000')
    expect(lines.length).toBe(1)
    expect(lines[0]!.map(r => r.text).join('')).toBe('Short Title')
  })

  test('a long title wraps onto multiple lines, each within maxWidth', () => {
    const long = 'This Is A Deliberately Long Chart Title That Cannot Possibly Fit On One Line'
    const lines = wrapChartTextToWidth(long, 150, 14, '#000')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      const lineWidth = line.reduce((sum, r) => sum + estimateTextWidth(r.text, r.fontSize), 0)
      expect(lineWidth).toBeLessThanOrEqual(150)
    }
  })

  test('reassembling every wrapped line reproduces the original words in order', () => {
    const long = 'one two three four five six seven eight'
    const lines = wrapChartTextToWidth(long, 80, 14, '#000')
    const rejoined = lines
      .map(line => line.map(r => r.text).join(''))
      .join(' ')
      .trim()
    expect(rejoined.replace(/\s+/g, ' ')).toBe(long)
  })

  test('an explicit "\\n" still forces its own break independent of word-wrapping', () => {
    const lines = wrapChartTextToWidth('Line One\nLine Two', 1000, 14, '#000')
    expect(lines.length).toBe(2)
    expect(lines[0]!.map(r => r.text).join('')).toBe('Line One')
    expect(lines[1]!.map(r => r.text).join('')).toBe('Line Two')
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

  test('unset crossAlign: a nested GROUP child defaults to "stretch" (full column width)', () => {
    const node = group({ direction: 'column' }, [group({ direction: 'row' }, [image({ src: 'a.png', height: 10, aspectRatio: 4 })])])
    const rendered = layoutNodeFull(node, 300) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(300)
  })

  test('unset crossAlign: a leaf child still defaults to "start" (shrink-wraps to its own natural width)', () => {
    const node = group({ direction: 'column' }, [image({ src: 'a.png', height: 10, aspectRatio: 4 })])
    const rendered = layoutNodeFull(node, 300) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(40)
  })

  test('an explicit crossAlign: "start" on the column overrides a nested GROUP child\'s stretch default', () => {
    const node = group({ direction: 'column', crossAlign: 'start' }, [
      group({ direction: 'row', flex: 'shrink' }, [image({ src: 'a.png', height: 10, aspectRatio: 4 })]),
    ])
    const rendered = layoutNodeFull(node, 300) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(40)
  })

  test('a per-child alignSelf: "start" overrides a nested GROUP child\'s stretch default without affecting siblings', () => {
    const node = group({ direction: 'column' }, [
      group({ direction: 'row', alignSelf: 'start', flex: 'shrink' }, [image({ src: 'a.png', height: 10, aspectRatio: 4 })]),
      group({ direction: 'row' }, [image({ src: 'b.png', height: 10, aspectRatio: 4 })]),
    ])
    const rendered = layoutNodeFull(node, 300) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(40) // alignSelf: 'start' opts out of the stretch default
    expect(rendered.children[1]!.box.width).toBe(300) // sibling still gets the GROUP stretch default
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

  test('flex: "shrink" claims a child\'s own natural width instead of an equal flex-grow share', () => {
    const node = group({ direction: 'row' }, [
      image({ src: 'a.png', width: 40, height: 10, flex: 'shrink' }),
      // an image's own `width` claims a FIXED row-slot size when `flex` is left unset (see "Row
      // flex sizing" in GUIDE.md) — `flex: 1` here forces it flexible instead, to prove 'shrink'
      // opts ITS sibling out of that same default equal-share behavior.
      image({ src: 'b.png', width: 10, height: 10, flex: 1 }),
    ])
    const rendered = layoutNodeFull(node, 200) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(40)
    expect(rendered.children[1]!.box.width).toBe(160)
  })

  test('flex: "shrink" children count as fixed-size, so mainAlign: "center" has free space to center them', () => {
    const node = group({ direction: 'row', mainAlign: 'center' }, [
      image({ src: 'a.png', width: 40, height: 10, flex: 'shrink' }),
      image({ src: 'b.png', width: 20, height: 10, flex: 'shrink' }),
    ])
    const rendered = layoutNodeFull(node, 200) as Extract<RenderedNode, { type: 'group' }>
    // total content width 60px inside a 200px row -> 70px leading offset to center it
    expect(rendered.children[0]!.box.x).toBe(70)
    expect(rendered.children[0]!.box.width).toBe(40)
    expect(rendered.children[1]!.box.x).toBe(110)
    expect(rendered.children[1]!.box.width).toBe(20)
  })

  test('flex: "shrink" on a column with a nested row of leaf children shrink-wraps to content, not full width', () => {
    // Reproduces a real bug: a nested ROW inside a `flex: 'shrink'` column, with ordinary (no
    // explicit width/flex) leaf children — used to make shrinkWrapWidth() bail out to the FULL
    // width offered instead of a content-derived sum, starving the sibling column's default flex
    // down to 0. Leaf children now default to 'shrink' themselves (see "Row flex sizing" in
    // GUIDE.md), so this also doubles as coverage for that default.
    const node = group({ direction: 'row' }, [
      group({ direction: 'column', flex: 'shrink' }, [
        group({ direction: 'row', gap: 5 }, [
          image({ src: 'label.png', height: 10, aspectRatio: 4 }), // no width/flex -> default shrink, natural width 40
          image({ src: 'value.png', height: 10, aspectRatio: 8 }), // no width/flex -> default shrink, natural width 80
        ]),
      ]),
      group({ direction: 'column' }, [image({ src: 'sibling.png', width: 10, height: 10 })]), // GROUP -> default flex: 1
    ])
    const rendered = layoutNodeFull(node, 300) as Extract<RenderedNode, { type: 'group' }>
    // shrink column's natural width: 40 + 80 + 1 gap * 5 = 125, NOT the full 300px offered.
    expect(rendered.children[0]!.box.width).toBe(125)
    expect(rendered.children[1]!.box.width).toBe(175)
  })

  test('flex: "shrink" column takes the max natural width across multiple nested label/value rows, still leaving the flex sibling correctly sized', () => {
    const node = group({ direction: 'row' }, [
      group({ direction: 'column', flex: 'shrink', gap: 2 }, [
        group({ direction: 'row', gap: 5 }, [
          image({ src: 'label1.png', width: 20, height: 10 }), // explicit width -> fixed
          image({ src: 'value1.png', height: 10, aspectRatio: 3 }), // no width/flex -> default shrink, natural width 30
        ]),
        group({ direction: 'row', gap: 5 }, [
          image({ src: 'label2.png', width: 20, height: 10 }),
          image({ src: 'value2.png', height: 10, aspectRatio: 6 }), // natural width 60 -> this row is wider
        ]),
      ]),
      group({ direction: 'column' }, [image({ src: 'sibling.png', width: 10, height: 10 })]),
    ])
    const rendered = layoutNodeFull(node, 300) as Extract<RenderedNode, { type: 'group' }>
    // row1 natural width: 20 + 30 + 5 = 55; row2: 20 + 60 + 5 = 85 -> column shrink-wraps to the wider row.
    expect(rendered.children[0]!.box.width).toBe(85)
    expect(rendered.children[1]!.box.width).toBe(215)
  })

  test('unset flex on a leaf row child defaults to "shrink" (hugs content), not an equal flex-grow share', () => {
    // The actual default-behavior change: three un-pinned leaf children (no flex, no width) used
    // to divide the row equally (flex: 1 each), which could squeeze one below its own content width
    // and force it to wrap. Now each hugs its own natural width instead, left-packed.
    const node = group({ direction: 'row', gap: 10 }, [
      image({ src: 'a.png', height: 10, aspectRatio: 4 }), // natural width 40
      image({ src: 'b.png', height: 10, aspectRatio: 6 }), // natural width 60
      image({ src: 'c.png', height: 10, aspectRatio: 8 }), // natural width 80
    ])
    const rendered = layoutNodeFull(node, 400) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children.map(c => c.box.width)).toEqual([40, 60, 80])
    expect(rendered.children.map(c => c.box.x)).toEqual([0, 50, 120])
  })

  test('unset flex on a nested GROUP row child still defaults to flex weight 1 (grow), unlike a leaf sibling', () => {
    const node = group({ direction: 'row', gap: 10 }, [
      image({ src: 'a.png', height: 10, aspectRatio: 4, flex: 'shrink' }), // fixed, natural width 40
      group({ direction: 'column' }, [image({ src: 'b.png', width: 10, height: 10 })]), // GROUP -> default flex: 1
    ])
    const rendered = layoutNodeFull(node, 200) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(40)
    expect(rendered.children[1]!.box.width).toBe(150) // 200 - 40 - 10 gap
  })

  test('an explicit numeric flex on a leaf child still makes it flexible, overriding the shrink default', () => {
    const node = group({ direction: 'row', gap: 10 }, [
      image({ src: 'a.png', height: 10, aspectRatio: 4, flex: 2 }),
      image({ src: 'b.png', height: 10, aspectRatio: 4, flex: 1 }),
    ])
    const rendered = layoutNodeFull(node, 190) as Extract<RenderedNode, { type: 'group' }>
    expect(rendered.children[0]!.box.width).toBe(120) // (190-10) * 2/3
    expect(rendered.children[1]!.box.width).toBe(60) // (190-10) * 1/3
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

  test('column width: "shrink" sizes to the widest colSpan-1 cell in that column; a flex sibling takes the rest', () => {
    const node = table({
      columns: [{ width: 'shrink' }, { width: 'shrink' }, {}],
      cellPadding: 4,
      rows: [
        {
          cells: [
            { content: image({ src: 'a.png', width: 40, height: 10 }) },
            { content: image({ src: 'b.png', width: 90, height: 10 }) },
            { content: image({ src: 'c.png', width: 10, height: 10 }) },
          ],
        },
        {
          cells: [
            { content: image({ src: 'd.png', width: 20, height: 10 }) },
            { content: image({ src: 'e.png', width: 200, height: 10 }) }, // widest in column 1
            { content: image({ src: 'f.png', width: 10, height: 10 }) },
          ],
        },
      ],
    })
    const rendered = layoutNodeFull(node, 600) as Extract<RenderedNode, { type: 'table' }>
    const row0 = rendered.rows[0] as Extract<RenderedTableRow, { kind: 'cells' }>
    // col 0: widest cell content is 40px + 2*4 padding = 48; col 1: 200 + 8 = 208; col 2 (flex) takes the 344px remainder.
    expect(row0.cells[0]!.box.width).toBe(48)
    expect(row0.cells[1]!.box.width).toBe(208)
    expect(row0.cells[2]!.box.width).toBe(344)
  })

  test('column width: "shrink" ignores colSpan>1 cells when measuring a column\'s natural width', () => {
    const node = table({
      columns: [{ width: 'shrink' }, {}],
      rows: [
        { cells: [{ content: image({ src: 'a.png', width: 999, height: 10 }), colSpan: 2 }] },
        { cells: [{ content: image({ src: 'b.png', width: 30, height: 10 }) }, { content: image({ src: 'c.png', width: 10, height: 10 }) }] },
      ],
    })
    const rendered = layoutNodeFull(node, 200) as Extract<RenderedNode, { type: 'table' }>
    const row1 = rendered.rows[1] as Extract<RenderedTableRow, { kind: 'cells' }>
    // the colSpan-2 cell on row 0 never contributes to column 0's shrink width — only the 30px cell does.
    expect(row1.cells[0]!.box.width).toBe(30)
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

  describe('border.outer.borderRadius validation', () => {
    const columns = [{}]
    const rows = [{ cells: [{ content: image({ src: 'a.png', width: 10, height: 10 }) }] }]

    test('throws when set with outer.mode "horizontal"', () => {
      expect(() => table({ columns, rows, border: { outer: { mode: 'horizontal', borderRadius: 8 } } })).toThrow(/border\.outer\.borderRadius needs border\.outer\.mode "all"/)
    })

    test('throws when set with outer.mode "vertical"', () => {
      expect(() => table({ columns, rows, border: { outer: { mode: 'vertical', borderRadius: 8 } } })).toThrow(/border\.outer\.borderRadius needs border\.outer\.mode "all"/)
    })

    test('throws when set with outer.mode "none"', () => {
      expect(() => table({ columns, rows, border: { outer: { mode: 'none', borderRadius: 8 } } })).toThrow(/border\.outer\.borderRadius needs border\.outer\.mode "all"/)
    })

    test('throws when negative', () => {
      expect(() => table({ columns, rows, border: { outer: { mode: 'all', borderRadius: -1 } } })).toThrow(/cannot be negative/)
    })

    test('does not throw for outer.mode "all"', () => {
      expect(() => table({ columns, rows, border: { outer: { mode: 'all', borderRadius: 8 } } })).not.toThrow()
    })

    test('does not throw for the default outer.mode (unset, defaults to "all")', () => {
      expect(() => table({ columns, rows, border: { outer: { borderRadius: 8 } } })).not.toThrow()
    })

    test('inner.mode does not affect outer.borderRadius validity', () => {
      expect(() => table({ columns, rows, border: { inner: { mode: 'horizontal' }, outer: { mode: 'all', borderRadius: 8 } } })).not.toThrow()
    })
  })

  describe('border.inner/outer/headerSeparator thickness validation', () => {
    const columns = [{}]
    const rows = [{ cells: [{ content: image({ src: 'a.png', width: 10, height: 10 }) }] }]

    test('throws when border.inner.thickness is negative', () => {
      expect(() => table({ columns, rows, border: { inner: { thickness: -1 } } })).toThrow(/border\.inner\.thickness cannot be negative/)
    })

    test('throws when border.outer.thickness is negative', () => {
      expect(() => table({ columns, rows, border: { outer: { thickness: -1 } } })).toThrow(/border\.outer\.thickness cannot be negative/)
    })

    test('throws when border.headerSeparator.thickness is negative', () => {
      expect(() => table({ columns, rows, border: { headerSeparator: { thickness: -1 } } })).toThrow(/border\.headerSeparator\.thickness cannot be negative/)
    })

    test('does not throw when border.headerSeparator is the boolean shorthand', () => {
      expect(() => table({ columns, rows, border: { headerSeparator: true } })).not.toThrow()
    })
  })

  describe('TableGroupLevel.headerBorder/totalsBorder validation', () => {
    const columns = [{ content: text({ content: 'Item', fontFamily: 'Arial', fontSize: 10 }) }]

    test('totalsBorder without totals throws', () => {
      expect(() =>
        table({
          columns,
          rows: [{ groupValues: ['a'], cells: [{ content: image({ src: 'a.png', width: 10, height: 10 }) }] }],
          groups: [{ totalsBorder: { top: { thickness: 2 } } }],
        }),
      ).toThrow(/groups\[0\]\.totalsBorder requires groups\[0\]\.totals to be set/)
    })

    test('headerBorder without totals does not throw', () => {
      expect(() =>
        table({
          columns,
          rows: [{ groupValues: ['a'], cells: [{ content: image({ src: 'a.png', width: 10, height: 10 }) }] }],
          groups: [{ headerBorder: { bottom: { thickness: 2 } } }],
        }),
      ).not.toThrow()
    })

    test('a colSpan totals() row keeps its totalsBorder after resolveCellSpans()', () => {
      const node = table({
        columns: [{ content: text({ content: 'Item', fontFamily: 'Arial', fontSize: 10 }) }, { content: text({ content: 'Qty', fontFamily: 'Arial', fontSize: 10 }) }],
        rows: [{ groupValues: ['a'], cells: [{ content: image({ src: 'a.png', width: 10, height: 10 }) }, { content: image({ src: 'a.png', width: 10, height: 10 }) }] }],
        groups: [
          {
            totals: () => [{ colSpan: 2, content: text({ content: 'Total', fontFamily: 'Arial', fontSize: 10 }) }],
            totalsBorder: { top: { thickness: 3, color: '#ff0000' }, bottom: { thickness: 1 } },
          },
        ],
      })
      const totalsRow = node.rows.find(r => r.kind === 'cells' && r.cells.length === 1)
      expect(totalsRow).toBeDefined()
      expect((totalsRow as Extract<TableRow, { kind?: 'cells' }>).topBorder).toEqual({ thickness: 3, color: '#ff0000' })
      expect((totalsRow as Extract<TableRow, { kind?: 'cells' }>).bottomBorder).toEqual({ thickness: 1 })
    })
  })
})
