import type { PageDef } from '../core/nodes.js';
export type XlsxMetadata = {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
};
export declare function generateXlsx(doc: PageDef, metadata?: XlsxMetadata): Promise<Uint8Array>;
