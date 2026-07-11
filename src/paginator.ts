// The public facade: a Paginator instance owns its own font registry (the one piece of state that
// actually needs isolation — see font-registry.ts's header comment) and exposes the whole
// pagination/render/interaction pipeline as instance methods, so multiple independent Paginators can
// run side by side without one instance's registerFont()/generatePdf() calls corrupting another's.
//
// Everything else this delegates to (paginate(), mount(), attachInteractions(), the hit-registry
// functions, the pdf-view helpers) has no module-level state of its own — they're grouped here as
// methods purely for one consistent object-oriented entry point, not because they need `this`.
//
// Deliberately NOT part of this class: node builders (definePage/text/group/... — pure content
// constructors with no state, see core/nodes.ts) and setLocale/clearCache (re-exported directly from
// @chenglou/pretext — that library's own global, with no instance-scoped equivalent to wrap).

import type { PageDef } from './core/nodes.ts'
import { paginate as corePaginate, type PaginatedResult } from './core/paginate.ts'
import { mount as coreMount, printDocument as corePrintDocument, renderPreview as coreRenderPreview } from './render/shadow-dom.ts'
import { createZoomController as coreCreateZoomController, type ZoomController, type ZoomOptions } from './render/zoom.ts'
import type { RenderedNode } from './core/geometry.ts'
import { generatePdf as coreGeneratePdf, type PdfMetadata } from './render/pdf-render.ts'
import { generateDocx as coreGenerateDocx, type DocxMetadata } from './export/docx-export.ts'
import { generateXlsx as coreGenerateXlsx, type XlsxMetadata } from './export/xlsx-export.ts'
import { listRegisteredFonts as coreListRegisteredFonts, registerFont as coreRegisterFont, type FontRegistry, type FontStyle, type RegisteredFont } from './render/font-registry.ts'
import { attachInteractions as coreAttachInteractions } from './interaction/attach-interactions.ts'
import {
  buildHitRegistry as coreBuildHitRegistry,
  findById as coreFindById,
  findFragments as coreFindFragments,
  hitTest as coreHitTest,
  hitTestDroppable as coreHitTestDroppable,
  toTypeList as coreToTypeList,
  type HitRegistry,
} from './interaction/hit-registry.ts'
import type { AttachInteractionsOptions, InteractionController, InteractionTarget } from './interaction/types.ts'
import { openPdfInNewTab as coreOpenPdfInNewTab, showPdfDialog as coreShowPdfDialog } from './render/pdf-view.ts'

export class Paginator {
  #fonts: FontRegistry = new Map()

  registerFont(options: { family: string; url: string; weight?: number | string; style?: FontStyle }): Promise<void> {
    return coreRegisterFont(this.#fonts, options)
  }

  listRegisteredFonts(): RegisteredFont[] {
    return coreListRegisteredFonts(this.#fonts)
  }

  paginate(doc: PageDef): PaginatedResult {
    return corePaginate(doc)
  }

  mount(result: PaginatedResult, host: HTMLElement): void {
    coreMount(result, host)
  }

  renderPreview(rendered: RenderedNode): HTMLElement {
    return coreRenderPreview(rendered)
  }

  printDocument(host: HTMLElement): void {
    corePrintDocument(host)
  }

  createZoomController(host: HTMLElement, options: ZoomOptions = {}): ZoomController {
    return coreCreateZoomController(host, options)
  }

  attachInteractions(result: PaginatedResult, host: HTMLElement, options: AttachInteractionsOptions = {}): InteractionController {
    return coreAttachInteractions(result, host, options)
  }

  buildHitRegistry(result: PaginatedResult): HitRegistry {
    return coreBuildHitRegistry(result)
  }

  hitTest(registry: HitRegistry, pageNumber: number, x: number, y: number): InteractionTarget | null {
    return coreHitTest(registry, pageNumber, x, y)
  }

  hitTestDroppable(registry: HitRegistry, pageNumber: number, x: number, y: number, dragTypes: string[] = []): InteractionTarget | null {
    return coreHitTestDroppable(registry, pageNumber, x, y, dragTypes)
  }

  findById(registry: HitRegistry, id: string): InteractionTarget[] {
    return coreFindById(registry, id)
  }

  findFragments(registry: HitRegistry, target: InteractionTarget): InteractionTarget[] {
    return coreFindFragments(registry, target)
  }

  toTypeList(value: string | string[] | undefined): string[] {
    return coreToTypeList(value)
  }

  generatePdf(result: PaginatedResult, metadata?: PdfMetadata): Promise<Uint8Array> {
    return coreGeneratePdf(result, this.#fonts, metadata)
  }

  // Unlike generatePdf/mount, these take the pre-pagination PageDef directly rather than a
  // PaginatedResult — Word/Excel reflow content themselves (see src/export/docx-export.ts's header
  // comment), so there's no pixel-box pagination step to run first.
  generateDocx(doc: PageDef, metadata?: DocxMetadata): Promise<Uint8Array> {
    return coreGenerateDocx(doc, metadata)
  }

  generateXlsx(doc: PageDef, metadata?: XlsxMetadata): Promise<Uint8Array> {
    return coreGenerateXlsx(doc, metadata)
  }

  openPdfInNewTab(bytes: Uint8Array): void {
    coreOpenPdfInNewTab(bytes)
  }

  showPdfDialog(bytes: Uint8Array, options?: { title?: string }): { close(): void } {
    return coreShowPdfDialog(bytes, options)
  }
}
