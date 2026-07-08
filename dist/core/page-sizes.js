// CSS px @ 96dpi.
export const PAGE_SIZE_PRESETS = {
    A4: { width: 794, height: 1123 }, // 210mm x 297mm
    Letter: { width: 816, height: 1056 }, // 8.5in x 11in
};
export function resolvePageSize(size) {
    if (typeof size === 'string')
        return PAGE_SIZE_PRESETS[size];
    return size;
}
