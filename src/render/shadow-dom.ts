// DOM renderer entry point. Mounts every page inside a shadow root (structural CSS isolation) and
// gives every element explicit inline styles only — no class name anywhere (belt-and-suspenders
// isolation, see reset.ts) — with two narrow, deliberate `<style>`-tag exceptions, because two
// pieces of print behavior have no inline-style equivalent at all:
//
// 1. `@page` (page size + zero margin) — there is no `element.style.page`. Injected into a
//    `<style>` in `host.ownerDocument.head` (light DOM), NOT the shadow root — empirically,
//    Chromium's print/page-box engine silently ignores an `@page` rule scoped inside a shadow root
//    (confirmed via `page.pdf({ preferCSSPageSize: true })`: a shadow-scoped `@page` rule has zero
//    effect on the resulting page size, even though the identical rule placed in the document's own
//    `<head>` is honored exactly). `@page` only ever configures page geometry — it has no selector,
//    so it can't reach into the document's content the way a host stylesheet leaking through
//    invariant #5 could — so placing it in the light DOM doesn't reopen the host-CSS-bleed-through
//    hole invariant #5 otherwise closes.
// 2. `@media print` (stripping the screen-only wrapper padding/gap/background and each page's drop
//    shadow — see PRINT_MODE_STYLE below) — there is no inline-style equivalent of a media query
//    either. This one DOES live inside the shadow root (it has to: it targets elements that only
//    exist there), and is scoped to two private `data-*` marker attributes rather than a class name,
//    kept `!important` because these same properties are also set via inline style for the screen
//    case, and an inline style otherwise always wins over an external/shadow stylesheet rule
//    regardless of specificity. This used to be done with `matchMedia('print')`/`beforeprint`/
//    `afterprint` JS listeners mutating inline styles instead — abandoned because Chrome's print
//    preview/print-to-PDF pipeline doesn't reliably run page JS before it captures/renders the
//    page for print, so the listener-driven approach silently failed to strip the screen chrome in
//    exactly that pipeline (confirmed both via `page.pdf()` and a real Chrome print preview
//    screenshot showing the stale screen-mode gap around an otherwise-correctly-sized page). A pure
//    CSS media query has no such race: it's synchronous with whatever engine is doing the layout,
//    the same reason `break-after: page` below already avoids JS entirely.
//
// Rendering is flat and page-absolute: since RenderedNode.box coordinates are already fully resolved
// relative to their region's own origin by the time pagination finishes (see geometry.ts), every
// element is positioned directly against the page container, never inside nested position:relative
// wrappers. Pixel-exactness therefore never depends on any intermediate ancestor's box model being
// correct. Per-node-type painting itself lives in src/nodes/*, dispatched generically through
// behavior.ts's renderNodeDom() — this file never switches on node.type.

import type { PaginatedResult } from '../core/paginate.ts'
import type { RenderedNode } from '../core/geometry.ts'
import type { Watermark } from '../core/nodes.ts'
import { renderNodeDom } from '../core/behavior.ts'
import { resolveWatermarkInstances } from '../core/watermark-layout.ts'
import { BASE_ELEMENT_STYLE } from './reset.ts'
import { measureTextWidthPx } from './text-measure.ts'
import { DEFAULT_FONT_FAMILY, resolveActiveFontFamily } from './font-registry.ts'

// The light-DOM `<style>` element carrying this host's `@page` rule (see this file's header
// comment for why it can't live inside the shadow root). Keyed by `host` so a repeat mount() call
// updates the same element's textContent instead of accumulating duplicate <style> tags in
// document.head, and unmount() knows exactly which element to remove. `@page` is a genuinely
// document-global, unnamed page context, so if more than one Paginator-mounted host exists in the
// same document, whichever one's <style> was most recently written wins for any window.print()
// call — the same "last write wins" shape as any other single-slot browser global (see "Multiple
// Paginator instances" in GUIDE.md). Not solvable without CSS named pages (`@page name { }` plus a
// `page:` property on every element); out of scope unless a real multi-document-printing use case
// shows up.
const pageSizeStyleEls = new WeakMap<HTMLElement, HTMLStyleElement>()

export function styledDiv(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el.style, BASE_ELEMENT_STYLE, style)
  return el
}

