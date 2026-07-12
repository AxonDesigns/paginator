import type { PageDef } from './core/nodes.js';
import { type PaginatedResult } from './core/paginate.js';
import { type ZoomController, type ZoomOptions } from './render/zoom.js';
import type { RenderedNode } from './core/geometry.js';
import { type PdfMetadata } from './render/pdf-render.js';
import { type DocxMetadata } from './export/docx-export.js';
import { type XlsxMetadata } from './export/xlsx-export.js';
import { type FontStyle, type RegisteredFont } from './render/font-registry.js';
import { type HitRegistry } from './interaction/hit-registry.js';
import type { AttachInteractionsOptions, InteractionController, InteractionTarget } from './interaction/types.js';
export declare class Paginator {
    #private;
    registerFont(options: {
        family: string;
        url: string;
        weight?: number | string;
        style?: FontStyle;
    }): Promise<void>;
    listRegisteredFonts(): RegisteredFont[];
    paginate(doc: PageDef): PaginatedResult;
    mount(result: PaginatedResult, host: HTMLElement): void;
    /**
     * Tears down a host previously passed to `mount()` — removes the window-level print-mode listeners
     * `mount()` attaches and clears the shadow root. Call this from a framework wrapper's own unmount
     * path when discarding `host` for good; re-`mount()`ing the SAME host again already self-cleans its
     * own prior listeners, so this is only needed when `host` itself won't be reused.
     */
    unmount(host: HTMLElement): void;
    renderPreview(rendered: RenderedNode): HTMLElement;
    createZoomController(host: HTMLElement, options?: ZoomOptions): ZoomController;
    attachInteractions(result: PaginatedResult, host: HTMLElement, options?: AttachInteractionsOptions): InteractionController;
    buildHitRegistry(result: PaginatedResult): HitRegistry;
    hitTest(registry: HitRegistry, pageNumber: number, x: number, y: number): InteractionTarget | null;
    hitTestDroppable(registry: HitRegistry, pageNumber: number, x: number, y: number, dragTypes?: string[]): InteractionTarget | null;
    findById(registry: HitRegistry, id: string): InteractionTarget[];
    findFragments(registry: HitRegistry, target: InteractionTarget): InteractionTarget[];
    toTypeList(value: string | string[] | undefined): string[];
    generatePdf(result: PaginatedResult, metadata?: PdfMetadata): Promise<Uint8Array>;
    generateDocx(doc: PageDef, metadata?: DocxMetadata): Promise<Uint8Array>;
    generateXlsx(doc: PageDef, metadata?: XlsxMetadata): Promise<Uint8Array>;
}
