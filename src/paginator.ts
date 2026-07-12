// The public facade: a Paginator instance owns its own font registry (the one piece of state that
// actually needs isolation — see font-registry.ts's header comment) and exposes the whole
// pagination/render/interaction pipeline as instance methods, so multiple independent Paginators can
// run side by side without one instance's registerFont()/generatePdf() calls corrupting another's.
//
// Everything else this delegates to (attachInteractions(), the hit-registry functions) has no
// module-level state of its own — they're grouped here as methods purely for one consistent
// object-oriented entry point, not because they need `this`. paginate()/mount()/renderPreview() are
// the one exception: they wrap their delegate call in withActiveFontRegistry(this.#fonts, ...) so
// text/richText/watermark font resolution can see this instance's own registry — see font-registry.ts.
//
// Deliberately NOT part of this class: node builders (definePage/text/group/... — pure content
// constructors with no state, see core/nodes.ts), setLocale/clearCache (re-exported directly from
// @chenglou/pretext — that library's own global, with no instance-scoped equivalent to wrap), and
// printing/PDF-viewing chrome (window.print(), opening PDF bytes in a tab/dialog) — those are plain
// browser-native calls a consumer makes directly against its own host element/generatePdf() output;
// this library has no opinion on that UI, so it doesn't wrap it (see the demo's main.ts for the
// pattern).

import type { PageDef } from './core/nodes.ts'
import { paginate as corePaginate, type PaginatedResult } from './core/paginate.ts'
import { mount as coreMount, renderPreview as coreRenderPreview, unmount as coreUnmount } from './render/shadow-dom.ts'
import { createZoomController as coreCreateZoomController, type ZoomController, type ZoomOptions } from './render/zoom.ts'
import type { RenderedNode } from './core/geometry.ts'
import { generatePdf as coreGeneratePdf, type PdfMetadata } from './render/pdf-render.ts'
import { generateDocx as coreGenerateDocx, type DocxMetadata } from './export/docx-export.ts'
import { generateXlsx as coreGenerateXlsx, type XlsxMetadata } from './export/xlsx-export.ts'
import {
  listRegisteredFonts as coreListRegisteredFonts,
  registerFont as coreRegisterFont,
  withActiveFontRegistry,
  type FontRegistry,
  type FontStyle,
  type RegisteredFont,
} from './render/font-registry.ts'
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

export class Paginator {
  #fonts: FontRegistry = new Map()

  registerFont(options: { family: string; url: string; weight?: number | string; style?: FontStyle }): Promise<void> {
    return coreRegisterFont(this.#fonts, options)
  }

  listRegisteredFonts(): RegisteredFont[] {
    return coreListRegisteredFonts(this.#fonts)
  }

  // Wrapped in withActiveFontRegistry() so text/richText/watermark font resolution can transparently
  // substitute this instance's own per-instance font alias wherever a family/weight/style was
  // registerFont()-ed on it — see font-registry.ts's header comment for why that's needed at all
  // (document.fonts is one page-global set, not scoped per Paginator instance). Safe here specifically
  // because both calls are fully synchronous (no internal `await`), so there's no window for a second,
  // concurrent Paginator's call to observe this instance's registry — unlike generatePdf(), which is
  // async and threads its own registry through PdfContext.fonts explicitly instead.
  paginate(doc: PageDef): PaginatedResult {
    return withActiveFontRegistry(this.#fonts, () => corePaginate(doc))
  }

  mount(result: PaginatedResult, host: HTMLElement): void {
    withActiveFontRegistry(this.#fonts, () => coreMount(result, host))
  }

  /**
   * Tears down a host previously passed to `mount()` — removes the window-level print-mode listeners
   * `mount()` attaches and clears the shadow root. Call this from a framework wrapper's own unmount
   * path when discarding `host` for good; re-`mount()`ing the SAME host again already self-cleans its
   * own prior listeners, so this is only needed when `host` itself won't be reused.
   */
  unmount(host: HTMLElement): void {
    coreUnmount(host)
  }

  renderPreview(rendered: RenderedNode): HTMLElement {
    return withActiveFontRegistry(this.#fonts, () => coreRenderPreview(rendered))
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
}