// Watermark: a page-absolute decorative overlay, not a Node — resolved once per page by paginate()
// and painted directly here. Appended LAST in mount()'s per-page loop below (after header/body/
// footer) so it sits on top of everything, an opaque table/container/chart background elsewhere on
// the page can otherwise fully hide it. Never a hit-test target (pointerEvents: none) since it isn't
// part of the authored tree and can't be an attachInteractions() target.
function watermarkFontCss(watermark: Extract<Watermark, { kind: 'text' }>): string {
  const style = watermark.fontStyle === 'italic' ? 'italic ' : ''
  const weight = watermark.fontWeight ?? 700
  const family = resolveActiveFontFamily(watermark.fontFamily ?? DEFAULT_FONT_FAMILY, weight, watermark.fontStyle)
  return `${style}${weight} ${watermark.fontSize ?? 72}px ${family}`
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

  // Rasterized onto ONE <canvas> sized exactly pageWidth x pageHeight, rather than one rotated,
  // absolutely-positioned <div> per tile instance (as this used to do): resolveWatermarkInstances()
  // deliberately positions rotated tile instances from -stepX/-stepY out to pageWidth/pageHeight +
  // step so a rotated tile still covers the corners, relying on the page container's overflow to
  // clip the off-page parts — correct on screen, but Chromium's real print pipeline (confirmed via
  // a real print dialog; not reproducible through headless page.pdf(), and not fixed by adding
  // clip-path/contain:paint to the clipping container either) can still compute its printable
  // content area from the unclipped ink extent of that rotated overflow content and auto-shrink the
  // whole page to fit. A canvas's pixel buffer is a hard size limit no CSS clipping hint is needed
  // for and none of that DOM/overflow reasoning can second-guess: nothing drawn past its own
  // width/height edge exists at all, on screen or in print.
  const canvas = document.createElement('canvas')
  canvas.width = pageWidth
  canvas.height = pageHeight
  Object.assign(canvas.style, BASE_ELEMENT_STYLE, {
    left: '0px',
    top: '0px',
    width: `${pageWidth}px`,
    height: `${pageHeight}px`,
    pointerEvents: 'none' as const,
  })
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    ctx.font = fontCss
    ctx.fillStyle = watermark.color ?? '#000000'
    ctx.globalAlpha = opacity
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const { x, y } of instances) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.fillText(watermark.text, 0, 0)
      ctx.restore()
    }
  }
  container.appendChild(canvas)
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
  renderNodeDom(rendered, -rendered.box.x, -rendered.box.y, { container, unselectable: false })
  return container
}

const SCREEN_WRAPPER_SPACING = '24px'
const SCREEN_WRAPPER_BACKGROUND = '#e5e5e5'
const SCREEN_PAGE_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.25)'

// Private structural hooks, not a "class name" in the invariant-#5 sense (nothing a host stylesheet
// could plausibly target) — exist only so PRINT_MODE_STYLE below has something to select without
// reaching outside this shadow root.
const WRAPPER_MARKER_ATTR = 'data-paginator-wrapper'
const PAGE_MARKER_ATTR = 'data-page-number' // already set per-page for other purposes; reused here

// The screen-only chrome around each page (the wrapper's padding/gap that visually separates
// "sheets on a desk", plus its gray background and each page's drop shadow) has no logical-page
// meaning to the browser's own print engine — it just fragments this one tall flex column every
// physical-page-height. Left in place, that extra vertical space accumulates page over page (top
// padding once, a gap after every page but the last) until the drift pushes trailing content onto
// an extra, mostly-blank physical page. Stripped via a plain `@media print` rule (`!important`,
// since the same properties are also set via inline style for the screen case, and an inline style
// otherwise always wins over an external/shadow stylesheet rule regardless of specificity) rather
// than the `matchMedia('print')`/`beforeprint`/`afterprint` JS-listener approach this used to use —
// abandoned because Chrome's print-preview/print-to-PDF pipeline doesn't reliably run page JS
// before it renders the page for print, so the listener-driven version silently failed to strip
// this chrome in exactly that pipeline. A CSS media query has no such race. `breakAfter`/
// `pageBreakAfter` (unconditional inline styles, set once below) do the complementary half: forcing
// the fragmentation cut to land exactly at each page boundary rather than trusting height math
// alone.
const PRINT_MODE_STYLE = `@media print {
  [${WRAPPER_MARKER_ATTR}] { padding: 0 !important; gap: 0 !important; background: #ffffff !important; }
  [${PAGE_MARKER_ATTR}] { box-shadow: none !important; }
}`

