// The pagination / page-breaking algorithm. A single recursive function handles every case:
// a node fits fully, fits partially (Text via pretext's line-cursor split, or a column Group via
// child-boundary split), or doesn't fit at all (atomic nodes and the zero-content orphan case both
// flow entirely to the next page). A node spanning many pages needs no special-casing — it's just
// this function recursing on `rest` repeatedly.

import type { ContainerBorder, HeaderFooterContent, HeaderFooterContext, Margins, MarginNote, MarginPosition, Node, PageDef, Watermark } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'
import { translateRendered } from './geometry.ts'
import { isSplittable, layoutNodeFull, measureNodeHeight, splitNode } from './behavior.ts'
import { childCrossWidthInColumn, layoutColumn, subtreeHasPageBreak } from '../nodes/group.ts'
import { resolvePageSize } from './page-sizes.ts'

export type PaginatedMarginNote = { rendered: RenderedNode; x: number; y: number }

export type PaginatedPage = {
  pageNumber: number
  header: RenderedNode | null
  body: RenderedNode[]
  footer: RenderedNode | null
  marginNotes: PaginatedMarginNote[]
  watermark: Watermark | null
  background: string | null
  border: ContainerBorder | null
}

export type PaginatedResult = {
  pageSize: { width: number; height: number }
  margins: Margins
  headerHeight: number
  footerHeight: number
  headerGap: number
  footerGap: number
  pages: PaginatedPage[]
}

const EPSILON = 0.01

type PaginationContext = {
  pages: RenderedNode[][]
  y: number
  contentBoxWidth: number
  contentBoxHeight: number
}

function startNewPage(ctx: PaginationContext): void {
  ctx.pages.push([])
  ctx.y = 0
}

function placeOnCurrentPage(ctx: PaginationContext, rendered: RenderedNode, y: number): void {
  ctx.pages[ctx.pages.length - 1]!.push(translateRendered(rendered, 0, y))
}

function paginateNode(node: Node, width: number, ctx: PaginationContext): void {
  // A bare top-level page break (unusual authoring — e.g. doc.body or a `rest` continuation is
  // literally just pageBreak() with nothing else) has no surrounding content in this frame to cut
  // away from, so it's handled directly rather than through the natural-height/split machinery
  // below: force a break unless the current page is still completely empty.
  if (node.type === 'page-break') {
    if (ctx.y > 0) startNewPage(ctx)
    return
  }

  const remaining = ctx.contentBoxHeight - ctx.y
  const atTopOfFreshPage = ctx.y === 0
  const naturalHeight = measureNodeHeight(node, width)

  // Case 1: fits fully on the current page. Guarded by subtreeHasPageBreak so an explicit page
  // break nested inside content that would otherwise fit on one page still gets honored, instead
  // of being silently absorbed by this fast path.
  if (naturalHeight <= remaining + EPSILON && !subtreeHasPageBreak(node)) {
    placeOnCurrentPage(ctx, layoutNodeFull(node, width), ctx.y)
    ctx.y += naturalHeight
    return
  }

  // Case 2: atomic (non-splittable) node — Separator, or Row Group.
  if (!isSplittable(node)) {
    if (atTopOfFreshPage) {
      // Pathological: taller than a whole empty page. Render anyway, overflow, warn.
      placeOnCurrentPage(ctx, layoutNodeFull(node, width), ctx.y)
      ctx.y += naturalHeight
      console.warn(
        `[paginator] "${node.type}" node (${naturalHeight}px) exceeds the full page content height (${ctx.contentBoxHeight}px) and will overflow.`,
      )
      return
    }
    startNewPage(ctx)
    paginateNode(node, width, ctx)
    return
  }

  // Case 3: splittable (Text, or a column Group) — consume as much as fits.
  const splitResult = splitNode(node, width, remaining)

  if (splitResult === null) {
    // Orphan rule: zero content fits in the remaining space.
    if (atTopOfFreshPage) {
      placeOnCurrentPage(ctx, layoutNodeFull(node, width), ctx.y)
      ctx.y += naturalHeight
      console.warn(
        `[paginator] "${node.type}" node cannot fit even a single unit (line/child) within a full page and will overflow.`,
      )
      return
    }
    startNewPage(ctx)
    paginateNode(node, width, ctx)
    return
  }

  // Partial fit: place what fit, continue the remainder on the next page.
  placeOnCurrentPage(ctx, splitResult.rendered, ctx.y)
  ctx.y += splitResult.consumedHeight
  startNewPage(ctx)
  if (splitResult.rest !== null) paginateNode(splitResult.rest, width, ctx)
}

