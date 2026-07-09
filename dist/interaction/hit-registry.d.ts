import type { PaginatedResult } from '../core/paginate.js';
import type { RenderedNode } from '../core/geometry.js';
import type { InteractionAncestor, InteractionRegion, InteractionTarget } from './types.js';
type RegistryEntry = {
    rendered: RenderedNode;
    pageNumber: number;
    region: InteractionRegion;
    ancestors: InteractionAncestor[];
    children: RegistryEntry[];
};
export type HitRegistry = {
    pages: Map<number, RegistryEntry[]>;
};
export declare function buildHitRegistry(result: PaginatedResult): HitRegistry;
/**
 * Finds every node whose `id` matches, across every page — unlike hitTest()/hitTestDroppable()
 * this isn't geometric, it's an identity lookup. Returns one InteractionTarget per matching
 * page/fragment (registry.pages iterates in page order), or [] if nothing matches. A node split
 * across pages by pagination clones its continuation onto each page (see nodes.ts's `id` doc), so
 * a single authored node with an id can legitimately produce multiple entries here.
 */
export declare function findById(registry: HitRegistry, id: string): InteractionTarget[];
/**
 * Finds the deepest geometric match at (x, y) on the given page, then walks back up toward the
 * root looking for the nearest node (self-or-ancestor) with `interactive: true`. Returns null if
 * nothing at that point is interactive, or if the point isn't over any rendered content at all.
 */
export declare function hitTest(registry: HitRegistry, pageNumber: number, x: number, y: number): InteractionTarget | null;
/** Normalizes a node's dragType/accepts (string | string[] | undefined) into a plain array. */
export declare function toTypeList(value: string | string[] | undefined): string[];
/**
 * Same bubble-up resolution as hitTest(), but for `droppable: true` instead of `interactive: true`
 * — used to resolve a drag's `dropTarget`/`overDropTarget`. Independent of hitTest(): a node can
 * be droppable without being interactive, and vice versa. `dragTypes` (normalize with
 * toTypeList()) additionally filters out a droppable node whose `accepts` list doesn't include any
 * of them, continuing to bubble up for a match rather than stopping at the first droppable node.
 */
export declare function hitTestDroppable(registry: HitRegistry, pageNumber: number, x: number, y: number, dragTypes?: string[]): InteractionTarget | null;
export {};
