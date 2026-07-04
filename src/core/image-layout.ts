// Image sizing is pure arithmetic from declared width/height/aspectRatio — never from the loaded
// asset's actual pixel dimensions, which would force paginate() to become asynchronous. The
// resolved box only needs to be the right SHAPE; any mismatch between that box and the real
// image's aspect ratio is reconciled by the native `object-fit` CSS property on the rendered
// <img> in the renderer, exactly the way it would be for a plain HTML image.

import type { NodeMeasurer } from './behavior.ts'
import type { ImageNode } from './nodes.ts'
import type { RenderedNode } from './geometry.ts'

// Height at a given (already-resolved) box width. image()'s constructor already guarantees at
// least one of height/aspectRatio is present, so the fallback branch here is unreachable in
// practice — kept as a defensive error rather than a silent NaN if a node is ever hand-built
// bypassing the image() builder.
function resolveHeight(node: ImageNode, width: number): number {
  if (node.height !== undefined) return node.height
  if (node.aspectRatio !== undefined) return width / node.aspectRatio
  throw new Error('[paginator] image node has neither "height" nor "aspectRatio" — use the image() builder, which validates this upfront.')
}

// The width this image would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing (childCrossWidthInColumn), mirroring how a text
// node's natural width is used there. An image with no explicit width and only an aspectRatio has
// no opinion of its own and defaults to filling whatever width it's offered, same as a separator.
export function imageNaturalWidth(node: ImageNode, availableWidth: number): number {
  if (node.width !== undefined) return node.width
  if (node.height !== undefined && node.aspectRatio !== undefined) return node.height * node.aspectRatio
  return availableWidth
}

export const imageMeasurer: NodeMeasurer<ImageNode> = {
  splittable: false,

  measureHeight(node, width) {
    return resolveHeight(node, width)
  },

  layout(node, width): RenderedNode {
    return { type: 'image', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node }
  },
}