function resolveHeaderFooterContentNode(content: HeaderFooterContent | undefined, pageNumber: number, totalPages: number): Node | null {
  if (content === undefined) return null
  return typeof content === 'function' ? content({ pageNumber, totalPages }) : content
}

function resolveHeaderFooterHeight(content: HeaderFooterContent | undefined, width: number): number {
  const node = resolveHeaderFooterContentNode(content, 1, 1)
  if (node === null) return 0
  return measureNodeHeight(node, width)
}

function renderHeaderFooterForPage(content: HeaderFooterContent | undefined, width: number, pageNumber: number, totalPages: number): RenderedNode | null {
  const node = resolveHeaderFooterContentNode(content, pageNumber, totalPages)
  if (node === null) return null
  return layoutNodeFull(node, width)
}

// Shared by watermark/background/border — all three are page-varying-aware the same way header/
// footer content is (a plain value, or a `{pageNumber, totalPages}` callback producing one), just
// without header/footer's extra Node-layout step. The callback form may also return undefined/null
// to opt a specific page out entirely (e.g. a watermark only on page 1) — `?? null` normalizes that
// alongside the "no content configured at all" case, so callers only ever check a single `=== null`.
function resolvePerPageValue<T>(content: T | ((ctx: HeaderFooterContext) => T | undefined | null) | undefined, pageNumber: number, totalPages: number): T | null {
  if (content === undefined) return null
  const resolved = typeof content === 'function' ? (content as (ctx: HeaderFooterContext) => T | undefined | null)({ pageNumber, totalPages }) : content
  return resolved ?? null
}

// Resolves a MarginPosition to a concrete page-relative (x, y) — the box's own top-left corner —
// given the note's already-known resolved box size (from layoutNodeFull, called before this).
// Absolute positions pass through unchanged; the anchor form aligns the box against one of the 4
// margin strips' own geometry (not the page's corners) — see MarginPosition's doc comment in
// nodes.ts for the full `cross`/`along` vocabulary and worked examples.
function resolveMarginNotePosition(position: MarginPosition, pageWidth: number, pageHeight: number, margins: Margins, boxWidth: number, boxHeight: number): { x: number; y: number } {
  if ('x' in position) return { x: position.x, y: position.y }

  const { region, cross = 'center', along = 'center', offsetX = 0, offsetY = 0 } = position
  let x: number
  let y: number

  if (region === 'left' || region === 'right') {
    const stripStart = region === 'left' ? 0 : pageWidth - margins.right
    const stripWidth = region === 'left' ? margins.left : margins.right
    // cross axis (horizontal): 'inner' = toward the body content box, 'outer' = toward the
    // physical page edge — which physical side that maps to flips between 'left' and 'right'.
    const innerX = region === 'left' ? stripStart + stripWidth - boxWidth : stripStart
    const outerX = region === 'left' ? stripStart : stripStart + stripWidth - boxWidth
    const centerX = stripStart + (stripWidth - boxWidth) / 2
    x = cross === 'inner' ? innerX : cross === 'outer' ? outerX : centerX
    // along axis (vertical, full page height): start = top, end = bottom.
    y = along === 'start' ? 0 : along === 'end' ? pageHeight - boxHeight : (pageHeight - boxHeight) / 2
  } else {
    const stripStart = region === 'top' ? 0 : pageHeight - margins.bottom
    const stripHeight = region === 'top' ? margins.top : margins.bottom
    // cross axis (vertical): 'inner' = toward the body content box, 'outer' = toward the physical
    // page edge — which physical side that maps to flips between 'top' and 'bottom'.
    const innerY = region === 'top' ? stripStart + stripHeight - boxHeight : stripStart
    const outerY = region === 'top' ? stripStart : stripStart + stripHeight - boxHeight
    const centerY = stripStart + (stripHeight - boxHeight) / 2
    y = cross === 'inner' ? innerY : cross === 'outer' ? outerY : centerY
    // along axis (horizontal, full page width): start = left, end = right.
    x = along === 'start' ? 0 : along === 'end' ? pageWidth - boxWidth : (pageWidth - boxWidth) / 2
  }

  return { x: x + offsetX, y: y + offsetY }
}

