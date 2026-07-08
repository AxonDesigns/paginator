// "Take PDF bytes, do something visible in the browser chrome" — deliberately decoupled from
// generatePdf()/PaginatedResult entirely (same data/paint split paginate()/mount() already model),
// so either helper works with PDF bytes from any source.
const PDF_MIME_TYPE = 'application/pdf';
/**
 * Opens `bytes` as a PDF in a new browser tab via the browser's native PDF viewer. The object URL is
 * intentionally never revoked — the new tab needs it for its own lifetime, and closing that *other*
 * tab fires no event this function could listen for; this accepts the same small per-call resource
 * cost common blob-URL download patterns do rather than risking revoking a URL a slow-loading tab
 * still needs.
 */
export function openPdfInNewTab(bytes) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF_MIME_TYPE }));
    window.open(url, '_blank');
}
/**
 * Shows a modal <dialog> with an <iframe> displaying the PDF (native PDF viewer inside the iframe).
 * Lives in the light DOM, like the demo's Print button — it's page chrome, not paginated document
 * content, so invariant #5's inline-styles-only rule doesn't apply here. Returns a controller so the
 * caller can dismiss it programmatically; the object URL is revoked once the dialog closes.
 */
export function showPdfDialog(bytes, options) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF_MIME_TYPE }));
    const dialog = document.createElement('dialog');
    Object.assign(dialog.style, {
        padding: '0',
        border: 'none',
        borderRadius: '8px',
        width: '90vw',
        height: '90vh',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35)',
    });
    const header = document.createElement('div');
    Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #ddd',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '14px',
    });
    const titleEl = document.createElement('span');
    titleEl.textContent = options?.title ?? 'PDF Preview';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.onclick = () => dialog.close();
    header.append(titleEl, closeButton);
    const iframe = document.createElement('iframe');
    iframe.src = url;
    Object.assign(iframe.style, { width: '100%', height: 'calc(100% - 41px)', border: 'none' });
    dialog.append(header, iframe);
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => {
        URL.revokeObjectURL(url);
        dialog.remove();
    });
    dialog.showModal();
    return { close: () => dialog.close() };
}
