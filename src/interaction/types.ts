// Event/payload types for attachInteractions() — no logic here, see hit-registry.ts and
// attach-interactions.ts.

import type { Node } from '../core/nodes.ts'
import type { Box, RenderedNode } from '../core/geometry.ts'

export type InteractionRegion = 'header' | 'body' | 'footer'

/** A page-relative point, in the same coordinate space InteractionTarget.box uses. */
export type PagePoint = { x: number; y: number }

export type InteractionAncestor = { node: Node; box: Box }

export type InteractionTarget = {
  node: Node
  box: Box
  pageNumber: number
  region: InteractionRegion
  /** Root-to-immediate-parent order; empty when `node` is itself a top-level region root. */
  ancestors: InteractionAncestor[]
  /**
   * The full computed subtree (lines, nested children, box) backing this target — rendering is
   * "flat" in this engine (a group's DOM element isn't an ancestor of its children's elements), so
   * there's no single real DOM element to hand back for "the element underneath." This is the data
   * equivalent: pass it to renderPreview() to get a standalone, pixel-identical copy of exactly
   * what's rendered on the page for this node, suitable for a drag-preview ghost that follows the
   * cursor — see the dragstart handling in demo/interaction-demo.ts for a complete example.
   */
  rendered: RenderedNode
}

export type HoverEvent = { type: 'hover'; target: InteractionTarget; pointer: PagePoint; sourceEvent: PointerEvent }
export type HoverEndEvent = { type: 'hoverend'; target: InteractionTarget; sourceEvent: PointerEvent }
export type ClickEvent = { type: 'click'; target: InteractionTarget; pointer: PagePoint; sourceEvent: MouseEvent }
export type DragStartEvent = {
  type: 'dragstart'
  target: InteractionTarget
  start: PagePoint
  /** Whatever droppable+type-matching node is under the pointer right at drag start, if any — see DragMoveEvent. */
  overDropTarget: InteractionTarget | null
  sourceEvent: PointerEvent
}
export type DragMoveEvent = {
  type: 'drag'
  target: InteractionTarget
  start: PagePoint
  current: PagePoint
  delta: { dx: number; dy: number }
  /**
   * Live, continuously-updated equivalent of `drop`'s `dropTarget`: whatever droppable node is
   * currently under the pointer, filtered by `target.node.dragType` against each candidate's
   * `accepts` list the same way `dropTarget` is — null while hovering empty space, a non-droppable
   * node with no droppable ancestor, or a droppable node whose `accepts` rejects this drag's
   * type(s). Intended for live valid/invalid drop-zone feedback (e.g. highlighting) while dragging,
   * distinct from `dropTarget` on the `drop` event, which is the one-time resolution at release.
   */
  overDropTarget: InteractionTarget | null
  sourceEvent: PointerEvent
}
export type DragEndEvent = {
  type: 'dragend'
  target: InteractionTarget
  start: PagePoint
  current: PagePoint
  delta: { dx: number; dy: number }
  cancelled: boolean
  sourceEvent: PointerEvent
}

/**
 * Fires alongside `dragend`, but only for an uncancelled release (never after pointercancel) —
 * `dragend` always tells you the drag finished, `drop` additionally tells you what, if anything,
 * was under the pointer when it did. `target` is the node that was being dragged (same node
 * `dragstart`/`drag`/`dragend` report); `dropTarget` is resolved via the same hit-test used for
 * hover/click, so it's `null` when the release point isn't over any interactive node (including
 * when it's over empty space, or over a plain/non-interactive node with no interactive ancestor).
 * `dropTarget` can legitimately equal `target` if the drag ends back over its own starting node.
 */
export type DropEvent = {
  type: 'drop'
  target: InteractionTarget
  dropTarget: InteractionTarget | null
  start: PagePoint
  current: PagePoint
  delta: { dx: number; dy: number }
  sourceEvent: PointerEvent
}

// Our own event-map keys, unrelated to the browser's native HTML5 drag-and-drop `dragstart`/`drop`
// DOM events (which attach-interactions.ts actively suppresses `dragstart` for on <img> elements,
// since those are natively draggable and would otherwise fire a native ghost-image drag alongside
// ours; there is no native `drop` listener here at all, ours is purely our own pointer-based one).
export type InteractionEventMap = {
  hover: HoverEvent
  hoverend: HoverEndEvent
  click: ClickEvent
  dragstart: DragStartEvent
  drag: DragMoveEvent
  dragend: DragEndEvent
  drop: DropEvent
}

export type InteractionController = {
  /** Returns an unsubscribe function; safe to ignore if you never need to remove this handler. */
  on<K extends keyof InteractionEventMap>(type: K, handler: (ev: InteractionEventMap[K]) => void): () => void
  off<K extends keyof InteractionEventMap>(type: K, handler: (ev: InteractionEventMap[K]) => void): void
  destroy(): void
}

export type AttachInteractionsOptions = {
  /** px of client-space pointer movement before a pointerdown-on-a-target promotes to a drag. Default 4. */
  dragThreshold?: number
  /**
   * Live getter for the current CSS scale factor applied to the mounted document (e.g. via
   * createZoomController's getZoom). Defaults to `() => 1`. getBoundingClientRect() reports
   * post-transform screen px, so pointer coordinates are divided by this before hit-testing to
   * recover the unscaled page-content px space every RenderedNode.box is expressed in.
   */
  zoom?: () => number
}
