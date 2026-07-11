// Tests the single extension point itself (src/core/behavior.ts) in isolation, using synthetic
// node types registered on the fly — not the real built-in node types (text/table/chart/...),
// which live in src/nodes/* and pull in browser-only APIs (canvas text measurement, DOMParser) that
// aren't available under `bun test`. That's fine: this file's job is to prove the registration
// mechanism itself — registerNode() + the generic dispatchers — works correctly, independent of
// what any particular node type does with it. See test/nodes.test.ts for coverage of the
// DOM-independent built-in node types (image/separator/page-break/container/group/table/chart
// layout logic).

import { describe, expect, test } from 'bun:test'
import { drawPdfNode, isSplittable, layoutNodeFull, measureNodeHeight, naturalWidth, registerNode, renderNodeDom, splitNode } from '../src/core/behavior.ts'
import type { DomRenderCtx, PdfRenderCtx } from '../src/core/behavior.ts'
import type { Node } from '../src/core/nodes.ts'
import type { RenderedNode } from '../src/core/geometry.ts'

// A minimal fake leaf node type, registered under a type tag that will never collide with a real
// built-in ('__fixture_a'/'__fixture_b'). `NodeTypeDefinition<T>`/`SplitOutcome<T>` (behavior.ts)
// both constrain `T extends Node` — this fixture type deliberately ISN'T a member of the real
// (closed) `Node` union, so it can't satisfy that constraint and still needs its own structural
// mirror of the shape below, rather than instantiating those generics directly. That's fine: this
// file is testing the untyped runtime registry, not the type-level contract (covered by the fact
// that src/nodes/* compiles against the real generics at all).
type FixtureNode = { type: '__fixture_a'; height: number; label: string }
type FixtureRendered = { type: '__fixture_a'; box: { x: number; y: number; width: number; height: number }; node: FixtureNode }
type FixtureSplitOutcome = { rendered: RenderedNode; consumedHeight: number; rest: FixtureNode | null } | null

type FixtureDefinition = {
  measureHeight: (node: FixtureNode, width: number) => number
  isSplittable: (node: FixtureNode) => boolean
  split?: (node: FixtureNode, width: number, availableHeight: number) => FixtureSplitOutcome
  layout: (node: FixtureNode, width: number) => FixtureRendered
  naturalWidth?: (node: FixtureNode, availableWidth: number) => number
  renderDom: (rendered: FixtureRendered, x: number, y: number, ctx: DomRenderCtx) => void
  drawPdf: (rendered: FixtureRendered, x: number, y: number, ctx: PdfRenderCtx) => void | Promise<void>
}

function registerFixtureA(overrides: Partial<FixtureDefinition> = {}): void {
  const def: FixtureDefinition = {
    measureHeight: node => node.height,
    isSplittable: () => false,
    layout: (node, width) => ({ type: '__fixture_a', box: { x: 0, y: 0, width, height: node.height }, node }),
    renderDom: () => {},
    drawPdf: () => {},
    ...overrides,
  }
  registerNode('__fixture_a' as Node['type'], def as unknown as Parameters<typeof registerNode>[1])
}

// The only three places a fixture value is unsafely cast to/from the real Node/RenderedNode types.
// Every test below goes through these instead of repeating `as unknown as X` inline, since
// FixtureNode/FixtureRendered structurally can't satisfy those closed unions (see the comment above).
function asNode<T extends { type: string }>(value: T): Node {
  return value as unknown as Node
}

function asFixtureRendered(rendered: RenderedNode): FixtureRendered {
  return rendered as unknown as FixtureRendered
}

function fixtureRendered(node: FixtureNode, box: FixtureRendered['box']): RenderedNode {
  return { type: '__fixture_a', box, node } as unknown as RenderedNode
}

