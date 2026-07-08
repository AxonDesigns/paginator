import type { PageSize } from './nodes.js';
export declare const PAGE_SIZE_PRESETS: {
    readonly A4: {
        readonly width: 794;
        readonly height: 1123;
    };
    readonly Letter: {
        readonly width: 816;
        readonly height: 1056;
    };
};
export declare function resolvePageSize(size: PageSize): {
    width: number;
    height: number;
};
