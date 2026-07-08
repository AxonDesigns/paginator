import type { PageDef } from './core/nodes.js';
import { type PaginatedResult } from './core/paginate.js';
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
    renderPreview(rendered: RenderedNode): HTMLElement;
    printDocument(host: HTMLElement): void;
    attachInteractions(result: PaginatedResult, host: HTMLElement, options?: AttachInteractionsOptions): InteractionController;
    buildHitRegistry(result: PaginatedResult): HitRegistry;
    hitTest(registry: HitRegistry, pageNumber: number, x: number, y: number): InteractionTarget | null;
    hitTestDroppable(registry: HitRegistry, pageNumber: number, x: number, y: number, dragTypes?: string[]): InteractionTarget | null;
    toTypeList(value: string | string[] | undefined): string[];
    generatePdf(result: PaginatedResult, metadata?: PdfMetadata): Promise<Uint8Array>;
    generateDocx(doc: PageDef, metadata?: DocxMetadata): Promise<Uint8Array>;
    generateXlsx(doc: PageDef, metadata?: XlsxMetadata): Promise<Uint8Array>;
    openPdfInNewTab(bytes: Uint8Array): void;
    showPdfDialog(bytes: Uint8Array, options?: {
        title?: string;
    }): {
        close(): void;
    };
}
