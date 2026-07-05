// Shared canvas-based single-line text width measurement, used by both renderers (pdf-render.ts and
// shadow-dom.ts) for watermark text sizing/centering/tiling — one source of truth so preview and PDF
// watermark placement agree exactly, rather than drifting between two independently-approximated
// width heuristics (unlike chart-render.ts's estimateTextWidth, which has no DOM/canvas available at
// that layer by design).

let widthCanvasCtx: OffscreenCanvasRenderingContext2D | null = null

export function measureTextWidthPx(text: string, fontCss: string): number {
  if (widthCanvasCtx === null) {
    const ctx2d = new OffscreenCanvas(1, 1).getContext('2d')
    if (ctx2d === null) throw new Error('[paginator] could not acquire a 2D context for text measurement.')
    widthCanvasCtx = ctx2d
  }
  widthCanvasCtx.font = fontCss
  return widthCanvasCtx.measureText(text).width
}
