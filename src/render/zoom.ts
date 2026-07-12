// A headless zoom primitive: owns a scale factor and applies it to `host` as a CSS transform, with
// no buttons, labels, or other UI of its own — same DIY split as attachInteractions() (raw events
// in, your own UI on top). `host` is meant to be the same element passed to mount(result, host):
// mount()'s shadow-root wrapper already horizontally centers pages via flexbox, so scaling `host`
// itself (an ancestor of that wrapper) from `top center` keeps that centering correct at any zoom
// level, and any overlay elements a consumer appends inside the shadow root (highlight boxes, drop-
// zone highlights) inherit the transform automatically.
//
// transform-origin's Y is pinned at the very top of `host` (see setZoom below for why it stays
// pinned rather than moving around) — left alone, that means every zoom step pivots around the
// *document's* top edge, not around whatever the viewer is actually looking at: zooming in visibly
// drags content down past the viewport, zooming out drags it up. setZoom() compensates by scrolling
// the nearest scrollable ancestor so whatever sits at the viewport's vertical center before the
// scale change is still there after it — the standard "zoom around what you're looking at" behavior.
//
// The scale and the compensating scroll are driven from ONE requestAnimationFrame loop rather than a
// CSS `transition` on `transform` plus a separately-timed scroll animation: two animations with
// independent easing curves only agree at their shared start/end, so at every frame in between the
// pivot point silently drifts off target — an error that grows with scroll depth (the further from
// the transform-origin the viewer has scrolled, the bigger a given curve mismatch reads on screen).
// Driving both `host.style.transform` and `scrollParent.scrollTop` off the same per-frame `eased`
// value keeps the pivot point exactly fixed on screen at every intermediate frame, not just at the
// end. `zoom` itself is updated every frame too (not jumped to the target immediately), so
// attachInteractions()'s `zoom` option — which needs getZoom() to convert getBoundingClientRect()'s
// post-transform screen px back to the unscaled page-content px space every RenderedNode.box is
// expressed in — stays correct throughout the animation, not just once it settles.
//
// `transform: scale()` only ever changes what's *painted* — `host`'s own layout box (offsetHeight)
// never shrinks or grows with it on its own, and the shadow-rendered content inside `host` has its
// own fixed px size regardless of `host`'s CSS height (mount() sizes pages in absolute px, not
// relative to their container). Above 100% zoom that's actually fine on its own: the content already
// overflows `host`'s natural-height box once scaled up, and Chromium's own scrollable-overflow rules
// already extend the document's scrollable extent to cover that overflow correctly — no code needed.
// Below 100% zoom it's the opposite problem: content shrinks *inside* its box instead of overflowing
// it, so there's nothing forcing the document's height down to match, leaving dead space below the
// last page equal to the shrink. `Math.min(1, zoom)` below applies the fix only where it's needed
// (an explicit height at or above natural would just re-introduce overflow and, since the content
// inside is transformed by the very same `zoom` this height is scaled by, compounds into `zoom²` —
// this exact bug shipped once already, see git history) — at zoom >= 1 this evaluates to
// `naturalHeight` (a no-op, letting Chromium's native handling do the work); at zoom < 1 it shrinks
// `host`'s reserved layout footprint to match, and since content still overflows a too-small box, the
// same native overflow-inclusion mechanism still resolves the total scrollable extent correctly.

export type ZoomOptions = {
  /** Minimum allowed zoom factor. Default 0.5. */
  min?: number
  /** Maximum allowed zoom factor. Default 2.5. */
  max?: number
  /** Amount zoomIn()/zoomOut() change the zoom factor by. Default 0.25. */
  step?: number
  /** Zoom factor applied immediately and restored by reset(). Default 1. */
  initial?: number
  /** Duration of the zoom/scroll animation, in ms. Default 200. Set to 0 to apply changes instantly. */
  transitionMs?: number
}

export type ZoomController = {
  /** Current zoom factor — updates every animation frame while a zoom change is in flight. */
  getZoom(): number
  /** Clamps `value` to [min, max] and animates to it. Returns the target value (immediately, not
   *  the live in-flight value — use getZoom() for that). */
  setZoom(value: number): number
  /** Increases the zoom factor by `step`, clamped to `max`. Returns the target value. */
  zoomIn(): number
  /** Decreases the zoom factor by `step`, clamped to `min`. Returns the target value. */
  zoomOut(): number
  /** Restores the zoom factor to `initial`. Returns the target value. */
  reset(): number
  /**
   * Computes the zoom factor that fits `pageWidth` (a page's own unscaled px width, e.g.
   * `PaginatedResult.pageSize.width`) within `availableWidth` (defaults to `host.clientWidth` — pass
   * this explicitly if `host` isn't itself the exact width you want to fit within, e.g. it still has
   * its own padding/toolbar chrome) and animates to it, clamped to [min, max] same as setZoom().
   * Returns the target value.
   */
  fitWidth(pageWidth: number, availableWidth?: number): number
  /**
   * Re-measures `host`'s natural (unscaled) height. Call this after mounting different content into
   * `host` (e.g. a re-paginated document) while this same controller is still in use — `naturalHeight`
   * is otherwise captured once at creation and goes stale, which throws off the below-100%-zoom
   * height compensation (see this file's header comment).
   */
  refresh(): void
  /**
   * Cancels any in-flight zoom animation. Call when unmounting/discarding `host` while a zoom change
   * might still be animating, so the animation frame loop doesn't keep writing styles to a detached
   * element.
   */
  destroy(): void
}