// Always shrink-wrapped to the note's own natural width via childCrossWidthInColumn() (src/nodes/
// group.ts) — the SAME function a non-stretch column child's cross width already goes through —
// capped at the full page width, since a margin note has no ambient container of its own to
// inherit a width from. Deliberately NOT behavior.ts's generic naturalWidth() dispatcher directly:
// that one has no opinion on `group` nodes (a group's own shrink-wrap math lives entirely in
// group.ts, keyed off its direction/crossAlign/children, not something a single per-type hook could
// express), so calling it on a margin note wrapping e.g. a row group would silently fall through to
// "wants the full page width." childCrossWidthInColumn() special-cases `group` itself before
// falling back to the generic dispatcher for every other type, so it's correct for BOTH cases. This
// makes every node type (text, image, group, container, ...) self-size correctly with no
// author-specified width, and — critically for a rotated text node — self-consistent with
// layoutNodeFull() (see measureTextNaturalWidth()'s own doc comment in nodes/text.ts, and
// naturalWidth()'s own doc comment in core/behavior.ts).
function renderMarginNotesForPage(notes: MarginNote[], pageWidth: number, pageHeight: number, margins: Margins, pageNumber: number, totalPages: number): PaginatedMarginNote[] {
  return notes.map(note => {
    const resolvedNode = typeof note.node === 'function' ? note.node({ pageNumber, totalPages }) : note.node
    const width = childCrossWidthInColumn(resolvedNode, pageWidth)
    const rendered = layoutNodeFull(resolvedNode, width)
    const { x, y } = resolveMarginNotePosition(note.position, pageWidth, pageHeight, margins, rendered.box.width, rendered.box.height)
    return { rendered, x, y }
  })
}

// Single-page body `mainAlign` centering: applied as an isolated post-processing pass so the
// pagination recursion itself never special-cases it. For multi-page documents this has no
// well-defined single-page meaning and is left as `start`-equivalent packing (documented).
function applySinglePageBodyMainAlign(body: Node, pages: RenderedNode[][], contentBoxWidth: number, contentBoxHeight: number): void {
  if (pages.length !== 1 || body.type !== 'group' || body.direction !== 'column') return
  const mainAlign = body.mainAlign ?? 'start'
  if (mainAlign === 'start') return

  const { children } = layoutColumn(body, contentBoxWidth, contentBoxHeight)
  pages[0] = children.map(c => translateRendered(layoutNodeFull(c.node, c.box.width), c.box.x, c.box.y))
}

export function paginate(doc: PageDef): PaginatedResult {
  const { width: pageWidth, height: pageHeight } = resolvePageSize(doc.size)
  const contentBoxWidth = pageWidth - doc.margins.left - doc.margins.right
  const headerHeight = doc.headerHeight ?? resolveHeaderFooterHeight(doc.header, contentBoxWidth)
  const footerHeight = doc.footerHeight ?? resolveHeaderFooterHeight(doc.footer, contentBoxWidth)
  const headerGap = doc.headerGap ?? 0
  const footerGap = doc.footerGap ?? 0
  const contentBoxHeight = pageHeight - doc.margins.top - doc.margins.bottom - headerHeight - headerGap - footerHeight - footerGap

  if (contentBoxHeight <= 0) {
    throw new Error('[paginator] page content box has zero/negative height — margins/header/footer too large for the chosen page size.')
  }

  const ctx: PaginationContext = { pages: [[]], y: 0, contentBoxWidth, contentBoxHeight }
  paginateNode(doc.body, contentBoxWidth, ctx)
  applySinglePageBodyMainAlign(doc.body, ctx.pages, contentBoxWidth, contentBoxHeight)

  const totalPages = ctx.pages.length
  const pages: PaginatedPage[] = ctx.pages.map((body, i) => ({
    pageNumber: i + 1,
    header: renderHeaderFooterForPage(doc.header, contentBoxWidth, i + 1, totalPages),
    body,
    footer: renderHeaderFooterForPage(doc.footer, contentBoxWidth, i + 1, totalPages),
    marginNotes: renderMarginNotesForPage(resolvePerPageValue<MarginNote[]>(doc.marginContent, i + 1, totalPages) ?? [], pageWidth, pageHeight, doc.margins, i + 1, totalPages),
    watermark: resolvePerPageValue<Watermark>(doc.watermark, i + 1, totalPages),
    background: resolvePerPageValue<string>(doc.background, i + 1, totalPages),
    border: resolvePerPageValue<ContainerBorder>(doc.border, i + 1, totalPages),
  }))

  return {
    pageSize: { width: pageWidth, height: pageHeight },
    margins: doc.margins,
    headerHeight,
    footerHeight,
    headerGap,
    footerGap,
    pages,
  }
}
