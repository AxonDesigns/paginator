// The DOM-facing piece of the interaction API: translates native Pointer Events into hover/click/
// drag callbacks carrying InteractionTargets resolved via hit-registry.ts's pure-data hit test.
//
// Listeners are attached to `host` (the actual light-DOM element with real bounding geometry), not
// the shadow root — pointerleave specifically needs a real Element to know "left this area," and
// shadow-boundary event retargeting means `event.target` seen from a `host` listener collapses to
// `host` itself anyway, which we don't rely on: every resolution here is coordinate-based
// (`clientX`/`clientY` + `getBoundingClientRect()`), never `event.target`-based.

import type { PaginatedResult } from '../core/paginate.ts'
import { buildHitRegistry, hitTest, hitTestDroppable, toTypeList, type HitRegistry } from './hit-registry.ts'
import type { AttachInteractionsOptions, InteractionController, InteractionEventMap, InteractionTarget, PagePoint } from './types.ts'

type Handler<K extends keyof InteractionEventMap> = (ev: InteractionEventMap[K]) => void

type ResolvedPagePos = { pageNumber: number; x: number; y: number; rect: DOMRect }

type DragCandidate = {
  target: InteractionTarget
  pointerId: number
  startClientX: number
  startClientY: number
  startPageNumber: number
  startPagePos: PagePoint
  pageRect: DOMRect
  /** Normalized from target.node.dragType once at pointerdown — same list used for every
   *  overDropTarget/dropTarget resolution for the whole gesture. */
  dragTypes: string[]
}

function sameTarget(a: InteractionTarget | null, b: InteractionTarget | null): boolean {
  if (a === null || b === null) return a === b
  return a.node === b.node && a.pageNumber === b.pageNumber
}