export function mount(result: PaginatedResult, host: HTMLElement): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.replaceChildren()

  const { pageSize, margins, headerHeight, headerGap, footerHeight } = result

  // See the header comment for why `@page` can't be expressed as an inline style, and why it lives
  // in the light DOM (host.ownerDocument.head) rather than the shadow root. `size` in physical px
  // at the same 96dpi this whole engine already assumes (see page-sizes.ts) makes the printed page
  // dimensions match the on-screen ones exactly; `margin: 0` is what makes PRINT_MODE_STYLE's
  // zeroed-out wrapper padding/gap actually reach the physical page edge instead of being pushed in
  // by the browser's own default print margin.
  const pageStyle = pageSizeStyleEls.get(host) ?? document.createElement('style')
  pageStyle.textContent = `@page { size: ${pageSize.width}px ${pageSize.height}px; margin: 0; }`
  if (!pageSizeStyleEls.has(host)) {
    pageSizeStyleEls.set(host, pageStyle)
    host.ownerDocument.head.appendChild(pageStyle)
  }

  // The other `<style>` exception in this file — see the header comment for why the screen-vs-print
  // chrome switch is plain CSS rather than a JS event listener.
  const printModeStyle = document.createElement('style')
  printModeStyle.textContent = PRINT_MODE_STYLE
  root.appendChild(printModeStyle)

  const wrapper = styledDiv({
    position: 'static',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: SCREEN_WRAPPER_SPACING,
    padding: SCREEN_WRAPPER_SPACING,
    background: SCREEN_WRAPPER_BACKGROUND,
  })
  wrapper.setAttribute(WRAPPER_MARKER_ATTR, '')
  root.appendChild(wrapper)

  const headerOriginX = margins.left
  const headerOriginY = margins.top
  const bodyOriginX = margins.left
  const bodyOriginY = margins.top + headerHeight + headerGap
  const footerOriginX = margins.left
  const footerOriginY = pageSize.height - margins.bottom - footerHeight

  for (const [i, page] of result.pages.entries()) {
    const pageEl = styledDiv({
      position: 'relative',
      overflow: 'hidden',
      background: page.background ?? '#ffffff',
      width: `${pageSize.width}px`,
      height: `${pageSize.height}px`,
      boxShadow: SCREEN_PAGE_SHADOW,
      ...(page.border !== null
        ? { border: `${page.border.thickness ?? 1}px ${page.border.style ?? 'solid'} ${page.border.color ?? '#000000'}` }
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

    const ctx = { container: pageEl, unselectable: false }
    if (page.header !== null) renderNodeDom(page.header, headerOriginX, headerOriginY, ctx)
    for (const node of page.body) renderNodeDom(node, bodyOriginX, bodyOriginY, ctx)
    if (page.footer !== null) renderNodeDom(page.footer, footerOriginX, footerOriginY, ctx)
    // Drawn last, on top of everything — an opaque table/container/chart background elsewhere on the
    // page would otherwise fully hide a watermark painted underneath it. Matches pdf-render.ts.
    if (page.watermark !== null) renderWatermark(page.watermark, pageSize.width, pageSize.height, pageEl)
  }
}

/**
 * Tears down a host previously passed to `mount()`: removes the light-DOM `@page` `<style>` element
 * `mount()` wrote to `host.ownerDocument.head`, and clears the shadow root's content (which takes
 * the shadow-scoped print-mode `<style>` with it). Call this from a framework wrapper's own
 * unmount/cleanup path (e.g. a React effect's cleanup, Vue's `onUnmounted`, a Svelte action's
 * `destroy`) — re-running `mount()` on the SAME host already reuses the same light-DOM `<style>`
 * element, so this is only needed when the host itself is being discarded for good. Safe to call on
 * a host that was never mounted (no-op).
 */
export function unmount(host: HTMLElement): void {
  pageSizeStyleEls.get(host)?.remove()
  pageSizeStyleEls.delete(host)
  host.shadowRoot?.replaceChildren()
}