describe('behavior.ts registry', () => {
  test('measureNodeHeight dispatches to the registered type', () => {
    registerFixtureA()
    const node = asNode({ type: '__fixture_a', height: 42, label: 'a' })
    expect(measureNodeHeight(node, 100)).toBe(42)
  })

  test('layoutNodeFull dispatches to the registered type and receives the given width', () => {
    registerFixtureA()
    const node = asNode({ type: '__fixture_a', height: 10, label: 'a' })
    const rendered = asFixtureRendered(layoutNodeFull(node, 250))
    expect(rendered.type).toBe('__fixture_a')
    expect(rendered.box.width).toBe(250)
    expect(rendered.box.height).toBe(10)
  })

  test('isSplittable dispatches to the registered type\'s own isSplittable(node)', () => {
    registerFixtureA({ isSplittable: node => node.label === 'splittable' })
    const yes = asNode({ type: '__fixture_a', height: 1, label: 'splittable' })
    const no = asNode({ type: '__fixture_a', height: 1, label: 'nope' })
    expect(isSplittable(yes)).toBe(true)
    expect(isSplittable(no)).toBe(false)
  })

  test('splitNode returns null when the registered type has no split() implementation', () => {
    registerFixtureA()
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a' })
    expect(splitNode(node, 100, 3)).toBeNull()
  })

  test('splitNode calls the registered split() implementation when present', () => {
    const rest: FixtureNode = { type: '__fixture_a', height: 2, label: 'rest' }
    registerFixtureA({
      split: (node, width): FixtureSplitOutcome => ({
        rendered: fixtureRendered(node, { x: 0, y: 0, width, height: 1 }),
        consumedHeight: 1,
        rest,
      }),
    })
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a' })
    const outcome = splitNode(node, 100, 3)
    expect(outcome).not.toBeNull()
    expect(outcome!.consumedHeight).toBe(1)
    // splitNode() stamps an internal split-lineage id onto both the rendered fragment and `rest`
    // (see core/behavior.ts) so callers can recover every fragment of a split node without an
    // authored `id` — asserted here via omit rather than a hardcoded id, since the id itself is an
    // internal implementation detail (a monotonic counter shared across the whole test file).
    const { __splitGroupId: restGroupId, ...restWithoutGroupId } = outcome!.rest as FixtureNode & { __splitGroupId?: string }
    expect(restWithoutGroupId).toEqual(asNode(rest))
    expect(restGroupId).toBeDefined()
    const renderedNode = outcome!.rendered.node as FixtureNode & { __splitGroupId?: string }
    expect(renderedNode.__splitGroupId).toBe(restGroupId)
  })

  test('naturalWidth falls back to availableWidth when the type registers no naturalWidth()', () => {
    registerFixtureA()
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a' })
    expect(naturalWidth(node, 123)).toBe(123)
  })

  test('naturalWidth clamps the registered naturalWidth() result to availableWidth', () => {
    registerFixtureA({ naturalWidth: () => 9999 })
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a' })
    expect(naturalWidth(node, 50)).toBe(50)
    registerFixtureA({ naturalWidth: () => 10 })
    expect(naturalWidth(node, 50)).toBe(10)
  })

  test('renderNodeDom computes origin-relative x/y, threads unselectable, and hands the type its own renderDom', () => {
    const calls: { x: number; y: number; ctx: DomRenderCtx }[] = []
    registerFixtureA({
      renderDom: (_rendered, x, y, ctx) => {
        calls.push({ x, y, ctx })
      },
    })
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a' })
    const rendered = layoutNodeFull(node, 100)
    const fixture = asFixtureRendered(rendered)
    fixture.box.x = 10
    fixture.box.y = 20
    const container = {} as HTMLElement
    renderNodeDom(rendered, 5, 7, { container, unselectable: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.x).toBe(15) // originX(5) + box.x(10)
    expect(calls[0]!.y).toBe(27) // originY(7) + box.y(20)
    expect(calls[0]!.ctx.container).toBe(container)
    expect(calls[0]!.ctx.unselectable).toBe(false)
  })

  test('renderNodeDom marks unselectable when the node is interactive+draggable, even if the ancestor context was not', () => {
    const calls: DomRenderCtx[] = []
    registerFixtureA({ renderDom: (_r, _x, _y, ctx) => void calls.push(ctx) })
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a', interactive: true, draggable: true })
    const rendered = layoutNodeFull(node, 100)
    renderNodeDom(rendered, 0, 0, { container: {} as HTMLElement, unselectable: false })
    expect(calls[0]!.unselectable).toBe(true)
  })

  test('drawPdfNode computes origin-relative x/y and hands the type its own drawPdf', async () => {
    const calls: { x: number; y: number; ctx: PdfRenderCtx }[] = []
    registerFixtureA({
      drawPdf: (_rendered, x, y, ctx) => {
        calls.push({ x, y, ctx })
      },
    })
    const node = asNode({ type: '__fixture_a', height: 5, label: 'a' })
    const rendered = layoutNodeFull(node, 100)
    const fixture = asFixtureRendered(rendered)
    fixture.box.x = 3
    fixture.box.y = 4
    const fakePdf = {} as PdfRenderCtx['pdf']
    await drawPdfNode(rendered, 1, 2, fakePdf)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.x).toBe(4) // originX(1) + box.x(3)
    expect(calls[0]!.y).toBe(6) // originY(2) + box.y(4)
    expect(calls[0]!.ctx.pdf).toBe(fakePdf)
  })

  test('every generic dispatcher throws a clear error for an unregistered node type', () => {
    const node = asNode({ type: '__never_registered' })
    expect(() => measureNodeHeight(node, 100)).toThrow(/no node type registered/)
    expect(() => layoutNodeFull(node, 100)).toThrow(/no node type registered/)
    expect(() => isSplittable(node)).toThrow(/no node type registered/)
  })
})
