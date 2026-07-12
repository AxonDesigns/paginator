import './style.css'
import { Paginator, ready } from '../src/index.ts'
import { INTER_BOLD_URL, INTER_REGULAR_URL, SOURCE_SERIF_BOLD_URL, SOURCE_SERIF_REGULAR_URL } from './fonts.ts'
import { doc } from './doc.ts'
import { setupInteractionDemo } from './interaction-demo.ts'
import { createToolbar, setupExportButtons, setupPdfButtons, setupPrintButton, setupZoomButtons } from './toolbar.ts'

async function main(): Promise<void> {
  const pdfDoc = new Paginator()

  // Registers the literal font FILES this demo's text is set in, before ready()/paginate() ever run
  // — so pretext's canvas measurement and generatePdf()'s embedded PDF glyphs use the exact same
  // bytes (see font-registry.ts). Without this, UI_FONT/BODY_FONT would resolve to whatever system
  // font stack is installed, which generatePdf() cannot embed (no accessible file), and PDF export
  // would fall back to Helvetica with a console warning instead of matching the preview exactly.
  await Promise.all([
    pdfDoc.registerFont({ family: 'Inter', weight: 400, url: INTER_REGULAR_URL }),
    pdfDoc.registerFont({ family: 'Inter', weight: 700, url: INTER_BOLD_URL }),
    pdfDoc.registerFont({ family: 'Source Serif 4', weight: 400, url: SOURCE_SERIF_REGULAR_URL }),
    pdfDoc.registerFont({ family: 'Source Serif 4', weight: 700, url: SOURCE_SERIF_BOLD_URL }),
  ])
  await ready()
  const result = pdfDoc.paginate(doc)
  const app = document.querySelector<HTMLDivElement>('#app')
  if (app === null) throw new Error('#app not found')
  pdfDoc.mount(result, app)
  const zoom = pdfDoc.createZoomController(app)
  setupInteractionDemo(pdfDoc, result, app, zoom)
  const toolbar = createToolbar()
  setupZoomButtons(toolbar, zoom)
  setupPrintButton(toolbar, app)
  setupPdfButtons(toolbar, pdfDoc, result)
  setupExportButtons(toolbar, pdfDoc, doc)
}

void main()
