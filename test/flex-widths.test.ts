// Isolated coverage of resolveFlexWidths()'s min/max-aware distribution — pure arithmetic on
// RowChildSizing[] literals, no node tree/layout involved (see test/nodes.test.ts for that side of
// coverage, exercised through real GroupNode.minWidth/maxWidth). This file exists specifically to
// pin down the iterative freeze-and-redistribute algorithm's behavior in isolation, including the
// multi-pass case that's hard to set up incidentally through a real layout.

import { describe, expect, test } from 'bun:test'
import { resolveFlexWidths } from '../src/core/flex-widths.ts'
import type { RowChildSizing } from '../src/core/flex-widths.ts'

describe('resolveFlexWidths', () => {
  test('with no min/max anywhere, splits proportionally by weight in one pass (unchanged from before min/max existed)', () => {
    const sizing: RowChildSizing[] = [
      { kind: 'flex', weight: 1 },
      { kind: 'flex', weight: 2 },
    ]
    expect(resolveFlexWidths(sizing, 90)).toEqual([30, 60])
  })

  test('fixed children still claim their exact size first, flex children split the remainder', () => {
    const sizing: RowChildSizing[] = [
      { kind: 'fixed', size: 50 },
      { kind: 'flex', weight: 1 },
      { kind: 'flex', weight: 1 },
    ]
    expect(resolveFlexWidths(sizing, 250)).toEqual([50, 100, 100])
  })

  test('a maxWidth freezes that child and redistributes the excess to its sibling', () => {
    const sizing: RowChildSizing[] = [
      { kind: 'flex', weight: 1, max: 100 },
      { kind: 'flex', weight: 1 },
    ]
    expect(resolveFlexWidths(sizing, 300)).toEqual([100, 200])
  })

  test('a minWidth floors that child and shrinks its siblings\' shares to make room', () => {
    const sizing: RowChildSizing[] = [
      { kind: 'flex', weight: 1, min: 200 },
      { kind: 'flex', weight: 1 },
      { kind: 'flex', weight: 1 },
    ]
    expect(resolveFlexWidths(sizing, 300)).toEqual([200, 50, 50])
  })

  test('multi-pass: freeing space from one frozen child can push a SECOND child over its own bound only in a later pass', () => {
    // Pass 1 (300 / 3 = 100 each): A's max (50) is violated, freezes at 50. B's max (110) is NOT
    // violated yet (100 <= 110), so B survives pass 1 unfrozen.
    // Pass 2 (250 remaining / 2 = 125 each): NOW B's max (110) is violated, freezes at 110.
    // Pass 3 (140 remaining / 1): C, the only one left, takes the rest.
    // A single-pass (non-iterative) implementation would give B its pass-1 share of 100 and never
    // re-check it after A froze — this test only passes if the loop actually re-evaluates survivors.
    const sizing: RowChildSizing[] = [
      { kind: 'flex', weight: 1, max: 50 },
      { kind: 'flex', weight: 1, max: 110 },
      { kind: 'flex', weight: 1 },
    ]
    expect(resolveFlexWidths(sizing, 300)).toEqual([50, 110, 140])
  })

  test('a conflicting minWidth > maxWidth resolves in favor of minWidth, matching CSS', () => {
    const sizing: RowChildSizing[] = [
      { kind: 'flex', weight: 1, min: 200, max: 100 },
      { kind: 'flex', weight: 1 },
    ]
    expect(resolveFlexWidths(sizing, 300)).toEqual([200, 100])
  })

  test('over-constrained minWidths (their sum exceeds availableWidth) overflow instead of throwing or producing NaN', () => {
    const sizing: RowChildSizing[] = [
      { kind: 'flex', weight: 1, min: 80 },
      { kind: 'flex', weight: 1, min: 80 },
    ]
    expect(resolveFlexWidths(sizing, 100)).toEqual([80, 80])
  })
})
