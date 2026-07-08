import type { PaginatedResult } from '../core/paginate.js';
import type { RenderedNode } from '../core/geometry.js';
export declare function styledDiv(style: Partial<CSSStyleDeclaration>): HTMLDivElement;
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
export declare function renderPreview(rendered: RenderedNode): HTMLElement;
export declare function mount(result: PaginatedResult, host: HTMLElement): void;
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
export declare function printDocument(host: HTMLElement): void;
