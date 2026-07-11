// Tests for src/interaction/hit-registry.ts's identity lookup (findById()) — the id-based
// counterpart to the geometric hitTest()/hitTestDroppable(). Uses only DOM-independent node types
// (image/group), same as test/paginate.test.ts, so these run without jsdom.

import { describe, expect, test } from 'bun:test'
import '../src/nodes/image.ts'
import '../src/nodes/group.ts'
import { definePage, group, image } from '../src/core/nodes.ts'
import { paginate } from '../src/core/paginate.ts'
import { buildHitRegistry, findById, findFragments, hitTest } from '../src/interaction/hit-registry.ts'

const A4_MARGINS = { top: 20, right: 20, bottom: 20, left: 20 }

describe('findById()', () => {
  test('resolves a single node with an id to its page and box', () => {
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group({ direction: 'column', id: 'target' }, [image({ src: 'a.png', width: 100, height: 50 })]),
    )
    const result = paginate(doc)
    const registry = buildHitRegistry(result)
    const matches = findById(registry, 'target')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.pageNumber).toBe(1)
    expect(matches[0]!.node.id).toBe('target')
    expect(matches[0]!.box).toBeDefined()
  })

  test('two different nodes sharing the same id both come back', () => {
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group({ direction: 'column' }, [
        image({ src: 'a.png', width: 100, height: 50, id: 'dup' }),
        image({ src: 'b.png', width: 100, height: 50, id: 'dup' }),
      ]),
    )
    const result = paginate(doc)
    const registry = buildHitRegistry(result)
    const matches = findById(registry, 'dup')
    expect(matches).toHaveLength(2)
    for (const m of matches) expect(m.node.id).toBe('dup')
  })

  test('an unknown id returns an empty array', () => {
    const doc = definePage({ size: 'A4', margins: A4_MARGINS }, image({ src: 'a.png', width: 100, height: 50 }))
    const result = paginate(doc)
    const registry = buildHitRegistry(result)
    expect(findById(registry, 'nope')).toEqual([])
  })

  test('a node split across pages produces one match per page, in ascending page order', () => {
    const { height: pageHeight } = paginate(definePage({ size: 'A4', margins: A4_MARGINS }, image({ src: 'x.png', width: 10, height: 10 }))).pageSize as { height: number }
    const contentBoxHeight = pageHeight - A4_MARGINS.top - A4_MARGINS.bottom
    // Enough 100px-tall images to force at least 3 pages (same sizing as paginate.test.ts).
    const n = Math.ceil((contentBoxHeight * 2.5) / 100)
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group(
        { direction: 'column', id: 'long' },
        Array.from({ length: n }, (_, i) => image({ src: `${i}.png`, width: 100, height: 100 })),
      ),
    )
    const result = paginate(doc)
    expect(result.pages.length).toBeGreaterThanOrEqual(3)
    const registry = buildHitRegistry(result)
    const matches = findById(registry, 'long')
    expect(matches.length).toBe(result.pages.length)
    for (const m of matches) expect(m.node.id).toBe('long')
    const pageNumbers = matches.map(m => m.pageNumber)
    expect(pageNumbers).toEqual([...pageNumbers].sort((a, b) => a - b))
  })
})

describe('findFragments()', () => {
  test('a node split across pages resolves to one fragment per page, with no authored id at all', () => {
    const { height: pageHeight } = paginate(definePage({ size: 'A4', margins: A4_MARGINS }, image({ src: 'x.png', width: 10, height: 10 }))).pageSize as { height: number }
    const contentBoxHeight = pageHeight - A4_MARGINS.top - A4_MARGINS.bottom
    const n = Math.ceil((contentBoxHeight * 2.5) / 100)
    const doc = definePage(
      { size: 'A4', margins: A4_MARGINS },
      group(
        { direction: 'column', interactive: true },
        Array.from({ length: n }, (_, i) => image({ src: `${i}.png`, width: 100, height: 100 })),
      ),
    )
    const result = paginate(doc)
    expect(result.pages.length).toBeGreaterThanOrEqual(3)
    const registry = buildHitRegistry(result)
    const firstPageTarget = hitTest(registry, 1, A4_MARGINS.left + 1, A4_MARGINS.top + 1)
    expect(firstPageTarget).not.toBeNull()
    const fragments = findFragments(registry, firstPageTarget!)
    expect(fragments.length).toBe(result.pages.length)
    const pageNumbers = fragments.map(f => f.pageNumber)
    expect(pageNumbers).toEqual([...pageNumbers].sort((a, b) => a - b))
  })

  test('a node that was never split degrades to just the target itself', () => {
    const doc = definePage({ size: 'A4', margins: A4_MARGINS }, group({ direction: 'column', interactive: true }, [image({ src: 'a.png', width: 100, height: 50 })]))
    const result = paginate(doc)
    const registry = buildHitRegistry(result)
    const target = hitTest(registry, 1, A4_MARGINS.left + 1, A4_MARGINS.top + 1)
    expect(target).not.toBeNull()
    expect(findFragments(registry, target!)).toEqual([target])
  })
})
