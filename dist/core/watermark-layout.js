// Pure page-absolute positioning math for watermarks, shared by both renderers (pdf-render.ts /
// shadow-dom.ts) exactly like table-layout.ts's resolveColumnWidths is — each renderer computes the
// watermark's own footprint size its own way (canvas-measured text width in PDF, explicit
// width/height for an image) and hands it here, keeping this module engine-agnostic.
const DEFAULT_TILE_GAP = 60;
export function resolveWatermarkInstances(watermark, pageWidth, pageHeight, footprintWidth, footprintHeight) {
    if (watermark.tile !== true) {
        return [{ x: pageWidth / 2, y: pageHeight / 2 }];
    }
    const stepX = footprintWidth + (watermark.tileGapX ?? DEFAULT_TILE_GAP);
    const stepY = footprintHeight + (watermark.tileGapY ?? DEFAULT_TILE_GAP);
    const instances = [];
    for (let y = -stepY; y <= pageHeight + stepY; y += stepY) {
        for (let x = -stepX; x <= pageWidth + stepX; x += stepX) {
            instances.push({ x, y });
        }
    }
    return instances;
}
