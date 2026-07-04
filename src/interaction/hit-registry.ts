// Pure-data hit-testing over a PaginatedResult — no DOM queries, works even before mount() is
// called. Sibling boxes can never overlap in this engine (layoutRow/layoutColumn place children
// by strictly accumulating position along the main axis, and a parent's box always contains the
// union of its children's boxes — see group-layout.ts), so geometric descent never has to choose
// between competing matches in practice; the tie-break below is defensive insurance, not a load-
// bearing algorithm.

import type { PaginatedResult } from '../core/paginate.ts'
import type { Node } from '../core/nodes.ts'
import type { Box, RenderedNode } from '../core/geometry.ts'
import { translateRendered } from '../core/geometry.ts'
import type { InteractionAncestor, InteractionRegion, InteractionTarget } from './types.ts'

type RegistryEntry = {
  rendered: RenderedNode
  pageNumber: number
  region: InteractionRegion
  ancestors: InteractionAncestor[]
  children: RegistryEntry[]
}

export type HitRegistry = { pages: Map<number, RegistryEntry[]> }

function regionOrigins(result: PaginatedResult): Record<InteractionRegion, { x: number; y: number }> {
  const { pageSize, margins, headerHeight, headerGap, footerHeight } = result
  return {
    header: { x: margins.left, y: margins.top },
    body: { x: margins.left, y: margins.top + headerHeight + headerGap },
    footer: { x: margins.left, y: pageSize.height - margins.bottom - footerHeight },
  }
}

// Table cells participate in bubble-up hit-testing the same way group children do — this is the
// entire "interaction delegation" mechanism: a cell wrapped in its own `group({interactive: true,
// draggable: true}, [...])` becomes an independent hover/click/drag/drop target, resolved by the
// existing predicates below with zero table-specific interaction logic. A group-header bar's
// `content` delegates the same way — a custom header Node can independently be interactive too —
// and a `cells`-shaped header (see nodes.ts) delegates per-cell, exactly like an ordinary row.
function flatten(rendered: RenderedNode, pageNumber: number, region: InteractionRegion, ancestors: InteractionAncestor[]): RegistryEntry {
  const nextAncestors = [...ancestors, { node: rendered.node, box: rendered.box }]
  const children =
    rendered.type === 'group'
      ? rendered.children.map(c => flatten(c, pageNumber, region, nextAncestors))
      : rendered.type === 'table'
        ? rendered.rows.flatMap(row =>
            row.kind === 'header'
              ? row.cells !== undefined
                ? row.cells.map(c => flatten(c.rendered, pageNumber, region, nextAncestors))
                : [flatten(row.content!, pageNumber, region, nextAncestors)]
              : row.cells.map(c => flatten(c.rendered, pageNumber, region, nextAncestors)),
          )
        : []
  return { rendered, pageNumber, region, ancestors, children }
}

export function buildHitRegistry(result: PaginatedResult): HitRegistry {
  const origins = regionOrigins(result)
  const pages = new Map<number, RegistryEntry[]>()
  for (const page of result.pages) {
    const roots: RegistryEntry[] = []
    if (page.header !== null) {
      roots.push(flatten(translateRendered(page.header, origins.header.x, origins.header.y), page.pageNumber, 'header', []))
    }
    for (const n of page.body) {
      roots.push(flatten(translateRendered(n, origins.body.x, origins.body.y), page.pageNumber, 'body', []))
    }
    if (page.footer !== null) {
      roots.push(flatten(translateRendered(page.footer, origins.footer.x, origins.footer.y), page.pageNumber, 'footer', []))
    }
    pages.set(page.pageNumber, roots)
  }
  return { pages }
}

function boxContains(box: Box, x: number, y: number): boolean {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
}

function descendPath(entry: RegistryEntry, x: number, y: number, path: RegistryEntry[]): RegistryEntry[] {
  path.push(entry)
  let best: RegistryEntry | null = null
  for (const child of entry.children) {
    if (!boxContains(child.rendered.box, x, y)) continue
    if (best === null || child.rendered.box.width * child.rendered.box.height < best.rendered.box.width * best.rendered.box.height) best = child
  }
  return best === null ? path : descendPath(best, x, y, path)
}

function toTarget(entry: RegistryEntry): InteractionTarget {
  return {
    node: entry.rendered.node,
    box: entry.rendered.box,
    pageNumber: entry.pageNumber,
    region: entry.region,
    ancestors: entry.ancestors,
    rendered: entry.rendered,
  }
}

/** Deepest-to-root geometric path at (x, y) on the given page, or null if nothing is there at all. */
function findPath(registry: HitRegistry, pageNumber: number, x: number, y: number): RegistryEntry[] | null {
  const roots = registry.pages.get(pageNumber)
  if (roots === undefined) return null
  const root = roots.find(r => boxContains(r.rendered.box, x, y))
  if (root === undefined) return null
  return descendPath(root, x, y, [])
}

/** Walks a path from its deepest entry back toward the root, returning the first match. */
function findAlongPath(path: RegistryEntry[], predicate: (node: Node) => boolean): RegistryEntry | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (predicate(path[i]!.rendered.node)) return path[i]!
  }
  return null
}

/**
 * Finds the deepest geometric match at (x, y) on the given page, then walks back up toward the
 * root looking for the nearest node (self-or-ancestor) with `interactive: true`. Returns null if
 * nothing at that point is interactive, or if the point isn't over any rendered content at all.
 */
export function hitTest(registry: HitRegistry, pageNumber: number, x: number, y: number): InteractionTarget | null {
  const path = findPath(registry, pageNumber, x, y)
  if (path === null) return null
  const entry = findAlongPath(path, node => node.interactive === true)
  return entry === null ? null : toTarget(entry)
}

/** Normalizes a node's dragType/accepts (string | string[] | undefined) into a plain array. */
export function toTypeList(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

// An untyped drag (dragTypes.length === 0) is a wildcard and matches any droppable node,
// including one with an `accepts` list — the list only filters TYPED drags. A droppable node
// with no `accepts` list matches any drag, typed or not. Otherwise, a match requires at least one
// overlapping type (not "every dragType must be accepted").
function typeMatches(dragTypes: string[], accepts: string[] | undefined): boolean {
  if (dragTypes.length === 0) return true
  if (accepts === undefined) return true
  return dragTypes.some(t => accepts.includes(t))
}

/**
 * Same bubble-up resolution as hitTest(), but for `droppable: true` instead of `interactive: true`
 * — used to resolve a drag's `dropTarget`/`overDropTarget`. Independent of hitTest(): a node can
 * be droppable without being interactive, and vice versa. `dragTypes` (normalize with
 * toTypeList()) additionally filters out a droppable node whose `accepts` list doesn't include any
 * of them, continuing to bubble up for a match rather than stopping at the first droppable node.
 */
export function hitTestDroppable(registry: HitRegistry, pageNumber: number, x: number, y: number, dragTypes: string[] = []): InteractionTarget | null {
  const path = findPath(registry, pageNumber, x, y)
  if (path === null) return null
  const entry = findAlongPath(path, node => node.droppable === true && typeMatches(dragTypes, node.accepts))
  return entry === null ? null : toTarget(entry)
}
