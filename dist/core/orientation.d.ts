export type Orientation = 'horizontal' | 'horizontal-reversed' | 'vertical' | 'vertical-reversed';
export declare const VALID_ORIENTATIONS: readonly Orientation[];
/** `vertical`/`vertical-reversed` — the only orientations whose box swaps width/height between its
 *  natural (pre-rotation) and final (on-page) size. */
export declare function isSideways(orientation: Orientation | undefined): boolean;
/** Sideways orientations are atomic — a line-cursor split can't run across a rotated axis. Every
 *  other orientation (unset/`'horizontal'`/`'horizontal-reversed'`) keeps ordinary top-to-bottom
 *  line flow, so splitting across a page break works exactly like unrotated content; upside-down
 *  content is simply flipped in place per already-paginated fragment, with no effect on how or
 *  where the split happens. */
export declare function isSplittableOrientation(orientation: Orientation | undefined): boolean;
export declare function orientationAngle(orientation: Orientation | undefined): 0 | 90 | -90 | 180;
export declare function validateOrientation(orientation: Orientation | undefined, caller: string): void;
/** Swaps natural (pre-rotation) width/height into the final on-page box — only sideways
 *  orientations swap; `horizontal-reversed` keeps the same box, just flipped in place. */
export declare function orientedBoxSize(orientation: Orientation | undefined, naturalWidth: number, naturalHeight: number): {
    width: number;
    height: number;
};
/** Inverse of orientedBoxSize() — recovers the natural (pre-rotation) content size a renderer
 *  should draw its "unrotated" content at, given the final on-page box. */
export declare function naturalContentSize(orientation: Orientation | undefined, finalWidth: number, finalHeight: number): {
    width: number;
    height: number;
};
/**
 * CSS transform for a DOM wrapper div containing the unrotated content, sized
 * naturalWidth x naturalHeight. `transform-origin: top left` pins the pivot to the block's own
 * corner, and the paired translate() cancels the offset that rotating around that pivot would
 * otherwise introduce, so the rotated result's bounding box lands flush at (0, 0) of the outer
 * (already-oriented-size) wrapper — the standard "rotate into a swapped bounding box" CSS
 * technique. Returns undefined for the default orientation (no wrapper needed).
 */
export declare function cssOrientationTransform(orientation: Orientation | undefined, naturalWidth: number, naturalHeight: number): {
    transform: string;
    transformOrigin: string;
} | undefined;
/**
 * SVG `transform` attribute for a <g> wrapper, given the FINAL on-page box size. SVG composes
 * translate/rotate in the opposite order CSS does (the rightmost function applies to the point
 * first, i.e. translate happens in the PRE-rotation frame), so this can't share
 * cssOrientationTransform()'s string shape even though it's the same underlying angle. Returns
 * undefined for the default orientation.
 */
export declare function svgOrientationTransform(orientation: Orientation | undefined, finalBoxWidth: number, finalBoxHeight: number): string | undefined;
/**
 * pdfkit translate+rotate recipe establishing the local drawing frame for oriented content — call
 * inside a doc.save()/doc.restore() pair, then draw the unrotated content at local (0, 0) sized via
 * naturalContentSize(). Coordinates in pt. Still translates to (xPt, yPt) for the default
 * orientation so callers can draw at local (0, 0) unconditionally in every case.
 */
export declare function applyPdfOrientationTransform(doc: PDFKit.PDFDocument, orientation: Orientation | undefined, xPt: number, yPt: number, finalWidthPt: number, finalHeightPt: number): void;
/**
 * Canvas 2D equivalent of applyPdfOrientationTransform(), for DOCX rasterization — same
 * translate+rotate convention, operating in already-scaled canvas px. A raster canvas is always
 * sized to exactly one node, so unlike the PDF/DOM cases there's no separate x/y page offset to
 * fold in — the canvas's own (0, 0) already is the box's top-left corner.
 */
export declare function applyCanvasOrientationTransform(ctx: OffscreenCanvasRenderingContext2D, orientation: Orientation | undefined, scaledFinalWidth: number, scaledFinalHeight: number): void;
