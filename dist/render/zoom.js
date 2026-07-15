// A headless zoom primitive: owns a scale factor and applies it to `host` as a CSS transform, with
// no buttons, labels, or other UI of its own — same DIY split as attachInteractions() (raw events
// in, your own UI on top). `host` is meant to be the same element passed to mount(result, host):
// mount()'s shadow-root wrapper already horizontally centers pages via flexbox, so scaling `host`
// itself (an ancestor of that wrapper) from `top center` keeps that centering correct at any zoom
// level, and any overlay elements a consumer appends inside the shadow root (highlight boxes, drop-
// zone highlights) inherit the transform automatically. This does mean `host` itself needs to be
// sized to roughly its own content (e.g. `width: fit-content; margin-inline: auto`, not left to fill
// its full containing block) — see the X-axis paragraph below for why.
//
// transform-origin's Y is pinned at the very top of `host` (see setZoom below for why it stays
// pinned rather than moving around) — left alone, that means every zoom step pivots around the
// *document's* top edge, not around whatever the viewer is actually looking at: zooming in visibly
// drags content down past the viewport, zooming out drags it up. setZoom() compensates by scrolling
// the nearest scrollable ancestor so whatever sits at the viewport's vertical center before the
// scale change is still there after it — the standard "zoom around what you're looking at" behavior.
//
// The X axis stays at plain `center`, NOT pinned the same way as Y — pinning X at 0% plus a
// scrollLeft compensation (mirroring Y) was tried and reverted (see git history): a document is
// normally tall enough that its natural height alone already exceeds the viewport, so a top-pinned
// zoom's downward-only bulge is already inside real, existing scrollable overflow, nothing new to
// reach — but a `host` sized to its own content (not stretched to fill a wide viewport) routinely
// fits *within* the viewport horizontally at low zoom, so there's no scrollable overflow yet for a
// scroll-compensated pin to act on. `scrollLeft` silently clamps to 0 (nothing to scroll to) while
// the pinned origin keeps bulging the box rightward regardless, and the page visibly drifts
// off-center with no way to correct it. `center` avoids that: as long as `host` fits in the
// viewport, scaling from its own center is already correct with zero scroll involved.
//
// `center` alone still has the *original* clipping bug once `host` genuinely outgrows the viewport,
// though — a scaled box bulges symmetrically in both directions, but only the right half of that
// bulge ever lands in reachable (positive) scroll space; the left half lands at a negative document
// x, which no browser lets you scroll to, so it's silently clipped. `applyZoom` below compensates
// with a plain rightward `translateX`, sized to exactly cancel out however far *past* document x=0
// the left edge would otherwise land: `shift = max(0, (naturalWidth/2)*(zoom-1) - hostOffsetLeft)`,
// where `hostOffsetLeft` is `host`'s own natural (auto-centered, unscaled) distance from the
// scrollable origin — the slack available to absorb the left half of the bulge before any of it
// goes negative. This is pure arithmetic on `zoom`, not a scroll adjustment, so it never suffers the
// scrollLeft-pinning failure mode above: `shift` evaluates to exactly 0 for every zoom level where
// `host` still fits its natural slack (the overwhelmingly common case), leaving `center`'s
// already-correct, driftless behavior untouched, and only ever pushes right once the bulge would
// otherwise clip.
//
// Shifting `host` right by `shift` pins its left edge to exactly x=0 rather than leaving it
// negative — reachable, no longer clipped, but now flush against the scrollable origin instead of
// looking centered. `applyZoom` corrects that by also setting `scrollParent.scrollLeft = shift`:
// algebraically, `hostOffsetLeft`'s definition as the natural centering slack `(viewportWidth -
// naturalWidth) / 2` makes `shift` and host's post-shift natural overflow (`naturalWidth*zoom -
// viewportWidth`) grow at exactly the same rate past the clipping threshold, so `shift` is
// *provably* always within `[0, scrollWidth - clientWidth]` — never clamped — and scrolling by
// exactly that amount lands the viewport precisely on host's own midpoint at any zoom, restoring the
// centered look with the same one-line, gesture-independent assignment (no start/delta bookkeeping
// needed, unlike the vertical `scrollTop` line above: `shift` alone already IS the correct absolute
// value for any given `zoom`).
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
//
// Both `host.style.transform` and `host.style.height` are pinned to whatever they were at the time
// mount()'s print-mode CSS (`PRINT_MODE_STYLE`, shadow-dom.ts) last ran — a real, reproducible bug
// this shipped with and only surfaced once mount()'s own screen-chrome-stripping was fixed: `height`
// in particular is set from `naturalHeight = host.offsetHeight`, captured once at whatever moment
// this ran (always in screen mode, since print CSS never applies outside an actual print), which
// bakes in the screen-only wrapper padding/gap mount() strips for print. Once that stripping made
// the shadow content genuinely shorter for print, this stale, too-tall inline `height` left a real
// gap of dead space below the last page — on `host` itself, a light-DOM element, so it shows through
// as the host page's own background, not the shadow-rendered white page background — which is
// exactly enough to spill the document onto one extra, mostly-blank physical page. `transform` has
// the same staleness problem for a non-1 zoom level (see the file's own reasoning above for why an
// uncorrected `scale()` at print time is wrong regardless of this specific bug). Both need resetting
// for print the same way mount() resets its own screen chrome: a `<style>` in `host.ownerDocument.
// head` (light DOM, same placement reasoning as mount()'s `@page` rule) with a plain `@media print`
// rule, `!important` (host's transform/height are also inline styles, which otherwise always win)
// — not a `beforeprint`/`afterprint` JS listener, for the exact reliability reason documented next
// to `PRINT_MODE_STYLE`.
const PRINT_RESET_ATTR = 'data-paginator-zoom-host';
const printResetStyleEls = new WeakMap();
function ensurePrintResetStyle(host) {
    host.setAttribute(PRINT_RESET_ATTR, '');
    if (printResetStyleEls.has(host))
        return;
    const style = document.createElement('style');
    style.textContent = `@media print { [${PRINT_RESET_ATTR}] { height: auto !important; transform: none !important; } }`;
    printResetStyleEls.set(host, style);
    host.ownerDocument.head.appendChild(style);
}
// Walks up from `host` for the nearest actually-scrollable overflow ancestor (the container whose
// scrollTop is what the browser moves when the viewer scrolls the document), falling back to
// `document.scrollingElement` — the whole page — when `host` isn't nested inside its own scrolling
// container, which is the common case for a full-page viewer like this library's demo.
function findScrollParent(host) {
    let node = host.parentElement;
    while (node !== null) {
        const style = getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
            return node;
        node = node.parentElement;
    }
    return document.scrollingElement ?? document.documentElement;
}
function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
export function createZoomController(host, options = {}) {
    const min = options.min ?? 0.5;
    const max = options.max ?? 2.5;
    const step = options.step ?? 0.25;
    const initial = options.initial ?? 1;
    const transitionMs = options.transitionMs ?? 200;
    let zoom = clamp(initial);
    let animationFrame = null;
    function clamp(value) {
        return Math.min(max, Math.max(min, value));
    }
    // offsetHeight is a layout property, unaffected by transform — safe to read at any zoom level, as
    // `host`'s current unscaled natural height (its shadow-rendered content's real size). Reassigned by
    // refresh() below when that content changes after this controller was created.
    let naturalHeight = host.offsetHeight;
    host.style.transformOrigin = 'top center';
    host.style.overflow = 'visible';
    host.style.transform = `scale(${zoom})`;
    host.style.height = `${naturalHeight * Math.min(1, zoom)}px`;
    ensurePrintResetStyle(host);
    function applyZoom(value, gesture) {
        const { scrollParent, startScrollTop, startZoom, localOffset, naturalWidth, hostOffsetLeft } = gesture;
        zoom = value;
        const shift = Math.max(0, (naturalWidth / 2) * (zoom - 1) - hostOffsetLeft);
        host.style.transform = `translateX(${shift}px) scale(${zoom})`;
        host.style.height = `${naturalHeight * Math.min(1, zoom)}px`;
        scrollParent.scrollTop = startScrollTop + localOffset * (zoom - startZoom);
        // Re-centers the viewport on host's own (shifted) midpoint whenever `shift` is active — provably
        // always within [0, scrollWidth - clientWidth] (see the file header comment), so unlike the
        // vertical scrollTop line above this can be a plain, gesture-independent assignment: `shift`
        // alone already determines the exactly-centered scrollLeft at any given zoom, no start/delta
        // bookkeeping needed. Zero whenever `shift` is zero, leaving the untouched-since-forever,
        // already-correct no-scroll centering for every zoom level that doesn't need this at all.
        scrollParent.scrollLeft = shift;
    }
    function setZoom(value) {
        const target = clamp(value);
        if (target === zoom)
            return zoom;
        const startZoom = zoom;
        if (animationFrame !== null)
            cancelAnimationFrame(animationFrame);
        // hostRect.top is scale-invariant (transform-origin's Y is pinned at 0%, so the box's own top
        // edge never moves on screen regardless of scale) — fine to read once, before any animation
        // frame runs. localOffset is the viewport-center point's position in host's own unscaled
        // coordinate space; it's fixed for the whole gesture (recomputing it mid-animation would double-
        // count the scroll this same function is actively driving).
        const scrollParent = findScrollParent(host);
        const hostTop = host.getBoundingClientRect().top;
        const anchorClientY = window.innerHeight / 2;
        const localOffset = (anchorClientY - hostTop) / startZoom;
        const gesture = {
            scrollParent,
            startScrollTop: scrollParent.scrollTop,
            startZoom,
            localOffset,
            naturalWidth: host.offsetWidth,
            hostOffsetLeft: host.offsetLeft,
        };
        if (transitionMs <= 0) {
            applyZoom(target, gesture);
            return target;
        }
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / transitionMs);
            applyZoom(startZoom + (target - startZoom) * easeInOutQuad(t), gesture);
            animationFrame = t < 1 ? requestAnimationFrame(step) : null;
        };
        animationFrame = requestAnimationFrame(step);
        return target;
    }
    function fitWidth(pageWidth, availableWidth) {
        return setZoom((availableWidth ?? host.clientWidth) / pageWidth);
    }
    // Cancels any in-flight animation first — otherwise the next in-flight frame would immediately
    // overwrite the freshly re-measured height with a stale-naturalHeight-derived one.
    function refresh() {
        if (animationFrame !== null) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        naturalHeight = host.offsetHeight;
        host.style.height = `${naturalHeight * Math.min(1, zoom)}px`;
    }
    function destroy() {
        if (animationFrame !== null) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        printResetStyleEls.get(host)?.remove();
        printResetStyleEls.delete(host);
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
    };
}
