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
 * Tears down a host previously passed to `mount()`: removes the light-DOM `@page` `<style>` element
 * `mount()` wrote to `host.ownerDocument.head`, and clears the shadow root's content (which takes
 * the shadow-scoped print-mode `<style>` with it). Call this from a framework wrapper's own
 * unmount/cleanup path (e.g. a React effect's cleanup, Vue's `onUnmounted`, a Svelte action's
 * `destroy`) — re-running `mount()` on the SAME host already reuses the same light-DOM `<style>`
 * element, so this is only needed when the host itself is being discarded for good. Safe to call on
 * a host that was never mounted (no-op).
 */
export declare function unmount(host: HTMLElement): void;
