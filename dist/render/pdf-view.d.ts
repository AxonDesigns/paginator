/**
 * Opens `bytes` as a PDF in a new browser tab via the browser's native PDF viewer. The object URL is
 * intentionally never revoked — the new tab needs it for its own lifetime, and closing that *other*
 * tab fires no event this function could listen for; this accepts the same small per-call resource
 * cost common blob-URL download patterns do rather than risking revoking a URL a slow-loading tab
 * still needs.
 */
export declare function openPdfInNewTab(bytes: Uint8Array): void;
/**
 * Shows a modal <dialog> with an <iframe> displaying the PDF (native PDF viewer inside the iframe).
 * Lives in the light DOM, like the demo's Print button — it's page chrome, not paginated document
 * content, so invariant #5's inline-styles-only rule doesn't apply here. Returns a controller so the
 * caller can dismiss it programmatically; the object URL is revoked once the dialog closes.
 */
export declare function showPdfDialog(bytes: Uint8Array, options?: {
    title?: string;
}): {
    close(): void;
};
