// Shared main-axis sizing math for a ROW group's children (group.ts) and a table's columns
// (table/layout.ts) — same flex-grow model, different callers. Pure arithmetic with no
// Node-type dispatch, so it carries none of the circular-import concerns node modules have.

export type RowChildSizing = { kind: 'fixed'; size: number } | { kind: 'flex'; weight: number; min?: number; max?: number }

// `min`/`max` are currently only ever set for GroupNode flex children (src/nodes/group.ts,
// src/export/docx-export.ts) — TableColumn has no such concept, so table/layout.ts's `'flex'`
// literals never set them, leaving this an entirely inert no-op for every table/docx-table caller.

/**
 * `availableWidth` should already have any gap total subtracted by the caller.
 *
 * Resolves fixed children to their exact size first, then distributes the remainder among flexible
 * children proportional to weight — same as before. The difference: if a flexible child's `min`/
 * `max` (see `RowChildSizing`) would be violated by its proportional share, it freezes at that
 * bound instead, and the space it gives up (or takes) gets redistributed among the still-flexible
 * siblings in the next pass — the same "resolving flexible lengths" fixed-point algorithm CSS
 * flexbox uses for `flex-grow` vs `min-width`/`max-width`, simplified for this engine's pure-weight
 * model (no `flex-shrink`, no real `flex-basis`). `min` defaults to 0, `max` to `Infinity`, and a
 * conflicting `max` smaller than `min` is raised to `min` (matches CSS: min wins).
 *
 * When nothing sets `min`/`max` anywhere, no child's share can ever violate `[0, Infinity]`, so the
 * loop always resolves in exactly one pass with the same math as before — every existing caller
 * with no min/max is unaffected.
 *
 * Terminates in at most `sizing.length` passes: each non-final pass freezes at least one more
 * child, permanently shrinking the active set, so no iteration cap is needed.
 */
export function resolveFlexWidths(sizing: RowChildSizing[], availableWidth: number): number[] {
  const totalFixed = sizing.reduce((acc, s) => acc + (s.kind === 'fixed' ? s.size : 0), 0)
  const result: number[] = sizing.map(s => (s.kind === 'fixed' ? s.size : 0))
  let remainingForFlex = Math.max(0, availableWidth - totalFixed)
  let active = sizing.map((s, i) => (s.kind === 'flex' ? i : -1)).filter(i => i >= 0)

  while (active.length > 0) {
    const totalWeight = active.reduce((acc, i) => acc + (sizing[i] as Extract<RowChildSizing, { kind: 'flex' }>).weight, 0)
    if (totalWeight <= 0) break // remaining actives keep their 0-initialized result

    const stillActive: number[] = []
    let frozenAmount = 0
    for (const i of active) {
      const s = sizing[i] as Extract<RowChildSizing, { kind: 'flex' }>
      const share = (s.weight / totalWeight) * remainingForFlex
      const min = s.min ?? 0
      const max = Math.max(min, s.max ?? Infinity)
      if (share < min) {
        result[i] = min
        frozenAmount += min
      } else if (share > max) {
        result[i] = max
        frozenAmount += max
      } else {
        stillActive.push(i)
      }
    }

    if (stillActive.length === active.length) {
      // Nothing froze this pass — every still-active child gets its proportional share, done.
      for (const i of stillActive) {
        const s = sizing[i] as Extract<RowChildSizing, { kind: 'flex' }>
        result[i] = (s.weight / totalWeight) * remainingForFlex
      }
      break
    }
    remainingForFlex -= frozenAmount
    active = stillActive
  }
  return result
}
