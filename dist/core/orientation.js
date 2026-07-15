// Shared rotation/orientation math for TextNode, RichTextNode, and BarcodeNode — the three node
// types that can lay their content out sideways or upside-down. Centralizes what used to be three
// independently hand-rolled translate+rotate implementations (text's DOM+PDF, barcode's
// SVG+PDF+DOCX-canvas) into one set of geometry rules, reused by every renderer.
export const VALID_ORIENTATIONS = ['horizontal', 'horizontal-reversed', 'vertical', 'vertical-reversed'];
/** `vertical`/`vertical-reversed` — the only orientations whose box swaps width/height between its
 *  natural (pre-rotation) and final (on-page) size. */
export function isSideways(orientation) {
    return orientation === 'vertical' || orientation === 'vertical-reversed';
}
/** Sideways orientations are atomic — a line-cursor split can't run across a rotated axis. Every
 *  other orientation (unset/`'horizontal'`/`'horizontal-reversed'`) keeps ordinary top-to-bottom
 *  line flow, so splitting across a page break works exactly like unrotated content; upside-down
 *  content is simply flipped in place per already-paginated fragment, with no effect on how or
 *  where the split happens. */
export function isSplittableOrientation(orientation) {
    return !isSideways(orientation);
}
export function orientationAngle(orientation) {
    switch (orientation) {
        case 'vertical':
            return 90;
        case 'vertical-reversed':
            return -90;
        case 'horizontal-reversed':
            return 180;
        default:
            return 0;
    }
}
export function validateOrientation(orientation, caller) {
    if (orientation !== undefined && !VALID_ORIENTATIONS.includes(orientation)) {
        throw new Error(`[paginator] ${caller}() "orientation" must be one of ${VALID_ORIENTATIONS.join(', ')}, got "${orientation}".`);
    }
}
/** Swaps natural (pre-rotation) width/height into the final on-page box — only sideways
 *  orientations swap; `horizontal-reversed` keeps the same box, just flipped in place. */
export function orientedBoxSize(orientation, naturalWidth, naturalHeight) {
    return isSideways(orientation) ? { width: naturalHeight, height: naturalWidth } : { width: naturalWidth, height: naturalHeight };
}
/** Inverse of orientedBoxSize() — recovers the natural (pre-rotation) content size a renderer
 *  should draw its "unrotated" content at, given the final on-page box. */
export function naturalContentSize(orientation, finalWidth, finalHeight) {
    return isSideways(orientation) ? { width: finalHeight, height: finalWidth } : { width: finalWidth, height: finalHeight };
}
/**
 * CSS transform for a DOM wrapper div containing the unrotated content, sized
 * naturalWidth x naturalHeight. `transform-origin: top left` pins the pivot to the block's own
 * corner, and the paired translate() cancels the offset that rotating around that pivot would
 * otherwise introduce, so the rotated result's bounding box lands flush at (0, 0) of the outer
 * (already-oriented-size) wrapper — the standard "rotate into a swapped bounding box" CSS
 * technique. Returns undefined for the default orientation (no wrapper needed).
 */
export function cssOrientationTransform(orientation, naturalWidth, naturalHeight) {
    const angle = orientationAngle(orientation);
    if (angle === 0)
        return undefined;
    const translate = angle === 90 ? `0px, -${naturalHeight}px` : angle === -90 ? `-${naturalWidth}px, 0px` : `-${naturalWidth}px, -${naturalHeight}px`;
    return { transformOrigin: 'top left', transform: `rotate(${angle}deg) translate(${translate})` };
}
/**
 * SVG `transform` attribute for a <g> wrapper, given the FINAL on-page box size. SVG composes
 * translate/rotate in the opposite order CSS does (the rightmost function applies to the point
 * first, i.e. translate happens in the PRE-rotation frame), so this can't share
 * cssOrientationTransform()'s string shape even though it's the same underlying angle. Returns
 * undefined for the default orientation.
 */
export function svgOrientationTransform(orientation, finalBoxWidth, finalBoxHeight) {
    const angle = orientationAngle(orientation);
    if (angle === 0)
        return undefined;
    if (angle === 90)
        return `translate(${finalBoxWidth} 0) rotate(90)`;
    if (angle === -90)
        return `translate(0 ${finalBoxHeight}) rotate(-90)`;
    return `translate(${finalBoxWidth} ${finalBoxHeight}) rotate(180)`;
}
/**
 * pdfkit translate+rotate recipe establishing the local drawing frame for oriented content — call
 * inside a doc.save()/doc.restore() pair, then draw the unrotated content at local (0, 0) sized via
 * naturalContentSize(). Coordinates in pt. Still translates to (xPt, yPt) for the default
 * orientation so callers can draw at local (0, 0) unconditionally in every case.
 */
export function applyPdfOrientationTransform(doc, orientation, xPt, yPt, finalWidthPt, finalHeightPt) {
    switch (orientation) {
        case 'vertical':
            doc.translate(xPt + finalWidthPt, yPt);
            doc.rotate(90);
            break;
        case 'vertical-reversed':
            doc.translate(xPt, yPt + finalHeightPt);
            doc.rotate(-90);
            break;
        case 'horizontal-reversed':
            doc.translate(xPt + finalWidthPt, yPt + finalHeightPt);
            doc.rotate(180);
            break;
        default:
            doc.translate(xPt, yPt);
    }
}
/**
 * Canvas 2D equivalent of applyPdfOrientationTransform(), for DOCX rasterization — same
 * translate+rotate convention, operating in already-scaled canvas px. A raster canvas is always
 * sized to exactly one node, so unlike the PDF/DOM cases there's no separate x/y page offset to
 * fold in — the canvas's own (0, 0) already is the box's top-left corner.
 */
export function applyCanvasOrientationTransform(ctx, orientation, scaledFinalWidth, scaledFinalHeight) {
    switch (orientation) {
        case 'vertical':
            ctx.translate(scaledFinalWidth, 0);
            ctx.rotate(Math.PI / 2);
            break;
        case 'vertical-reversed':
            ctx.translate(0, scaledFinalHeight);
            ctx.rotate(-Math.PI / 2);
            break;
        case 'horizontal-reversed':
            ctx.translate(scaledFinalWidth, scaledFinalHeight);
            ctx.rotate(Math.PI);
            break;
        default:
            break;
    }
}
