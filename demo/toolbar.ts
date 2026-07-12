import { text } from '../src/index.ts'
import type { PageDef, Paginator, PaginatedResult, ZoomController } from '../src/index.ts'
import { UI_FONT } from './fonts.ts'

// Lives outside the shadow root (light DOM), so it's free to use a class name + external CSS
// (`.no-print` in style.css) instead of the inline-styles-only rule that governs the paginated
// document itself — that rule exists to isolate the document from host CSS, not this demo chrome.
// Fixed in the viewport, not the document, and appended directly to <body> — this is demo chrome,
// not part of the paginated content pdfDoc.mount() renders into #app.
export function createToolbar(): HTMLDivElement {
  const toolbar = document.createElement('div')
  toolbar.className = 'no-print'
  Object.assign(toolbar.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '1000',
    display: 'flex',
    gap: '12px',
  })
  document.body.appendChild(toolbar)
  return toolbar
}

function demoButton(toolbar: HTMLDivElement, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = label
  Object.assign(button.style, {
    padding: '10px 18px',
    fontFamily: UI_FONT,
    fontSize: '14px',
    fontWeight: '700',
    color: '#ffffff',
    background: '#4f7cff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  })
  toolbar.appendChild(button)
  return button
}

// Demo-only UI on top of the library's headless createZoomController(): the library owns zoom
// state/clamping/animation and (via attachInteractions' `zoom` option, wired in
// interaction-demo.ts's setupInteractionDemo) keeping hit-testing aligned at any zoom level; buttons,
// the percentage label, and disabling at the bounds are all just this demo's own choices, not
// library concerns.
export function setupZoomButtons(toolbar: HTMLDivElement, zoom: ZoomController): void {
  const outButton = demoButton(toolbar, '−')
  const label = document.createElement('span')
  Object.assign(label.style, {
    display: 'flex',
    alignItems: 'center',
    fontFamily: UI_FONT,
    fontSize: '14px',
    fontWeight: '700',
    color: '#333333',
    minWidth: '44px',
    justifyContent: 'center',
  })
  toolbar.appendChild(label)
  const inButton = demoButton(toolbar, '+')
  const resetButton = demoButton(toolbar, 'Reset')

  function refresh(): void {
    const value = zoom.getZoom()
    label.textContent = `${Math.round(value * 100)}%`
    outButton.disabled = value <= 0.5
    inButton.disabled = value >= 2.5
  }

  // getZoom() updates every animation frame while a zoom change is in flight (see zoom.ts) rather
  // than jumping to the target immediately, so a single refresh() right after zoomIn()/zoomOut()/
  // reset() would just show the pre-animation value and then never update again. Polling every frame
  // until the live value reaches the target — itself the return value of those calls — keeps the
  // label animating in step with the zoom instead of lagging a click behind.
  let pollFrame: number | null = null
  function trackTo(target: number): void {
    if (pollFrame !== null) cancelAnimationFrame(pollFrame)
    const tick = (): void => {
      refresh()
      pollFrame = Math.abs(zoom.getZoom() - target) > 0.001 ? requestAnimationFrame(tick) : null
    }
    tick()
  }

  outButton.addEventListener('click', () => trackTo(zoom.zoomOut()))
  inButton.addEventListener('click', () => trackTo(zoom.zoomIn()))
  resetButton.addEventListener('click', () => trackTo(zoom.reset()))

  refresh()
}

// Printing/PDF-viewing chrome is plain browser-native UI, not part of the library's API — the
// library only produces data (a mounted shadow host, or generatePdf()'s PDF bytes); what the demo
// does with that data to open a print dialog or a PDF preview is entirely up to this file.

function printDocument(host: HTMLElement): void {
  if (host.shadowRoot === null) {
    throw new Error('printDocument() called on a host that has no mount() output yet — call pdfDoc.mount(result, host) first.')
  }
  window.print()
}

const PDF_MIME_TYPE = 'application/pdf'

// The object URL is intentionally never revoked — the new tab needs it for its own lifetime, and
// closing that *other* tab fires no event this function could listen for; this accepts the same
// small per-call resource cost common blob-URL download patterns do rather than risking revoking a
// URL a slow-loading tab still needs.
function openPdfInNewTab(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF_MIME_TYPE }))
  window.open(url, '_blank')
}

