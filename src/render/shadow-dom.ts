// DOM renderer. Mounts every page inside a shadow root (structural CSS isolation) and gives every
// element explicit inline styles only — no <style> tag, no class name anywhere (belt-and-suspenders
// isolation, see reset.ts) — with one narrow, deliberate exception: mount() injects a single
// shadow-root-scoped <style> containing only an `@page` rule, because `@page` is a stylesheet-level
// at-rule with no inline-style equivalent (there is no `element.style.page`), and it's the only way
// to force the browser's print engine to use this document's exact page size with zero margins
// instead of whatever margin the OS/browser print dialog defaults to. It stays inside the shadow
// root and targets nothing but the page box itself, so it doesn't reopen the host-CSS-bleed-through
// hole invariant #5 otherwise closes — see printDocument() below.
//
// Rendering is flat and page-absolute: since RenderedNode.box coordinates
// are already fully resolved relative to their region's own origin by the time pagination finishes
// (see geometry.ts / group-layout.ts), every element — including group wrapper boxes, kept only for
// devtools/debugging parity with the authored node tree — is positioned directly against the page
// container, never inside nested position:relative wrappers. Pixel-exactness therefore never
// depends on any intermediate ancestor's box model being correct.

import type { PaginatedResult } from '../core/paginate.ts'
import type { RenderedNode, RenderedTableCell, RenderedTableRow } from '../core/geometry.ts'
import type { ImageNode, RichTextNode, RichTextRun, SeparatorNode, TableNode, TextNode, Watermark } from '../core/nodes.ts'
import { resolveColumnWidths } from '../core/table-layout.ts'
import { resolveWatermarkInstances } from '../core/watermark-layout.ts'
import { BASE_ELEMENT_STYLE } from './reset.ts'
import { renderChartSvg } from './chart-render.ts'
import { BORDER_EPSILON, subtractIntervals } from './interval-utils.ts'
import { measureTextWidthPx } from './text-measure.ts'

function styledDiv(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el.style, BASE_ELEMENT_STYLE, style)
  return el
}

function fontString(node: TextNode): string {
  const style = node.fontStyle === 'italic' ? 'italic ' : ''
  const weight = node.fontWeight ?? 400
  return `${style}${weight} ${node.fontSize}px ${node.fontFamily}`
}

function renderTextNode(rendered: Extract<RenderedNode, { type: 'text' }>, x: number, y: number, container: HTMLElement, unselectable: boolean): void {
  const node = rendered.node
  const boxEl = styledDiv({
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    // `user-select` is inherited, so setting it once here covers every line div below — a drag
    // gesture starting on (or bubbling up through) this text shouldn't also trigger native text
    // selection. See renderNode()'s `draggableAncestor` threading for where `unselectable` comes from.
    ...(unselectable ? { userSelect: 'none' as const } : {}),
  })
  const font = fontString(node)

  for (const line of rendered.lines) {
    const lineEl = styledDiv({
      left: `${line.x}px`,
      top: `${line.y}px`,
      width: `${line.width}px`,
      height: `${node.lineHeight}px`,
      font,
      lineHeight: `${node.lineHeight}px`,
      color: node.color ?? '#000000',
      letterSpacing: node.letterSpacing !== undefined ? `${node.letterSpacing}px` : 'normal',
      whiteSpace: 'pre',
      ...(node.textDecoration !== undefined && node.textDecoration !== 'none' ? { textDecoration: node.textDecoration } : {}),
    })
    lineEl.textContent = line.text
    boxEl.appendChild(lineEl)
  }
  container.appendChild(boxEl)
}

function runFontString(run: RichTextRun, node: RichTextNode): string {
  const style = (run.fontStyle ?? node.fontStyle) === 'italic' ? 'italic ' : ''
  const weight = run.fontWeight ?? node.fontWeight ?? 400
  const size = run.fontSize ?? node.fontSize
  const family = run.fontFamily ?? node.fontFamily
  return `${style}${weight} ${size}px ${family}`
}

