import type { PageDef } from '../core/nodes.js';
export type DocxMetadata = {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
};
export declare function generateDocx(doc: PageDef, metadata?: DocxMetadata): Promise<Uint8Array>;