// Shows a modal <dialog> with an <iframe> displaying the PDF (native PDF viewer inside the iframe).
// Lives in the light DOM, like the demo's other toolbar chrome — it's page chrome, not paginated
// document content.
function showPdfDialog(bytes: Uint8Array, options?: { title?: string }): { close(): void } {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF_MIME_TYPE }))

  const dialog = document.createElement('dialog')
  Object.assign(dialog.style, {
    padding: '0',
    border: 'none',
    borderRadius: '8px',
    width: '90vw',
    height: '90vh',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35)',
  })

  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #ddd',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '14px',
  })
  const titleEl = document.createElement('span')
  titleEl.textContent = options?.title ?? 'PDF Preview'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = 'Close'
  closeButton.onclick = () => dialog.close()
  header.append(titleEl, closeButton)

  const iframe = document.createElement('iframe')
  iframe.src = url
  Object.assign(iframe.style, { width: '100%', height: 'calc(100% - 41px)', border: 'none' })

  dialog.append(header, iframe)
  document.body.appendChild(dialog)
  dialog.addEventListener('close', () => {
    URL.revokeObjectURL(url)
    dialog.remove()
  })
  dialog.showModal()

  return { close: () => dialog.close() }
}

export function setupPrintButton(toolbar: HTMLDivElement, host: HTMLDivElement): void {
  const button = demoButton(toolbar, 'Print')
  button.addEventListener('click', () => printDocument(host))
}

// generatePdf() walks the same PaginatedResult mount() already rendered above — see pdf-render.ts's
// header comment. Both buttons regenerate on each click rather than caching the bytes, since this is
// a demo of the API surface, not a perf-sensitive app; a real integration would generate once and
// reuse the bytes for both actions if the user might invoke either.
export function setupPdfButtons(toolbar: HTMLDivElement, pdfDoc: Paginator, result: PaginatedResult): void {
  const openButton = demoButton(toolbar, 'Open PDF')
  openButton.addEventListener('click', () => {
    void (async () => {
      openButton.disabled = true
      openButton.textContent = 'Generating…'
      try {
        openPdfInNewTab(await pdfDoc.generatePdf(result, { title: 'Paginator Demo' }))
      } finally {
        openButton.disabled = false
        openButton.textContent = 'Open PDF'
      }
    })()
  })

  const previewButton = demoButton(toolbar, 'Preview PDF')
  previewButton.addEventListener('click', () => {
    void (async () => {
      previewButton.disabled = true
      previewButton.textContent = 'Generating…'
      try {
        showPdfDialog(await pdfDoc.generatePdf(result, { title: 'Paginator Demo' }), { title: 'PDF Preview' })
      } finally {
        previewButton.disabled = false
        previewButton.textContent = 'Preview PDF'
      }
    })()
  })
}

function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// Unlike PDF (openPdfInNewTab/showPdfDialog), browsers have no native inline viewer for .docx/.xlsx
// — a synthetic anchor + Blob URL is the standard way to hand the browser a same-origin download.
// generateDocx()/generateXlsx() take the raw PageDef directly (not a PaginatedResult) — see
// paginator.ts's header comment on generateDocx: Word/Excel reflow their own content, so there's no
// pixel-box pagination step to run first.
// doc.footer interpolates the REAL pageNumber/totalPages — correct for PDF/DOM, which resolve it
// once per actual page during paginate(). generateDocx() instead resolves header/footer content
// ONCE with a placeholder {pageNumber:1,totalPages:1} (Word paginates the body itself), so reusing
// that same footer verbatim would bake in the literal, wrong-past-page-1 text "Page 1 of 1". A
// docx-only footer swaps in the `{{pageNumber}}`/`{{totalPages}}` sentinel instead, which
// generateDocx() splices into live PAGE/NUMPAGES Word fields — see docx-export.ts's header comment.
function docxFooter(): ReturnType<typeof text> {
  return text({
    content: 'Page {{pageNumber}} of {{totalPages}}',
    fontFamily: UI_FONT,
    fontSize: 10,
    color: '#888888',
    align: 'right',
  })
}

export function setupExportButtons(toolbar: HTMLDivElement, pdfDoc: Paginator, doc: PageDef): void {
  const wordButton = demoButton(toolbar, 'Export Word')
  wordButton.addEventListener('click', () => {
    void (async () => {
      wordButton.disabled = true
      wordButton.textContent = 'Generating…'
      try {
        const bytes = await pdfDoc.generateDocx({ ...doc, footer: docxFooter }, { title: 'Paginator Demo' })
        downloadBytes(bytes, 'paginator-demo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      } finally {
        wordButton.disabled = false
        wordButton.textContent = 'Export Word'
      }
    })()
  })

  const excelButton = demoButton(toolbar, 'Export Excel')
  excelButton.addEventListener('click', () => {
    void (async () => {
      excelButton.disabled = true
      excelButton.textContent = 'Generating…'
      try {
        const bytes = await pdfDoc.generateXlsx(doc, { title: 'Paginator Demo' })
        downloadBytes(bytes, 'paginator-demo.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } finally {
        excelButton.disabled = false
        excelButton.textContent = 'Export Excel'
      }
    })()
  })
}
