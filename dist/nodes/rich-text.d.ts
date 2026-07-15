import type { RichTextNode } from '../core/nodes.js';
/** Shrink-to-fit width for cross/main-axis sizing in Group/Table layout — the widest forced line.
 *  For sideways richText (`node.orientation` is `'vertical'`/`'vertical-reversed'`), this is the
 *  POST-rotation footprint (line count × lineHeight), mirroring text.ts's measureTextNaturalWidth. */
export declare function richTextNaturalWidth(node: RichTextNode): number;