export function attachInteractions(result: PaginatedResult, host: HTMLElement, options: AttachInteractionsOptions = {}): InteractionController {
  const dragThreshold = options.dragThreshold ?? 4
  const getZoom = options.zoom ?? (() => 1)
  const registry: HitRegistry = buildHitRegistry(result)

  const root = host.shadowRoot
  if (root === null) {
    throw new Error('[paginator] attachInteractions requires mount(result, host) to have run first.')
  }

  const pageElements = new Map<number, HTMLElement>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-page-number]')) {
    const pageNumber = Number.parseInt(el.dataset.pageNumber ?? '', 10)
    if (!Number.isNaN(pageNumber)) pageElements.set(pageNumber, el)
  }

  const listeners = new Map<keyof InteractionEventMap, Set<Handler<never>>>()
  function emit<K extends keyof InteractionEventMap>(type: K, ev: InteractionEventMap[K]): void {
    const set = listeners.get(type)
    if (set === undefined) return
    for (const handler of set) (handler as Handler<K>)(ev)
  }

  let lastHoverTarget: InteractionTarget | null = null
  let dragCandidate: DragCandidate | null = null
  let dragActive = false
  let didDrag = false

  function resolvePagePos(clientX: number, clientY: number): ResolvedPagePos | null {
    for (const [pageNumber, el] of pageElements) {
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom) {
        const zoom = getZoom()
        return { pageNumber, x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom, rect }
      }
    }
    return null
  }

  function updateHover(e: PointerEvent): void {
    const pos = resolvePagePos(e.clientX, e.clientY)
    const target = pos === null ? null : hitTest(registry, pos.pageNumber, pos.x, pos.y)
    if (sameTarget(target, lastHoverTarget)) return
    if (lastHoverTarget !== null) emit('hoverend', { type: 'hoverend', target: lastHoverTarget, sourceEvent: e })
    lastHoverTarget = target
    if (target !== null && pos !== null) emit('hover', { type: 'hover', target, pointer: { x: pos.x, y: pos.y }, sourceEvent: e })
  }

  function onPointerDown(e: PointerEvent): void {
    const pos = resolvePagePos(e.clientX, e.clientY)
    if (pos === null) return
    const target = hitTest(registry, pos.pageNumber, pos.x, pos.y)
    // `draggable` only takes effect alongside `interactive` (already required for hitTest to
    // match at all); a plain interactive node still gets hover/click, just never arms a drag.
    if (target === null || target.node.draggable !== true) return

    dragCandidate = {
      target,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPageNumber: pos.pageNumber,
      startPagePos: { x: pos.x, y: pos.y },
      pageRect: pos.rect,
      dragTypes: toTypeList(target.node.dragType),
    }
    didDrag = false
    dragActive = false
    host.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent): void {
    updateHover(e)
    if (dragCandidate === null || dragCandidate.pointerId !== e.pointerId) return

    if (!dragActive) {
      const dist = Math.hypot(e.clientX - dragCandidate.startClientX, e.clientY - dragCandidate.startClientY)
      if (dist < dragThreshold) return
      dragActive = true
      didDrag = true
      // Resolved at the ORIGINAL down position/page, matching `start` — not wherever the pointer
      // happens to be once it's crossed the drag threshold.
      const startOverDropTarget = hitTestDroppable(
        registry,
        dragCandidate.startPageNumber,
        dragCandidate.startPagePos.x,
        dragCandidate.startPagePos.y,
        dragCandidate.dragTypes,
      )
      emit('dragstart', {
        type: 'dragstart',
        target: dragCandidate.target,
        start: dragCandidate.startPagePos,
        overDropTarget: startOverDropTarget,
        sourceEvent: e,
      })
    }

    // Anchored to the START page's rect for the whole gesture, so straying across a page boundary
    // mid-drag doesn't cause a coordinate-space discontinuity. Divided by the current zoom, same as
    // resolvePagePos, to stay in the same page-content px space as startPagePos.
    const zoom = getZoom()
    const current = { x: (e.clientX - dragCandidate.pageRect.left) / zoom, y: (e.clientY - dragCandidate.pageRect.top) / zoom }
    const delta = { dx: current.x - dragCandidate.startPagePos.x, dy: current.y - dragCandidate.startPagePos.y }

    // Live overDropTarget: resolved fresh at the CURRENT pointer position/page (may differ from
    // where the drag started), filtered by dragType the same way dropTarget is at release.
    const currentPos = resolvePagePos(e.clientX, e.clientY)
    const overDropTarget =
      currentPos === null ? null : hitTestDroppable(registry, currentPos.pageNumber, currentPos.x, currentPos.y, dragCandidate.dragTypes)

    emit('drag', { type: 'drag', target: dragCandidate.target, start: dragCandidate.startPagePos, current, delta, overDropTarget, sourceEvent: e })
  }

  function endDrag(e: PointerEvent, cancelled: boolean): void {
    if (dragCandidate === null || dragCandidate.pointerId !== e.pointerId) return
    if (dragActive) {
      const zoom = getZoom()
      const current = { x: (e.clientX - dragCandidate.pageRect.left) / zoom, y: (e.clientY - dragCandidate.pageRect.top) / zoom }
      const delta = { dx: current.x - dragCandidate.startPagePos.x, dy: current.y - dragCandidate.startPagePos.y }
      emit('dragend', { type: 'dragend', target: dragCandidate.target, start: dragCandidate.startPagePos, current, delta, cancelled, sourceEvent: e })

      if (!cancelled) {
        // Resolved fresh at the release point (not dragCandidate.pageRect) since the drop target
        // may be on a different page than where the drag started. Uses `droppable`, not
        // `interactive` — a landing zone doesn't have to be hoverable/clickable itself. Filtered by
        // dragTypes the same way overDropTarget was throughout the drag.
        const releasePos = resolvePagePos(e.clientX, e.clientY)
        const dropTarget =
          releasePos === null ? null : hitTestDroppable(registry, releasePos.pageNumber, releasePos.x, releasePos.y, dragCandidate.dragTypes)
        emit('drop', { type: 'drop', target: dragCandidate.target, dropTarget, start: dragCandidate.startPagePos, current, delta, sourceEvent: e })
      }
    }
    dragCandidate = null
    dragActive = false
  }
  function onPointerUp(e: PointerEvent): void {
    endDrag(e, false)
  }
  function onPointerCancel(e: PointerEvent): void {
    endDrag(e, true)
  }

  function onPointerLeave(e: PointerEvent): void {
    if (lastHoverTarget !== null) {
      emit('hoverend', { type: 'hoverend', target: lastHoverTarget, sourceEvent: e })
      lastHoverTarget = null
    }
  }

  function onClick(e: MouseEvent): void {
    // A real drag (>= dragThreshold movement) synthesizes a trailing `click` in most browsers;
    // suppress it so a consumer never sees both `dragend` and `click` for the same gesture.
    if (didDrag) {
      didDrag = false
      return
    }
    const pos = resolvePagePos(e.clientX, e.clientY)
    if (pos === null) return
    const target = hitTest(registry, pos.pageNumber, pos.x, pos.y)
    if (target === null) return
    emit('click', { type: 'click', target, pointer: { x: pos.x, y: pos.y }, sourceEvent: e })
  }

  // <img> elements are natively draggable; suppress the browser's own ghost-image drag so it
  // doesn't run concurrently with our pointer-based drag gesture above.
  function onNativeDragStart(e: DragEvent): void {
    e.preventDefault()
  }

  host.addEventListener('pointerdown', onPointerDown)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', onPointerUp)
  host.addEventListener('pointercancel', onPointerCancel)
  host.addEventListener('pointerleave', onPointerLeave)
  host.addEventListener('click', onClick)
  host.addEventListener('dragstart', onNativeDragStart)

  return {
    on(type, handler) {
      let set = listeners.get(type)
      if (set === undefined) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(handler as Handler<never>)
      return () => listeners.get(type)?.delete(handler as Handler<never>)
    },
    off(type, handler) {
      listeners.get(type)?.delete(handler as Handler<never>)
    },
    destroy() {
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerCancel)
      host.removeEventListener('pointerleave', onPointerLeave)
      host.removeEventListener('click', onClick)
      host.removeEventListener('dragstart', onNativeDragStart)
      listeners.clear()
      pageElements.clear()
    },
  }
}