// One element per RUN/fragment (not per line, unlike renderTextNode) since style can vary within a
// line. A run carrying `href` renders as a real `<a>` — natively clickable/hoverable/keyboard-
// focusable — rather than going through the generic interactive/hit-registry system (see
// RichTextRun.href's doc comment in nodes.ts for why).
function renderRichTextNode(rendered: Extract<RenderedNode, { type: 'richText' }>, x: number, y: number, container: HTMLElement, unselectable: boolean): void {
  const node = rendered.node
  const boxEl = styledDiv({
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    ...(unselectable ? { userSelect: 'none' as const } : {}),
  })

  for (const line of rendered.lines) {
    for (const run of line.runs) {
      const source = node.runs[run.runIndex]!
      const decoration = source.textDecoration ?? node.textDecoration
      const isLink = source.href !== undefined
      const style: Partial<CSSStyleDeclaration> = {
        left: `${run.x}px`,
        top: `${line.y}px`,
        width: `${run.width}px`,
        height: `${node.lineHeight}px`,
        font: runFontString(source, node),
        lineHeight: `${node.lineHeight}px`,
        color: source.color ?? node.color ?? '#000000',
        letterSpacing: (source.letterSpacing ?? node.letterSpacing) !== undefined ? `${source.letterSpacing ?? node.letterSpacing}px` : 'normal',
        whiteSpace: 'pre',
        ...(decoration !== undefined && decoration !== 'none' ? { textDecoration: decoration } : {}),
        ...(isLink ? { display: 'block' as const } : {}),
      }
      const runEl: HTMLElement = isLink ? document.createElement('a') : document.createElement('div')
      Object.assign(runEl.style, BASE_ELEMENT_STYLE, style)
      if (isLink) {
        const a = runEl as HTMLAnchorElement
        a.href = source.href!
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
      }
      runEl.textContent = run.text
      boxEl.appendChild(runEl)
    }
  }
  container.appendChild(boxEl)
}

function renderSeparatorNode(rendered: Extract<RenderedNode, { type: 'separator' }>, x: number, y: number, container: HTMLElement): void {
  const node: SeparatorNode = rendered.node
  const el = styledDiv({
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    background: node.color ?? '#000000',
  })
  container.appendChild(el)
}

function renderImageNode(rendered: Extract<RenderedNode, { type: 'image' }>, x: number, y: number, container: HTMLElement): void {
  const node: ImageNode = rendered.node
  const el = document.createElement('img')
  Object.assign(el.style, BASE_ELEMENT_STYLE, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    objectFit: node.objectFit ?? 'fill',
    // A replaced element (like <img>) clips its own painted content to border-radius natively —
    // no extra overflow:hidden wrapper needed, unlike a generic block-level box.
    ...(node.borderRadius !== undefined ? { borderRadius: `${node.borderRadius}px` } : {}),
    ...(node.opacity !== undefined ? { opacity: `${node.opacity}` } : {}),
  })
  el.src = node.src
  if (node.alt !== undefined) el.alt = node.alt
  container.appendChild(el)
}

// Watermark: a page-absolute decorative overlay, not a Node — resolved once per page by paginate()
// and painted directly here. Appended LAST in mount()'s per-page loop below (after header/body/
// footer) so it sits on top of everything, an opaque table/container/chart background elsewhere on
// the page can otherwise fully hide it. Never a hit-test target (pointerEvents: none) since it isn't
// part of the authored tree and can't be an attachInteractions() target.
function watermarkFontCss(watermark: Extract<Watermark, { kind: 'text' }>): string {
  const style = watermark.fontStyle === 'italic' ? 'italic ' : ''
  const weight = watermark.fontWeight ?? 700
  return `${style}${weight} ${watermark.fontSize ?? 72}px ${watermark.fontFamily ?? 'sans-serif'}`
}

