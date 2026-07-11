// DOM renderer entry point. Mounts every page inside a shadow root (structural CSS isolation) and
// gives every element explicit inline styles only — no <style> tag, no class name anywhere
// (belt-and-suspenders isolation, see reset.ts) — with one narrow, deliberate exception: mount()
// injects a single shadow-root-scoped <style> containing only an `@page` rule, because `@page` is a
// stylesheet-level at-rule with no inline-style equivalent (there is no `element.style.page`), and
// it's the only way to force the browser's print engine to use this document's exact page size with
// zero margins instead of whatever margin the OS/browser print dialog defaults to. It stays inside
// the shadow root and targets nothing but the page box itself, so it doesn't reopen the
// host-CSS-bleed-through hole invariant #5 otherwise closes — see printDocument() below.
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
import { DEFAULT_FONT_FAMILY } from './font-registry.ts'

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
  return `${style}${weight} ${watermark.fontSize ?? 72}px ${watermark.fontFamily ?? DEFAULT_FONT_FAMILY}`
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
    pageEls.push(pageEl)

    const ctx = { container: pageEl, unselectable: false }
    if (page.header !== null) renderNodeDom(page.header, headerOriginX, headerOriginY, ctx)
    for (const node of page.body) renderNodeDom(node, bodyOriginX, bodyOriginY, ctx)
    if (page.footer !== null) renderNodeDom(page.footer, footerOriginX, footerOriginY, ctx)
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