// Walks up from `host` for the nearest actually-scrollable overflow ancestor (the container whose
// scrollTop is what the browser moves when the viewer scrolls the document), falling back to
// `document.scrollingElement` — the whole page — when `host` isn't nested inside its own scrolling
// container, which is the common case for a full-page viewer like this library's demo.
function findScrollParent(host: HTMLElement): HTMLElement {
  let node = host.parentElement
  while (node !== null) {
    const style = getComputedStyle(node)
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

export function createZoomController(host: HTMLElement, options: ZoomOptions = {}): ZoomController {
  const min = options.min ?? 0.5
  const max = options.max ?? 2.5
  const step = options.step ?? 0.25
  const initial = options.initial ?? 1
  const transitionMs = options.transitionMs ?? 200

  let zoom = clamp(initial)
  let animationFrame: number | null = null

  function clamp(value: number): number {
    return Math.min(max, Math.max(min, value))
  }

  // offsetHeight is a layout property, unaffected by transform — safe to read at any zoom level, as
  // `host`'s current unscaled natural height (its shadow-rendered content's real size). Reassigned by
  // refresh() below when that content changes after this controller was created.
  let naturalHeight = host.offsetHeight

  host.style.transformOrigin = 'top center'
  host.style.overflow = 'visible'
  host.style.transform = `scale(${zoom})`
  host.style.height = `${naturalHeight * Math.min(1, zoom)}px`

  function applyZoom(value: number, scrollParent: HTMLElement, startScrollTop: number, startZoom: number, localOffset: number): void {
    zoom = value
    host.style.transform = `scale(${zoom})`
    host.style.height = `${naturalHeight * Math.min(1, zoom)}px`
    scrollParent.scrollTop = startScrollTop + localOffset * (zoom - startZoom)
  }

  function setZoom(value: number): number {
    const target = clamp(value)
    if (target === zoom) return zoom
    const startZoom = zoom

    if (animationFrame !== null) cancelAnimationFrame(animationFrame)

    // hostRect.top is scale-invariant (transform-origin's Y is pinned at 0%, so the box's own top
    // edge never moves on screen regardless of scale) — fine to read once, before any animation
    // frame runs. localOffset is the viewport-center point's position in host's own unscaled
    // coordinate space; it's fixed for the whole gesture (recomputing it mid-animation would double-
    // count the scroll this same function is actively driving).
    const scrollParent = findScrollParent(host)
    const hostTop = host.getBoundingClientRect().top
    const anchorClientY = window.innerHeight / 2
    const localOffset = (anchorClientY - hostTop) / startZoom
    const startScrollTop = scrollParent.scrollTop

    if (transitionMs <= 0) {
      applyZoom(target, scrollParent, startScrollTop, startZoom, localOffset)
      return target
    }

    const start = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / transitionMs)
      applyZoom(startZoom + (target - startZoom) * easeInOutQuad(t), scrollParent, startScrollTop, startZoom, localOffset)
      animationFrame = t < 1 ? requestAnimationFrame(step) : null
    }
    animationFrame = requestAnimationFrame(step)
    return target
  }

  function fitWidth(pageWidth: number, availableWidth?: number): number {
    return setZoom((availableWidth ?? host.clientWidth) / pageWidth)
  }

  // Cancels any in-flight animation first — otherwise the next in-flight frame would immediately
  // overwrite the freshly re-measured height with a stale-naturalHeight-derived one.
  function refresh(): void {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    naturalHeight = host.offsetHeight
    host.style.height = `${naturalHeight * Math.min(1, zoom)}px`
  }

  function destroy(): void {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
  }

  return {
    getZoom: () => zoom,
    setZoom,
    zoomIn: () => setZoom(zoom + step),
    zoomOut: () => setZoom(zoom - step),
    reset: () => setZoom(initial),
    fitWidth,
    refresh,
    destroy,
  }
}