function renderWatermark(watermark: Watermark, pageWidth: number, pageHeight: number, container: HTMLElement): void {
  const opacity = watermark.opacity ?? 0.15
  const rotation = watermark.rotation ?? -45

  if (watermark.kind === 'image') {
    const { width, height } = watermark
    const instances = resolveWatermarkInstances(watermark, pageWidth, pageHeight, width, height)
    for (const { x, y } of instances) {
      const el = document.createElement('img')
      Object.assign(el.style, BASE_ELEMENT_STYLE, {
        left: `${x - width / 2}px`,
        top: `${y - height / 2}px`,
        width: `${width}px`,
        height: `${height}px`,
        opacity: `${opacity}`,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center',
        pointerEvents: 'none' as const,
      })
      el.src = watermark.src
      container.appendChild(el)
    }
    return
  }

  const fontSize = watermark.fontSize ?? 72
  const fontCss = watermarkFontCss(watermark)
  const width = measureTextWidthPx(watermark.text, fontCss)
  const height = fontSize * 1.2
  const instances = resolveWatermarkInstances(watermark, pageWidth, pageHeight, width, height)
  for (const { x, y } of instances) {
    const el = styledDiv({
      left: `${x - width / 2}px`,
      top: `${y - height / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      font: fontCss,
      lineHeight: `${height}px`,
      color: watermark.color ?? '#000000',
      opacity: `${opacity}`,
      transform: `rotate(${rotation}deg)`,
      transformOrigin: 'center',
      whiteSpace: 'pre',
      textAlign: 'center',
      pointerEvents: 'none' as const,
    })
    el.textContent = watermark.text
    container.appendChild(el)
  }
}

function renderContainerNode(rendered: Extract<RenderedNode, { type: 'container' }>, x: number, y: number, originX: number, originY: number, container: HTMLElement, unselectable: boolean): void {
  const node = rendered.node
  const style: Partial<CSSStyleDeclaration> = {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
  }
  if (node.background !== undefined) style.background = node.background
  if (node.border !== undefined) style.border = `${node.border.thickness ?? 1}px solid ${node.border.color ?? '#000000'}`
  if (node.borderRadius !== undefined) style.borderRadius = `${node.borderRadius}px`
  container.appendChild(styledDiv(style))
  // Same convention as group/table: rendered.child.box is already resolved relative to this SAME
  // (originX, originY), not to the container's own box (translateRendered's container branch
  // shifts both by the same delta) — so recursion reuses the UNCHANGED origin, not (x, y).
  renderNode(rendered.child, originX, originY, container, unselectable)
}

function renderChartNode(rendered: Extract<RenderedNode, { type: 'chart' }>, x: number, y: number, container: HTMLElement, unselectable: boolean): void {
  const svg = renderChartSvg(rendered.node, rendered.box.width, rendered.box.height)
  Object.assign(svg.style, BASE_ELEMENT_STYLE, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    // SVG <text> (axis labels, legend, title) is natively selectable same as HTML text — without
    // this, a drag gesture starting on (or bubbling up through) a draggable chart can also select
    // its labels, exactly the problem renderTextNode's own `unselectable` threading solves for text
    // nodes. See renderNode()'s `draggableAncestor` threading for where this flag comes from.
    ...(unselectable ? { userSelect: 'none' as const } : {}),
  })
  container.appendChild(svg)
}

// Border modes render as single-thickness line segments (like renderSeparatorNode's own div),
// never a per-cell CSS `border` shorthand — that would double thickness at shared edges where two
// adjacent cells' own borders both draw at the same touching boundary. A colSpan/rowSpan cell's
// merged box must not have a divider line drawn through it either — see the cell-straddling check
// below, which naturally leaves the OUTER perimeter lines untouched too: a cell can never extend
// past the table's own edge, so it never "straddles" an outer boundary in the first place, only
// ever an inner one.
//
// `originX`/`originY` here is the SAME origin `rendered`'s own (x, y) was computed from — needed
// because `rendered.rows[].box` (unlike `colX`/`colWidths`, which are pure local offsets
// recomputed fresh here) is already fully origin-relative, exactly like a group's `children[].box`
// (see geometry.ts's `translateRendered` table branch, which shifts `rows[].box` by the same delta
// as the table's own box, in parallel — never nested). Adding it again on top of `y` (which already
// includes the table's own box offset) would double-count that offset.
function renderTableBorders(
  node: TableNode,
  rendered: Extract<RenderedNode, { type: 'table' }>,
  colWidths: number[],
  colX: number[],
  originX: number,
  originY: number,
  x: number,
  y: number,
  container: HTMLElement,
): void {
  if (node.border === undefined || node.border.mode === 'none') return
  const mode = node.border.mode ?? 'all'
  const thickness = node.border.thickness ?? 1
  const color = node.border.color ?? '#000000'

  const outerH = mode === 'all' || mode === 'outer' || mode === 'horizontal'
  const innerH = mode === 'all' || mode === 'horizontal'
  const outerV = mode === 'all' || mode === 'outer' || mode === 'vertical'
  const innerV = mode === 'all' || mode === 'vertical'

  const tableTop = y
  const tableBottom = y + rendered.box.height
  const tableLeft = x
  const tableRight = x + rendered.box.width

  const cellBox = (cell: RenderedTableCell) => ({
    left: originX + cell.box.x,
    top: originY + cell.box.y,
    right: originX + cell.box.x + cell.box.width,
    bottom: originY + cell.box.y + cell.box.height,
  })

  // Absolute (origin-applied) boxes of every cell that has one — an ordinary 'cells' row, AND a
  // colSpan-aware 'header' row (see nodes.ts), which behaves exactly like an ordinary row for
  // border purposes (its cells only straddle the lines their own colSpan actually crosses, same as
  // any other cell). A `content`-shaped header (no `cells`) has none, handled separately below.
  const cellBoxes = rendered.rows.flatMap(row => (row.kind === 'header' ? (row.cells ?? []).map(cellBox) : row.cells.map(cellBox)))

  // A `content`-shaped 'header' row (a column-grouping header/divider bar with no per-column
  // cells) always spans the table's FULL width, so it "straddles" every inner VERTICAL line by
  // construction — unlike a cell, its horizontal extent never needs checking. It never straddles
  // an inner HORIZONTAL line: those sit exactly at row boundaries, which match a header row's own
  // top/bottom edges, never strictly inside its box (the straddle check below is strict), so no
  // horizontal-line handling is needed here. A `cells`-shaped header needs none of this special
  // casing — its cells are already covered by `cellBoxes` above, exactly like an ordinary row.
  const headerRowVRanges: [number, number][] = rendered.rows
    .filter((row): row is Extract<RenderedTableRow, { kind: 'header' }> => row.kind === 'header' && row.cells === undefined)
    .map(row => [originY + row.box.y, originY + row.box.y + row.box.height])

  const hYs: number[] = []
  if (outerH) hYs.push(tableTop, tableBottom)
  if (innerH) {
    for (let i = 0; i < rendered.rows.length - 1; i++) hYs.push(originY + rendered.rows[i]!.box.y + rendered.rows[i]!.box.height)
  }
  for (const lineY of hYs) {
    const straddling = cellBoxes.filter(b => b.top < lineY - BORDER_EPSILON && lineY + BORDER_EPSILON < b.bottom)
    const segments = subtractIntervals([tableLeft, tableRight], straddling.map(b => [b.left, b.right] as const))
    for (const [segStart, segEnd] of segments) {
      container.appendChild(styledDiv({ left: `${segStart}px`, top: `${lineY}px`, width: `${segEnd - segStart}px`, height: `${thickness}px`, background: color }))
    }
  }

  const vXs: number[] = []
  if (outerV) vXs.push(tableLeft, tableRight)
  if (innerV) {
    for (let i = 0; i < colWidths.length - 1; i++) vXs.push(originX + colX[i]! + colWidths[i]!)
  }
  for (const lineX of vXs) {
    const straddling = cellBoxes.filter(b => b.left < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < b.right)
    // A header row's box is exactly [tableLeft, tableRight] — this same strict-inequality check
    // (mirroring the cell one above) is naturally false for the OUTER lines (lineX equals one of
    // the edges, never strictly between them) and true for every INNER line, so no separate
    // inner/outer branch is needed here.
    const headerHoles = tableLeft < lineX - BORDER_EPSILON && lineX + BORDER_EPSILON < tableRight ? headerRowVRanges : []
    const segments = subtractIntervals([tableTop, tableBottom], [...straddling.map(b => [b.top, b.bottom] as const), ...headerHoles])
    for (const [segStart, segEnd] of segments) {
      container.appendChild(styledDiv({ left: `${lineX}px`, top: `${segStart}px`, width: `${thickness}px`, height: `${segEnd - segStart}px`, background: color }))
    }
  }
}

// `originX`/`originY`, not `x`/`y`: `rendered.rows[].box` (and every cell's own box) is already
// fully origin-relative, the same convention a group's `children[].box` uses — see the comment on
// `renderTableBorders` above. Only the table's OWN box (`x`/`y`, derived once here) and the fresh
// local `colX`/`colWidths` offsets need `x`/`y`; everything read out of `rendered.rows` needs the
// original, un-offset origin.
function renderTableNode(rendered: Extract<RenderedNode, { type: 'table' }>, originX: number, originY: number, container: HTMLElement, unselectable: boolean): void {
  const node = rendered.node
  const x = originX + rendered.box.x
  const y = originY + rendered.box.y
  const colWidths = resolveColumnWidths(node.columns, rendered.box.width)
  const colX: number[] = []
  let acc = 0
  for (const w of colWidths) {
    colX.push(acc)
    acc += w
  }

  // Table wrapper (devtools parity only, per invariant #4 — same as group).
  container.appendChild(styledDiv({ left: `${x}px`, top: `${y}px`, width: `${rendered.box.width}px`, height: `${rendered.box.height}px` }))

  // Shared by an ordinary 'cells' row AND a colSpan-aware 'header' row (see nodes.ts) — same
  // per-cell background-then-content painting either way. Backgrounds use each cell's own FULL
  // extent (cell.box — column width × row height, pre-resolved at layout time), not the content
  // sub-box (cell.rendered.box).
  const renderCellsRow = (cells: RenderedTableCell[]) => {
    for (const cell of cells) {
      if (cell.background === undefined) continue
      container.appendChild(
        styledDiv({
          left: `${originX + cell.box.x}px`,
          top: `${originY + cell.box.y}px`,
          width: `${cell.box.width}px`,
          height: `${cell.box.height}px`,
          background: cell.background,
        }),
      )
    }
    // Cell content — flat, never nested, same as a group's children (see invariant #4).
    for (const cell of cells) renderNode(cell.rendered, originX, originY, container, unselectable)
    // Per-cell border drawn last (on top of background/content), same ordering as the table-wide
    // border (drawn after every row in renderTableNode below) — a plain CSS border on the cell's
    // own full box, independent of and NOT straddle-avoided against the table-wide border modes
    // (see TableCell.border's doc comment: two adjacent bordered cells double up, by design).
    for (const cell of cells) {
      if (cell.border === undefined) continue
      container.appendChild(
        styledDiv({
          left: `${originX + cell.box.x}px`,
          top: `${originY + cell.box.y}px`,
          width: `${cell.box.width}px`,
          height: `${cell.box.height}px`,
          border: `${cell.border.thickness ?? 1}px solid ${cell.border.color ?? '#000000'}`,
        }),
      )
    }
  }

  for (const row of rendered.rows) {
    if (row.kind === 'header') {
      if (row.cells !== undefined) {
        renderCellsRow(row.cells)
        continue
      }
      if (row.background !== undefined) {
        container.appendChild(
          styledDiv({
            left: `${originX + row.box.x}px`,
            top: `${originY + row.box.y}px`,
            width: `${row.box.width}px`,
            height: `${row.box.height}px`,
            background: row.background,
          }),
        )
      }
      renderNode(row.content!, originX, originY, container, unselectable)
      continue
    }

    renderCellsRow(row.cells)
  }

  renderTableBorders(node, rendered, colWidths, colX, originX, originY, x, y, container)
}

function renderNode(rendered: RenderedNode, originX: number, originY: number, container: HTMLElement, draggableAncestor = false): void {
  const x = originX + rendered.box.x
  const y = originY + rendered.box.y
  // A node needs both interactive+draggable to actually be a drag source (see attach-interactions.ts),
  // so that's the same check that decides whether text here (or under here) should be unselectable.
  const isDraggable = rendered.node.interactive === true && rendered.node.draggable === true
  const unselectable = draggableAncestor || isDraggable

  if (rendered.type === 'text') {
    renderTextNode(rendered, x, y, container, unselectable)
    return
  }
  if (rendered.type === 'richText') {
    renderRichTextNode(rendered, x, y, container, unselectable)
    return
  }
  if (rendered.type === 'separator') {
    renderSeparatorNode(rendered, x, y, container)
    return
  }
  if (rendered.type === 'page-break') {
    // Pure flow-control marker — zero size, nothing to paint.
    return
  }
  if (rendered.type === 'image') {
    renderImageNode(rendered, x, y, container)
    return
  }
  if (rendered.type === 'chart') {
    renderChartNode(rendered, x, y, container, unselectable)
    return
  }
  if (rendered.type === 'table') {
    // Same reasoning as the group case below: rendered.rows[].box is already resolved relative to
    // this SAME (originX, originY), not to the table's own box, so it needs the unchanged origin —
    // renderTableNode re-derives (x, y) internally for its own wrapper/border positioning.
    renderTableNode(rendered, originX, originY, container, unselectable)
    return
  }
  if (rendered.type === 'container') {
    renderContainerNode(rendered, x, y, originX, originY, container, unselectable)
    return
  }

  // Group: inert positioned box purely for devtools/debugging parity with the authored tree.
  // Children boxes are already resolved relative to this SAME (originX, originY), not to the
  // group's own box, so recursion reuses the unchanged origin — see geometry.ts's invariant.
  const groupEl = styledDiv({ left: `${x}px`, top: `${y}px`, width: `${rendered.box.width}px`, height: `${rendered.box.height}px` })
  container.appendChild(groupEl)
  for (const child of rendered.children) renderNode(child, originX, originY, container, unselectable)
}

/**
 * Renders a standalone, self-contained copy of a single RenderedNode subtree (as returned on
 * InteractionTarget.rendered by attachInteractions' events), re-based so the node's own box lands
 * at (0, 0) instead of its original page-relative position. Reuses the exact same per-node-type
 * rendering as mount() — same fonts, colors, image objectFit, everything — so this is guaranteed
 * to look pixel-identical to how the node actually renders on the page, with zero duplicated
 * rendering logic. Intended for building a drag preview: append the returned element to your own
 * floating container and position that container with the cursor (see the `drag`/`dragstart`
 * events); this function only produces the visual content, not a shadow root, and does not attach
 * to any page — the caller owns where it goes and how it's positioned.
 */
export function renderPreview(rendered: RenderedNode): HTMLElement {
  const container = styledDiv({
    position: 'relative',
    width: `${rendered.box.width}px`,
    height: `${rendered.box.height}px`,
    pointerEvents: 'none',
  })
  renderNode(rendered, -rendered.box.x, -rendered.box.y, container)
  return container
}

const SCREEN_WRAPPER_SPACING = '24px'
const SCREEN_WRAPPER_BACKGROUND = '#e5e5e5'
const SCREEN_PAGE_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.25)'

// The screen-only chrome around each page (the wrapper's padding/gap that visually separates
// "sheets on a desk", plus its gray background and each page's drop shadow) has no logical-page
// meaning to the browser's own print engine — it just fragments this one tall flex column every
// physical-page-height. Left in place, that extra vertical space accumulates page over page (top
// padding once, a gap after every page but the last) until the drift pushes trailing content onto
// an extra, mostly-blank physical page. Stripping it specifically during print — via `matchMedia`
// (`change`) and `beforeprint`/`afterprint` together, since real-world print-trigger reliability
// differs across browsers — keeps the screen presentation untouched while making each logical page
// occupy exactly one physical page. `breakAfter`/`pageBreakAfter` (unconditional; both properties
// for engine coverage) do the complementary half: forcing the fragmentation cut to land exactly at
// each page boundary rather than trusting height math alone. Both are plain inline style properties
// — no `<style>` tag or `@media` block needed, keeping invariant #5 (inline styles only) intact.
function applyPrintMode(wrapper: HTMLElement, pageEls: HTMLElement[], isPrint: boolean): void {
  Object.assign(wrapper.style, {
    padding: isPrint ? '0' : SCREEN_WRAPPER_SPACING,
    gap: isPrint ? '0' : SCREEN_WRAPPER_SPACING,
    background: isPrint ? '#ffffff' : SCREEN_WRAPPER_BACKGROUND,
  })
  for (const pageEl of pageEls) {
    pageEl.style.boxShadow = isPrint ? 'none' : SCREEN_PAGE_SHADOW
  }
}

export function mount(result: PaginatedResult, host: HTMLElement): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.replaceChildren()

  const { pageSize, margins, headerHeight, headerGap, footerHeight } = result

  // The one `<style>` exception in this file — see the header comment for why `@page` can't be
  // expressed as an inline style. `size` in physical px at the same 96dpi this whole engine already
  // assumes (see page-sizes.ts) makes the printed page dimensions match the on-screen ones exactly;
  // `margin: 0` is what makes printDocument()'s zeroed-out wrapper padding/gap (applyPrintMode,
  // above) actually reach the physical page edge instead of being pushed in by the browser's own
  // default print margin.
  const pageStyle = document.createElement('style')
  pageStyle.textContent = `@page { size: ${pageSize.width}px ${pageSize.height}px; margin: 0; }`
  root.appendChild(pageStyle)

  const wrapper = styledDiv({
    position: 'static',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: SCREEN_WRAPPER_SPACING,
    padding: SCREEN_WRAPPER_SPACING,
    background: SCREEN_WRAPPER_BACKGROUND,
  })
  root.appendChild(wrapper)

  const headerOriginX = margins.left
  const headerOriginY = margins.top
  const bodyOriginX = margins.left
  const bodyOriginY = margins.top + headerHeight + headerGap
  const footerOriginX = margins.left
  const footerOriginY = pageSize.height - margins.bottom - footerHeight

  const pageEls: HTMLElement[] = []
  for (const [i, page] of result.pages.entries()) {
    const pageEl = styledDiv({
      position: 'relative',
      overflow: 'hidden',
      background: page.background ?? '#ffffff',
      width: `${pageSize.width}px`,
      height: `${pageSize.height}px`,
      boxShadow: SCREEN_PAGE_SHADOW,
      ...(page.border !== null
        ? { border: `${page.border.thickness ?? 1}px solid ${page.border.color ?? '#000000'}` }
        : {}),
    })
    pageEl.dataset.pageNumber = String(page.pageNumber)
    // Inert on screen (fragmentation properties only matter in paged/print or multicol contexts) —
    // forces each logical page to start a fresh physical page when printed. Skipped on the last
    // page so printing doesn't end on a trailing blank sheet.
    if (i < result.pages.length - 1) {
      pageEl.style.breakAfter = 'page'
      pageEl.style.pageBreakAfter = 'always'
    }
    wrapper.appendChild(pageEl)
    pageEls.push(pageEl)

    if (page.header !== null) renderNode(page.header, headerOriginX, headerOriginY, pageEl)
    for (const node of page.body) renderNode(node, bodyOriginX, bodyOriginY, pageEl)
    if (page.footer !== null) renderNode(page.footer, footerOriginX, footerOriginY, pageEl)
    // Drawn last, on top of everything — an opaque table/container/chart background elsewhere on the
    // page would otherwise fully hide a watermark painted underneath it. Matches pdf-render.ts.
    if (page.watermark !== null) renderWatermark(page.watermark, pageSize.width, pageSize.height, pageEl)
  }

  // Not deduped across repeated mount() calls, same caveat as attachInteractions — each call binds
  // fresh listeners to its own wrapper/pageEls; stale listeners from a prior mount() become no-ops
  // once their closed-over elements are detached, but aren't removed. Fine for this library's
  // call-mount-once-or-rarely usage; a caller re-paginating in a hot loop would want to track and
  // remove these itself.
  const mql = window.matchMedia('print')
  const onPrint = (): void => applyPrintMode(wrapper, pageEls, mql.matches)
  mql.addEventListener('change', onPrint)
  window.addEventListener('beforeprint', () => applyPrintMode(wrapper, pageEls, true))
  window.addEventListener('afterprint', () => applyPrintMode(wrapper, pageEls, false))
}

/**
 * Prints a document previously mounted with `mount(result, host)`. All of the actual print
 * handling — the `@page` size/margin rule, hiding the screen-only wrapper padding/gap/background
 * and page drop-shadows — is already wired up inside `mount()` itself (it reacts live to
 * `matchMedia('print')`/`beforeprint`/`afterprint`, so it fires correctly however printing gets
 * triggered, including the browser's own Ctrl/Cmd+P). This function exists so consumers never need
 * to reach for the bare `window.print()` global themselves or know any of the above — wire a
 * button's `onclick` to this and printing "just works" per the isolation/sizing guarantees the rest
 * of this library already provides. Throws if `host` was never mounted, since an unmounted host has
 * no pages (and no `@page` rule) to print.
 */
export function printDocument(host: HTMLElement): void {
  if (host.shadowRoot === null) {
    throw new Error('[paginator] printDocument() called on a host that has no mount() output yet — call mount(result, host) first.')
  }
  window.print()
}
