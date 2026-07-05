// Container is a single-child decorative wrapper (background/border/borderRadius/padding) around
// arbitrary content — see nodes.ts's ContainerNode for the full field contract. `height` is a
// MINIMUM, not exact: box content height is Math.max(node.height ?? 0, childNaturalHeight +
// padding.top + padding.bottom), the same targetHeight-as-floor pattern layoutColumn already uses
// (group-layout.ts) — deliberately chosen over exact/clipped sizing so no clip-region code is
// needed in either renderer, and content is never silently lost. Padding always insets the child
// from whatever width/height the box resolved to, exactly like table-layout.ts's layoutCell does
// with cellPadding. Border/borderRadius are pure paint, never consuming layout space.
//
// This module cannot import behavior.ts's registry/isSplittable/etc at runtime — behavior.ts must
// import `containerMeasurer` from here to register it, so the reverse import would be circular
// (same reasoning group-layout.ts's and table-layout.ts's own header comments give for
// themselves). It duplicates a small local dispatch instead, joining the existing group-layout.ts
// / table-layout.ts two-file cycle as a third participant: this file imports `groupMeasurer` from
// group-layout.ts and `tableMeasurer` from table-layout.ts, and those two files import
// `containerMeasurer`/`containerNaturalWidth` back from here. Safe ONLY because every cross-
// reference is used exclusively inside function bodies, never at module top level — do not hoist
// any of them out.

import type { ContainerNode, Margins, Node } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'
import { translateRendered } from './geometry.ts'
import type { NodeMeasurer, SplitOutcome } from './behavior.ts'
import { textMeasurer } from './measure-text.ts'
import { richTextMeasurer } from './measure-rich-text.ts'
import { separatorMainSize, separatorMeasurer } from './separator-layout.ts'
import { imageMeasurer } from './image-layout.ts'
import { chartMeasurer } from './chart-layout.ts'
import { groupMeasurer } from './group-layout.ts'
import { tableMeasurer } from './table-layout.ts'

function resolvePadding(padding: number | Margins | undefined): Margins {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding }
  return padding
}

// The width this container would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing (childCrossWidthInColumn), mirroring
// imageNaturalWidth/chartNaturalWidth exactly (no aspectRatio concept here, so it's simpler).
export function containerNaturalWidth(node: ContainerNode, availableWidth: number): number {
  return node.width ?? availableWidth
}

// --- Local node dispatch (duplicated — see header comment). Recurses into itself via
// `containerMeasurer` (defined below, in the same module) for nested containers. ---

function measureChildHeight(node: Node, width: number): number {
  if (node.type === 'text') return textMeasurer.measureHeight(node, width)
  if (node.type === 'richText') return richTextMeasurer.measureHeight(node, width)
  if (node.type === 'separator') return separatorMainSize(node)
  if (node.type === 'page-break') return 0
  if (node.type === 'image') return imageMeasurer.measureHeight(node, width)
  if (node.type === 'chart') return chartMeasurer.measureHeight(node, width)
  if (node.type === 'table') return tableMeasurer.measureHeight(node, width)
  if (node.type === 'container') return containerMeasurer.measureHeight(node, width)
  return groupMeasurer.measureHeight(node, width)
}

function layoutChildNode(node: Node, width: number): RenderedNode {
  if (node.type === 'text') return textMeasurer.layout(node, width)
  if (node.type === 'richText') return richTextMeasurer.layout(node, width)
  if (node.type === 'separator') return separatorMeasurer.layout(node, width)
  if (node.type === 'page-break') return { type: 'page-break', box: { x: 0, y: 0, width, height: 0 }, node }
  if (node.type === 'image') return imageMeasurer.layout(node, width)
  if (node.type === 'chart') return chartMeasurer.layout(node, width)
  if (node.type === 'table') return tableMeasurer.layout(node, width)
  if (node.type === 'container') return containerMeasurer.layout(node, width)
  return groupMeasurer.layout(node, width)
}

function isSplittableChild(node: Node): boolean {
  if (node.type === 'text') return true
  if (node.type === 'richText') return true
  if (node.type === 'table') return true
  if (node.type === 'container') return isSplittableChild(node.child)
  if (node.type !== 'group') return false
  return node.direction === 'column' || node.splitColumns === true
}

function splitChildNode(node: Node, width: number, availableHeight: number): SplitOutcome<Node> {
  if (node.type === 'text') return textMeasurer.split!(node, width, availableHeight)
  if (node.type === 'richText') return richTextMeasurer.split!(node, width, availableHeight)
  if (node.type === 'table') return tableMeasurer.split!(node, width, availableHeight)
  if (node.type === 'group') return groupMeasurer.split!(node, width, availableHeight)
  if (node.type === 'container') return containerMeasurer.split!(node, width, availableHeight)
  return null
}

export const containerMeasurer: NodeMeasurer<ContainerNode> = {
  // Static per-registry-entry field; the real, child-dependent check is behavior.ts's
  // isSplittable(node) — same non-choice group's own `splittable: false` already makes.
  splittable: false,

  measureHeight(node, width) {
    const pad = resolvePadding(node.padding)
    const childWidth = Math.max(0, width - pad.left - pad.right)
    const childHeight = measureChildHeight(node.child, childWidth)
    return Math.max(node.height ?? 0, childHeight + pad.top + pad.bottom)
  },

  layout(node, width): RenderedNode {
    const pad = resolvePadding(node.padding)
    const childWidth = Math.max(0, width - pad.left - pad.right)
    const rawChild = layoutChildNode(node.child, childWidth)
    const boxHeight = Math.max(node.height ?? 0, rawChild.box.height + pad.top + pad.bottom)
    const child = translateRendered(rawChild, pad.left, pad.top)
    return { type: 'container', box: { x: 0, y: 0, width, height: boxHeight }, node, child }
  },

  split(node, width, availableHeight): SplitOutcome<ContainerNode> {
    if (!isSplittableChild(node.child)) return null
    const pad = resolvePadding(node.padding)
    const childWidth = Math.max(0, width - pad.left - pad.right)
    const childAvailable = availableHeight - pad.top - pad.bottom
    if (childAvailable <= 0) return null
    const childSplit = splitChildNode(node.child, childWidth, childAvailable)
    if (childSplit === null) return null
    const child = translateRendered(childSplit.rendered, pad.left, pad.top)
    const consumedHeight = pad.top + childSplit.consumedHeight + pad.bottom
    // `height` is a MINIMUM only, deliberately NOT re-applied here: enforcing it on a fragment that
    // continues onto the next page would inflate consumedHeight past what the child actually used,
    // corrupting the caller's page-cursor bookkeeping. If `rest` later fits fully on its own (no
    // further split needed), the ordinary layout() path above re-applies the minimum naturally on
    // that final fragment.
    const rest: ContainerNode | null = childSplit.rest === null ? null : { ...node, child: childSplit.rest }
    return {
      rendered: { type: 'container', box: { x: 0, y: 0, width, height: consumedHeight }, node, child },
      consumedHeight,
      rest,
    }
  },
}
