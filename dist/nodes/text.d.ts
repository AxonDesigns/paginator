import type { TextNode } from '../core/nodes.js';
/**
 * Shrink-to-fit width for cross/main-axis sizing in Group/Table layout — the widest forced line,
 * ignoring any wrap constraint entirely (that's the whole point of a "natural"/unconstrained
 * width). For sideways text (`node.orientation` is `'vertical'`/`'vertical-reversed'`), this is the
 * POST-rotation footprint (`vwrapWidth()`'s line count × lineHeight) — see that function's own doc
 * comment for why sideways text ignores the ambient width everywhere, making this trivially
 * self-consistent with `layout()`/`measureHeight()` below no matter what any caller passes in.
 */
export declare function measureTextNaturalWidth(node: TextNode): number;
