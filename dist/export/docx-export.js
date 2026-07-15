// Word export: builds a real, reflowable Word document from the pre-pagination PageDef.body
// semantic tree (NOT from PaginatedResult/RenderedNode's pixel boxes) — Word paginates its own
// content, so this walks the same Node tree paginate()/generatePdf() start from, translating each
// node type into `docx` library primitives instead of pixel positions.
//
// v1 scope: text/richText/separator/page-break/image/group/container/table/chart/qrcode/barcode
// are supported. svg is out of scope (skipped with a one-time warning) — rasterizing raw SVG
// markup to an embedded image is the natural next extension (see warnUnsupportedNodeOnce below);
// chart already gets this treatment (see rasterizeChart/chartNodeParagraph) by reusing
// chart-render.ts's existing DOM/SVG chart renderer, needing no chart-specific drawing code of its
// own. qrcode/barcode (see rasterizeQrcode/rasterizeBarcode) draw straight to an OffscreenCanvas
// instead — simpler than chart's SVG round trip, since their content is just filled rects.
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, ImageRun, LineRuleType, PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table as DocxTable, TableCell as DocxTableCell, TableRow as DocxTableRow, TextRun, VerticalAlignTable, WidthType, } from 'docx';
import { resolvePageSize } from "../core/page-sizes.js";
import { resolveFlexWidths } from "../core/flex-widths.js";
import { renderChartSvg } from "../render/chart-render.js";
import { buildQrMatrix, qrcodeRunsForRow } from "../render/qrcode-encode.js";
import { encodeBarcodeValue } from "../render/barcode-encode.js";
import { applyCanvasOrientationTransform, orientedBoxSize } from "../core/orientation.js";
import { borderSides } from "./table-grid.js";
import { resolveExportColor } from "./export-color.js";
import { pxToTwip } from "./units.js";
const PLACEHOLDER_CTX = { pageNumber: 1, totalPages: 1 };
const PAGE_NUMBER_SENTINEL = '{{pageNumber}}';
const TOTAL_PAGES_SENTINEL = '{{totalPages}}';
const warnedNodeTypes = new Set();
function warnUnsupportedNodeOnce(type) {
    if (warnedNodeTypes.has(type))
        return;
    warnedNodeTypes.add(type);
    console.warn(`[paginator] generateDocx(): "${type}" nodes aren't supported yet — skipping. (rasterizing raw SVG markup to an image, like chart already does, is the natural next step.)`);
}
let warnedChartUnsupported = false;
function warnChartUnsupportedOnce() {
    if (warnedChartUnsupported)
        return;
    warnedChartUnsupported = true;
    console.warn('[paginator] generateDocx(): chart rendering needs a browser (DOM + OffscreenCanvas) to rasterize — skipping in this environment.');
}
let warnedQrcodeUnsupported = false;
function warnQrcodeUnsupportedOnce() {
    if (warnedQrcodeUnsupported)
        return;
    warnedQrcodeUnsupported = true;
    console.warn('[paginator] generateDocx(): qrcode rendering needs a browser (OffscreenCanvas) to rasterize — skipping in this environment.');
}
let warnedBarcodeUnsupported = false;
function warnBarcodeUnsupportedOnce() {
    if (warnedBarcodeUnsupported)
        return;
    warnedBarcodeUnsupported = true;
    console.warn('[paginator] generateDocx(): barcode rendering needs a browser (OffscreenCanvas) to rasterize — skipping in this environment.');
}
let warnedShrinkUnsupported = false;
function warnShrinkUnsupportedOnce() {
    if (warnedShrinkUnsupported)
        return;
    warnedShrinkUnsupported = true;
    console.warn('[paginator] generateDocx(): \'shrink\' sizing (a row child\'s flex or a TableColumn\'s width) needs the DOM/pretext measurement this exporter deliberately avoids pulling in — falling back to an equal flex-grow weight.');
}
let warnedPageBackground = false;
function warnPageBackgroundOnce() {
    if (warnedPageBackground)
        return;
    warnedPageBackground = true;
    console.warn('[paginator] generateDocx(): page background has no clean Word equivalent — skipping. (Page border is deliberately not applied either — see the module header comment.)');
}
let warnedTableBorderRadius = false;
function warnTableBorderRadiusOnce() {
    if (warnedTableBorderRadius)
        return;
    warnedTableBorderRadius = true;
    console.warn('[paginator] generateDocx(): table border.outer.borderRadius has no Word equivalent — drawing square corners.');
}
let warnedTableHeaderSeparator = false;
function warnTableHeaderSeparatorOnce() {
    if (warnedTableHeaderSeparator)
        return;
    warnedTableHeaderSeparator = true;
    console.warn('[paginator] generateDocx(): table border.headerSeparator has no Word equivalent — skipping (the ordinary inner/outer grid still draws at that boundary).');
}
let warnedTableRowBorder = false;
function warnTableRowBorderOnce() {
    if (warnedTableRowBorder)
        return;
    warnedTableRowBorder = true;
    console.warn('[paginator] generateDocx(): a table row\'s topBorder/bottomBorder (e.g. TableGroupLevel.headerBorder/totalsBorder) has no Word equivalent — skipping (the ordinary inner/outer grid still draws at that boundary).');
}
// Disabled alongside the watermark call in generateDocx() — see there.
// let warnedWatermarkUnsupported = false
// function warnWatermarkUnsupportedOnce(): void {
//   if (warnedWatermarkUnsupported) return
//   warnedWatermarkUnsupported = true
//   console.warn('[paginator] generateDocx(): watermark rendering needs a browser (OffscreenCanvas) to rasterize — skipping in this environment.')
// }
let warnedMarginContentUnsupported = false;
function warnMarginContentUnsupportedOnce() {
    if (warnedMarginContentUnsupported)
        return;
    warnedMarginContentUnsupported = true;
    console.warn('[paginator] generateDocx(): PageDef.marginContent has no Word equivalent (Word has no free-positioned page-overlay concept) — skipping.');
}
// --- Small local helpers, deliberately NOT imported from src/nodes/*.ts or src/render/*.ts: those
// modules self-register into behavior.ts at import time and (for separator/group specifically) pull
// in pdf-render.ts, which loads pdfkit's browser-standalone bundle at module scope — exactly the
// bloat/DOM-coupling this exporter avoids. These are trivial, pure re-derivations of the same math. ---
function separatorMainSize(node) {
    return (node.thickness ?? 1) + 2 * (node.margin ?? 0);
}
function rowChildSizing(node) {
    if (node.type === 'separator')
        return { kind: 'fixed', size: separatorMainSize(node) };
    if (node.type === 'page-break')
        return { kind: 'fixed', size: 0 };
    const flex = 'flex' in node ? node.flex : undefined;
    if (flex === 'shrink') {
        warnShrinkUnsupportedOnce();
        return { kind: 'flex', weight: 1 };
    }
    if (flex === undefined && 'width' in node && node.width !== undefined)
        return { kind: 'fixed', size: node.width };
    if (typeof flex === 'string')
        return { kind: 'fixed', size: Number.parseFloat(flex) };
    return { kind: 'flex', weight: flex ?? 1 };
}
function fontNameFrom(fontFamily) {
    return fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
}
function isBold(fontWeight) {
    return fontWeight !== undefined && (fontWeight === 'bold' || Number(fontWeight) >= 600);
}
function pxToHalfPoint(px) {
    return Math.round(px * 1.5); // px -> pt (*0.75) -> half-points (*2)
}
function textAlignment(align) {
    return align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
}
/** Splits `text` on the `{{pageNumber}}`/`{{totalPages}}` sentinels (header/footer content only —
 *  see the module header comment) into a run's `children` array, substituting docx's own live
 *  `PageNumber.CURRENT`/`PageNumber.TOTAL_PAGES` fields — since Word paginates the body itself, a
 *  literal page number baked in at export time would be wrong past page 1. Plain text with no
 *  sentinel just becomes a single-string array (equivalent to `text:`). */
function runChildren(text, allowPageNumberSentinels) {
    if (!allowPageNumberSentinels || (!text.includes(PAGE_NUMBER_SENTINEL) && !text.includes(TOTAL_PAGES_SENTINEL)))
        return undefined;
    const parts = text.split(new RegExp(`(${PAGE_NUMBER_SENTINEL}|${TOTAL_PAGES_SENTINEL})`)).filter(p => p.length > 0);
    return parts.map(part => (part === PAGE_NUMBER_SENTINEL ? PageNumber.CURRENT : part === TOTAL_PAGES_SENTINEL ? PageNumber.TOTAL_PAGES : part));
}
function textRun(text, style, allowPageNumberSentinels = false) {
    const children = runChildren(text, allowPageNumberSentinels);
    return new TextRun({
        ...(children !== undefined ? { children } : { text }),
        bold: isBold(style.fontWeight),
        italics: style.fontStyle === 'italic',
        color: style.color !== undefined ? resolveExportColor(style.color) : undefined,
        size: pxToHalfPoint(style.fontSize),
        font: fontNameFrom(style.fontFamily),
        underline: style.textDecoration === 'underline' ? {} : undefined,
        strike: style.textDecoration === 'line-through',
    });
}
// `node.orientation` is intentionally ignored here — DOCX has no native way to rotate a paragraph's
// text, and honoring it would mean rasterizing to a PNG the way barcode's DOCX export does, which
// would lose this text's selectability/searchability in the exported document. Text is always
// exported horizontal/upright regardless of orientation (same for richTextNodeParagraph below).
function textNodeParagraph(node, allowPageNumberSentinels = false) {
    return new Paragraph({ alignment: textAlignment(node.align), children: [textRun(node.content, node, allowPageNumberSentinels)] });
}
function richTextRunStyle(paragraph, run) {
    return {
        fontFamily: run.fontFamily ?? paragraph.fontFamily,
        fontSize: run.fontSize ?? paragraph.fontSize,
        fontWeight: run.fontWeight ?? paragraph.fontWeight,
        fontStyle: run.fontStyle ?? paragraph.fontStyle,
        color: run.color ?? paragraph.color,
        textDecoration: run.textDecoration ?? paragraph.textDecoration,
    };
}
// `node.orientation` is intentionally ignored here too — see textNodeParagraph's comment above.
function richTextNodeParagraph(node, allowPageNumberSentinels = false) {
    const children = node.runs.map(run => {
        const run_ = textRun(run.text, richTextRunStyle(node, run), allowPageNumberSentinels);
        return run.href !== undefined ? new ExternalHyperlink({ children: [run_], link: run.href }) : run_;
    });
    return new Paragraph({ alignment: textAlignment(node.align), children });
}
function separatorParagraph(node) {
    const size = Math.max(2, Math.round((node.thickness ?? 1) * 6)); // px -> pt(*0.75) -> eighths-of-a-point(*8) = *6
    const margin = node.margin ?? 0;
    return new Paragraph({
        // Pin this paragraph's own line to just its thickness, same trick as spacerParagraph — an empty
        // paragraph otherwise still takes a full default text-line height (from its paragraph mark's own
        // run size) on top of whatever margin/gap surrounds it, reading as an extra blank line next to
        // what should just be a thin rule.
        spacing: { before: pxToTwip(margin), after: pxToTwip(margin), line: pxToTwip(Math.max(node.thickness ?? 1, 1)), lineRule: LineRuleType.EXACT },
        border: { bottom: { style: docxBorderStyle(node.style), size, color: resolveExportColor(node.color ?? '#000000') } },
    });
}
function imageTypeFromMime(mime) {
    switch (mime) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/gif':
            return 'gif';
        case 'image/bmp':
            return 'bmp';
        default:
            return undefined;
    }
}
function imageTypeFromExtension(src) {
    const match = /\.(jpe?g|png|gif|bmp)(?:[?#]|$)/i.exec(src);
    if (match === null)
        return undefined;
    const ext = match[1].toLowerCase();
    return ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext;
}
let warnedSvgImage = false;
async function fetchImageData(src) {
    const dataUriMime = /^data:([^;,]+)/.exec(src)?.[1];
    if (dataUriMime === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(src)) {
        if (!warnedSvgImage) {
            warnedSvgImage = true;
            console.warn('[paginator] generateDocx(): an image() node with SVG content isn\'t supported yet — skipping.');
        }
        return null;
    }
    const response = await fetch(src);
    const data = new Uint8Array(await response.arrayBuffer());
    const type = imageTypeFromMime(response.headers.get('content-type')) ?? imageTypeFromMime(dataUriMime) ?? imageTypeFromExtension(src) ?? 'png';
    return { data, type };
}
// Explicit "no line" rather than just omitting `outline` entirely — some renderers (LibreOffice in
// particular) apply their own default hairline/gray border to a picture whenever the XML doesn't
// explicitly say there's no outline, the same way a table needs an explicit `NONE_BORDER` rather
// than an absent one. This is different from a real, visible border (already explicitly ruled out
// via `NONE_BORDER` on tables/cells elsewhere in this file) — it forces the ambiguous "unset" case
// to resolve to "no line" instead of a renderer's own default.
const NO_IMAGE_OUTLINE = { type: 'noFill' };
// Shared by image() and chart() — both have the identical width/height/aspectRatio box-sizing
// contract (see ImageNode/ChartCommon in nodes.ts): at least one of {width & height}, {width &
// aspectRatio}, {height & aspectRatio}, or {aspectRatio alone}, falling back to the full available
// width when only a height (or nothing) is given.
function resolveBoxSize(width, height, aspectRatio, availableWidthPx) {
    const ratio = aspectRatio ?? (width !== undefined && height !== undefined ? width / height : undefined);
    const resolvedWidth = width ?? (height !== undefined && ratio !== undefined ? height * ratio : availableWidthPx);
    const resolvedHeight = height ?? (ratio !== undefined ? resolvedWidth / ratio : resolvedWidth);
    return { width: resolvedWidth, height: resolvedHeight };
}
async function imageNodeParagraph(node, availableWidthPx) {
    const { width, height } = resolveBoxSize(node.width, node.height, node.aspectRatio, availableWidthPx);
    const image = await fetchImageData(node.src);
    if (image === null)
        return new Paragraph({});
    return new Paragraph({
        children: [new ImageRun({ type: image.type, data: image.data, transformation: { width: Math.round(width), height: Math.round(height) }, outline: NO_IMAGE_OUTLINE })],
    });
}
// Chart rendering reuses chart-render.ts's existing DOM/SVG renderer (renderChartSvg) — the same
// code the on-screen preview already draws with — needing no chart-specific drawing logic of its
// own: serialize the returned <svg> to a string, rasterize it via canvas into a PNG, then embed it
// exactly like a regular image() node. Rasterized at CHART_RASTER_SCALE× the logical display size
// for crisper output (the embedded PNG has more source pixels than the docx `transformation` box it's
// displayed at, the same "export at 2x" convention any raster image tool uses for print-quality
// output) — `transformation` still uses the LOGICAL (1×) size, so it displays at the correct
// physical dimensions. Needs a real DOM (`document.createElementNS`, used inside renderChartSvg) in
// addition to OffscreenCanvas — unavailable under `bun test` — so this degrades the same way the
// (currently disabled) watermark rasterization does: warn once, skip, but work in a real browser.
const CHART_RASTER_SCALE = 2;
// createImageBitmap() on an SVG Blob is unreliable across browsers/headless Chromium builds (fails
// with "the source image could not be decoded" even for trivially valid SVG) — loading through a
// plain <img> with a data: URI first, THEN drawing that onto the canvas, is the broadly-supported
// path for rasterizing SVG and is what this uses instead.
function loadSvgImage(svgString) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('[paginator] generateDocx(): failed to rasterize a chart\'s SVG markup for embedding.'));
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
    });
}
async function rasterizeChart(node, widthPx, heightPx) {
    if (typeof document === 'undefined' || typeof OffscreenCanvas === 'undefined') {
        warnChartUnsupportedOnce();
        return null;
    }
    const svg = renderChartSvg(node, widthPx, heightPx);
    const svgString = new XMLSerializer().serializeToString(svg);
    const img = await loadSvgImage(svgString);
    const scaledWidth = Math.max(1, Math.round(widthPx * CHART_RASTER_SCALE));
    const scaledHeight = Math.max(1, Math.round(heightPx * CHART_RASTER_SCALE));
    const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: new Uint8Array(await blob.arrayBuffer()), widthPx, heightPx };
}
async function chartNodeParagraph(node, availableWidthPx) {
    const { width, height } = resolveBoxSize(node.width, node.height, node.aspectRatio, availableWidthPx);
    const rasterized = await rasterizeChart(node, Math.round(width), Math.round(height));
    if (rasterized === null)
        return new Paragraph({});
    return new Paragraph({
        children: [new ImageRun({ type: 'png', data: rasterized.data, transformation: { width: rasterized.widthPx, height: rasterized.heightPx }, outline: NO_IMAGE_OUTLINE })],
    });
}
// qrcode/barcode rasterization draws straight to an OffscreenCanvas (fillRect per module/bar run)
// — unlike rasterizeChart, there's no SVG/<img>/data-URI round trip needed first (nothing here
// goes through real SVG DOM at all), so the guard only needs OffscreenCanvas, not `document` too.
async function rasterizeQrcode(node, widthPx, heightPx) {
    if (typeof OffscreenCanvas === 'undefined') {
        warnQrcodeUnsupportedOnce();
        return null;
    }
    const matrix = buildQrMatrix(node.value, node.errorCorrectionLevel ?? 'M');
    const quietZone = node.quietZone ?? 4;
    const side = matrix.moduleCount + quietZone * 2;
    const scaledWidth = Math.max(1, Math.round(widthPx * CHART_RASTER_SCALE));
    const scaledHeight = Math.max(1, Math.round(heightPx * CHART_RASTER_SCALE));
    const moduleWidth = scaledWidth / side;
    const moduleHeight = scaledHeight / side;
    const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = node.backgroundColor ?? '#ffffff';
    ctx.fillRect(0, 0, scaledWidth, scaledHeight);
    ctx.fillStyle = node.moduleColor ?? '#000000';
    for (let row = 0; row < matrix.moduleCount; row++) {
        for (const run of qrcodeRunsForRow(matrix, row)) {
            ctx.fillRect((quietZone + run.startCol) * moduleWidth, (quietZone + row) * moduleHeight, run.length * moduleWidth, moduleHeight);
        }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: new Uint8Array(await blob.arrayBuffer()), widthPx, heightPx };
}
async function qrcodeNodeParagraph(node, availableWidthPx) {
    const { width, height } = resolveBoxSize(node.width, node.height, node.aspectRatio, availableWidthPx);
    const rasterized = await rasterizeQrcode(node, Math.round(width), Math.round(height));
    if (rasterized === null)
        return new Paragraph({});
    return new Paragraph({
        children: [new ImageRun({ type: 'png', data: rasterized.data, transformation: { width: rasterized.widthPx, height: rasterized.heightPx }, outline: NO_IMAGE_OUTLINE })],
    });
}
// Same bar-geometry rule as src/nodes/barcode.ts's own barGeometry() (fixed px quiet zone, bars
// scale to fill the rest, text line reserves a fixed band) — kept as its own small copy here
// rather than imported, since importing from src/nodes/ would pull registerNode() wiring this
// export-only module has no use for (see that file's own header comment for the rationale).
// Same natural (left-to-right) drawing src/nodes/barcode.ts's own drawBarcodeContentPdf uses,
// ported to a canvas 2D context — `scale` is CHART_RASTER_SCALE, applied by hand to every
// coordinate (matching this file's existing raster convention) rather than via ctx.scale(), so it
// composes cleanly with the ctx.translate()/ctx.rotate() rotation wrapper in rasterizeBarcode below
// (itself already working in the SAME scaled canvas-pixel space).
function drawBarcodeContentCanvas(ctx, node, pattern, contentWidth, contentHeight, scale) {
    const quietZone = node.quietZone ?? 10;
    const showText = node.showText ?? true;
    const textSize = node.textSize ?? 10;
    const textBand = showText ? textSize * 1.4 + 4 : 0;
    const barHeight = node.barHeight ?? Math.max(0, contentHeight - textBand);
    const usableWidth = Math.max(0, contentWidth - quietZone * 2);
    const moduleWidth = pattern.totalModules > 0 ? usableWidth / pattern.totalModules : 0;
    ctx.fillStyle = node.backgroundColor ?? '#ffffff';
    ctx.fillRect(0, 0, contentWidth * scale, contentHeight * scale);
    ctx.fillStyle = node.barColor ?? '#000000';
    let cursor = quietZone;
    pattern.runs.forEach((runLength, i) => {
        const runWidth = runLength * moduleWidth;
        if (i % 2 === 0)
            ctx.fillRect(cursor * scale, 0, runWidth * scale, barHeight * scale);
        cursor += runWidth;
    });
    if (showText) {
        ctx.fillStyle = node.textColor ?? node.barColor ?? '#000000';
        ctx.font = `${textSize * scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(pattern.text, (contentWidth / 2) * scale, (barHeight + textSize) * scale);
    }
}
// `naturalWidthPx`/`naturalHeightPx` are the bar-length/bar-thickness axes (see BarcodeNode's field
// docs) — always pre-rotation, regardless of `node.orientation`; orientedBoxSize() below derives the
// actual (post-rotation) canvas size to rasterize at.
async function rasterizeBarcode(node, naturalWidthPx, naturalHeightPx) {
    if (typeof OffscreenCanvas === 'undefined') {
        warnBarcodeUnsupportedOnce();
        return null;
    }
    const pattern = encodeBarcodeValue(node.symbology ?? 'code128', node.value, node.checkDigit);
    const { width: finalWidthPx, height: finalHeightPx } = orientedBoxSize(node.orientation, naturalWidthPx, naturalHeightPx);
    const scaledFinalWidth = Math.max(1, Math.round(finalWidthPx * CHART_RASTER_SCALE));
    const scaledFinalHeight = Math.max(1, Math.round(finalHeightPx * CHART_RASTER_SCALE));
    const canvas = new OffscreenCanvas(scaledFinalWidth, scaledFinalHeight);
    const ctx = canvas.getContext('2d');
    // Same translate+rotate derivation as src/nodes/barcode.ts's SVG/pdfkit paths, via the shared
    // applyCanvasOrientationTransform() helper — canvas 2D's translate()/rotate() use the SAME
    // clockwise-for-positive-angle convention as SVG's rotate().
    applyCanvasOrientationTransform(ctx, node.orientation, scaledFinalWidth, scaledFinalHeight);
    drawBarcodeContentCanvas(ctx, node, pattern, naturalWidthPx, naturalHeightPx, CHART_RASTER_SCALE);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: new Uint8Array(await blob.arrayBuffer()), widthPx: finalWidthPx, heightPx: finalHeightPx };
}
async function barcodeNodeParagraph(node, availableWidthPx) {
    // barcode()'s builder always resolves both width/height (in NATURAL, pre-rotation terms) before
    // construction, so resolveBoxSize()'s availableWidthPx fallback is unreachable here in practice —
    // kept for consistency with the image()/qrcode() call sites, which do rely on it.
    const natural = resolveBoxSize(node.width, node.height, node.aspectRatio, availableWidthPx);
    const rasterized = await rasterizeBarcode(node, Math.round(natural.width), Math.round(natural.height));
    if (rasterized === null)
        return new Paragraph({});
    return new Paragraph({
        children: [new ImageRun({ type: 'png', data: rasterized.data, transformation: { width: rasterized.widthPx, height: rasterized.heightPx }, outline: NO_IMAGE_OUTLINE })],
    });
}
// --- Border/shading helpers shared by the table(), row-as-table, and container-as-table paths ---
const NONE_BORDER = { style: BorderStyle.NONE };
const NO_CELL_BORDERS = { top: NONE_BORDER, bottom: NONE_BORDER, left: NONE_BORDER, right: NONE_BORDER };
function docxBorderStyle(style) {
    return style === 'dashed' ? BorderStyle.DASHED : style === 'dotted' ? BorderStyle.DOTTED : BorderStyle.SINGLE;
}
function borderOption(thicknessPx, color, style = BorderStyle.SINGLE) {
    return { style, size: Math.min(96, Math.max(2, Math.round(thicknessPx * 6))), color: resolveExportColor(color) };
}
// `sides` now says WHICH style applies per edge (inner vs outer vs none), since the two can differ
// — `lines.inner`/`lines.outer` are the two already-resolved `IBorderOptions` to pick between.
function cellBorders(sides, lines) {
    const pick = (s) => (s === 'outer' ? lines.outer : s === 'inner' ? lines.inner : NONE_BORDER);
    return { top: pick(sides.top), bottom: pick(sides.bottom), left: pick(sides.left), right: pick(sides.right) };
}
// Accepts CrossAlign too (used for a row-direction group's children, via childCrossAlign below) —
// 'stretch' has no vertical-stretch meaning for a row child (height is always intrinsic, see
// nodes.ts's SelfAlignable comment) and falls back to TOP, same as the default.
function verticalAlignFor(align) {
    return align === 'center' ? VerticalAlignTable.CENTER : align === 'end' ? VerticalAlignTable.BOTTOM : VerticalAlignTable.TOP;
}
function shadingFor(color) {
    return color === undefined ? undefined : { type: ShadingType.CLEAR, fill: resolveExportColor(color) };
}
// --- Node -> block translation ---
async function nodeToBlocks(node, widthPx) {
    switch (node.type) {
        case 'text':
            return [textNodeParagraph(node)];
        case 'richText':
            return [richTextNodeParagraph(node)];
        case 'separator':
            return [separatorParagraph(node)];
        case 'page-break':
            return [new Paragraph({ children: [new PageBreak()] })];
        case 'image':
            return [await imageNodeParagraph(node, widthPx)];
        case 'group':
            return node.direction === 'column' ? columnGroupToBlocks(node, widthPx) : [await rowGroupToTable(node, widthPx)];
        case 'container':
            return [await containerToTable(node, widthPx)];
        case 'table':
            return [await tableNodeToTable(node, widthPx)];
        case 'chart':
            return [await chartNodeParagraph(node, widthPx)];
        case 'qrcode':
            return [await qrcodeNodeParagraph(node, widthPx)];
        case 'barcode':
            return [await barcodeNodeParagraph(node, widthPx)];
        case 'svg':
            warnUnsupportedNodeOnce(node.type);
            return [];
    }
}
// A column group's `gap` has no meaning left once every child becomes an independent Paragraph/Table
// in a flat Word body — paragraphs/tables in OOXML have no "gap between siblings" concept, and a
// Table has no spacing-before/after property to set even on itself. The standard workaround: an
// empty paragraph whose line height is pinned to an EXACT twip value (LineRuleType.EXACT) regardless
// of font size, inserted between consecutive children — this is what actually produced the missing
// vertical whitespace the pixel engine's `gap` gives (its absence is also why a separator with no
// explicit `margin` of its own previously showed with no surrounding space at all: `gap` was silently
// dropped rather than degrading to *some* spacing).
function spacerParagraph(gapPx) {
    return new Paragraph({ spacing: { before: 0, after: 0, line: pxToTwip(gapPx), lineRule: LineRuleType.EXACT } });
}
async function columnGroupToBlocks(node, widthPx) {
    const gap = node.gap ?? 0;
    const results = await Promise.all(node.children.map(child => nodeToBlocks(child, widthPx)));
    const blocks = [];
    results.forEach((childBlocks, i) => {
        if (i > 0 && gap > 0)
            blocks.push(spacerParagraph(gap));
        blocks.push(...childBlocks);
    });
    return blocks;
}
function childCrossAlign(node, fallback) {
    return ('alignSelf' in node ? node.alignSelf : undefined) ?? fallback;
}
// A row-direction group has no direct table analog other than "cells side by side" — the standard
// reflowable-Word trick: an invisible (borderless) single-row table, one cell per child, widths
// from the SAME two-pass flex-grow model group.ts's own layoutRow uses (resolveFlexWidths). Each
// cell still wraps/reflows its own content independently, and Word can still break the row across a
// page boundary if a cell runs long — unlike the pixel engine's atomic-row guarantee, which has no
// meaning once Word is doing its own reflow (see the module header comment on fidelity).
async function rowGroupToTable(node, widthPx) {
    const gap = node.gap ?? 0;
    // Unlike the pixel engine (which positions each cell at an explicit x + gap offset), a table's
    // cells sit flush against each other with no independent "gap" concept — so `gap` here becomes a
    // right-margin trimmed from each non-last cell's own content area instead of narrowing the whole
    // table (narrowing the table's total width would leave one blank strip at the far right, not a
    // gap between every column). Column widths are resolved against the FULL width, not width-minus-
    // gap, precisely so the table still spans the full available width.
    const widths = resolveFlexWidths(node.children.map(rowChildSizing), widthPx);
    const cells = await Promise.all(node.children.map(async (child, i) => {
        const width = widths[i];
        const isLast = i === node.children.length - 1;
        const blocks = child.type === 'separator' ? [] : await nodeToBlocks(child, width);
        const borders = child.type === 'separator'
            ? { ...NO_CELL_BORDERS, right: borderOption(separatorMainSize(child), child.color ?? '#000000', docxBorderStyle(child.style)) }
            : NO_CELL_BORDERS;
        return new DocxTableCell({
            children: blocks.length > 0 ? blocks : [new Paragraph({})],
            width: { size: pxToTwip(width), type: WidthType.DXA },
            borders,
            margins: { top: 0, bottom: 0, left: 0, right: isLast ? 0 : pxToTwip(gap) },
            verticalAlign: verticalAlignFor(childCrossAlign(child, node.crossAlign ?? 'start')),
        });
    }));
    return new DocxTable({
        rows: [new DocxTableRow({ children: cells })],
        width: { size: pxToTwip(widthPx), type: WidthType.DXA },
        columnWidths: widths.map(pxToTwip),
        borders: { top: NONE_BORDER, bottom: NONE_BORDER, left: NONE_BORDER, right: NONE_BORDER, insideHorizontal: NONE_BORDER, insideVertical: NONE_BORDER },
    });
}
// A container has no generic "decorated block" primitive in docx (unlike a group's row, there's
// nothing to lay side by side) — same borderless-single-cell-table trick, 1x1, whose OWN cell
// carries the container's background/border/padding, since a docx Paragraph can't carry a border or
// background itself. No borderRadius equivalent (documented, purely cosmetic limitation).
async function containerToTable(node, widthPx) {
    const width = node.width ?? widthPx;
    const padding = typeof node.padding === 'number' ? { top: node.padding, right: node.padding, bottom: node.padding, left: node.padding } : (node.padding ?? { top: 0, right: 0, bottom: 0, left: 0 });
    const innerWidth = Math.max(0, width - padding.left - padding.right);
    const blocks = await nodeToBlocks(node.child, innerWidth);
    const border = node.border !== undefined ? borderOption(node.border.thickness ?? 1, node.border.color ?? '#000000', docxBorderStyle(node.border.style)) : NONE_BORDER;
    const cell = new DocxTableCell({
        children: blocks.length > 0 ? blocks : [new Paragraph({})],
        width: { size: pxToTwip(width), type: WidthType.DXA },
        shading: shadingFor(node.background),
        borders: { top: border, bottom: border, left: border, right: border },
        margins: { top: pxToTwip(padding.top), bottom: pxToTwip(padding.bottom), left: pxToTwip(padding.left), right: pxToTwip(padding.right) },
    });
    return new DocxTable({
        rows: [new DocxTableRow({ children: [cell] })],
        width: { size: pxToTwip(width), type: WidthType.DXA },
        columnWidths: [pxToTwip(width)],
    });
}
// --- TableNode -> DocxTable: reads node.rows directly, same as xlsx-export.ts — `.groups`/`.stripe`
// are already fully desugared into a flat `rows` array by table()'s builder (nodes.ts). Cell
// placement itself needs no manual merge-range math (unlike xlsx): docx's own Table constructor
// auto-inserts vMerge "continue" cells for any cell with `rowSpan > 1` into the following physical
// row(s), given rows whose `children` list only the cells that START there — exactly the implicit-
// flow shape TableRow.cells already has. Border sides still need grid awareness (top/bottom/left/
// right adjacency, same borderSides() helper xlsx-export.ts uses), since that's about which edges
// get a line, independent of how placement itself is resolved.
//
// Known limitation: docx copies a rowSpan cell's `borders` verbatim onto every auto-inserted
// continuation cell beneath it, so a "this cell's merged block ends here" bottom border can repeat
// at every physical row inside the span rather than only its true bottom edge. Rare in practice
// (colSpan/rowSpan + a full/horizontal border mode together) and accepted as a known cosmetic
// limitation, consistent with this exporter's semantic-not-pixel-perfect scope.
async function tableNodeToTable(node, widthPx) {
    const columnCount = node.columns.length;
    const totalRows = node.rows.length;
    const innerMode = node.border === undefined ? 'none' : (node.border.inner?.mode ?? 'all');
    const outerMode = node.border === undefined ? 'none' : (node.border.outer?.mode ?? 'all');
    if (node.border?.outer?.borderRadius !== undefined)
        warnTableBorderRadiusOnce();
    if (node.border?.headerSeparator)
        warnTableHeaderSeparatorOnce();
    if (node.rows.some(r => r.topBorder !== undefined || r.bottomBorder !== undefined))
        warnTableRowBorderOnce();
    const innerBorderOption = borderOption(node.border?.inner?.thickness ?? 1, node.border?.inner?.color ?? '#000000', docxBorderStyle(node.border?.inner?.style));
    const outerBorderOption = borderOption(node.border?.outer?.thickness ?? 1, node.border?.outer?.color ?? '#000000', docxBorderStyle(node.border?.outer?.style));
    const borderLines = { inner: innerBorderOption, outer: outerBorderOption };
    const colWidthsPx = resolveColumnWidthsPx(node, widthPx);
    const colWidthsTwip = colWidthsPx.map(pxToTwip);
    const tableCellPadding = node.cellPadding ?? 0;
    const bannerMargins = cellMargins(tableCellPadding);
    const fullWidthPx = colWidthsPx.reduce((a, b) => a + b, 0);
    const rows = await Promise.all(node.rows.map(async (row, r) => {
        if (row.kind === 'header') {
            if (row.cells !== undefined)
                return docxRow(row.cells, undefined, r, totalRows, columnCount, colWidthsPx, innerMode, outerMode, borderLines, node.columns, tableCellPadding);
            const bannerBlocks = row.content !== undefined ? await nodeToBlocks(row.content, Math.max(0, fullWidthPx - 2 * tableCellPadding)) : [];
            const bannerCell = new DocxTableCell({
                children: bannerBlocks.length > 0 ? bannerBlocks : [new Paragraph({})],
                columnSpan: columnCount,
                width: { size: colWidthsTwip.reduce((a, b) => a + b, 0), type: WidthType.DXA },
                shading: shadingFor(row.background),
                borders: cellBorders(borderSides(innerMode, outerMode, r, r, 0, columnCount - 1, totalRows, columnCount), borderLines),
                margins: bannerMargins,
            });
            return new DocxTableRow({ children: [bannerCell] });
        }
        return docxRow(row.cells, row, r, totalRows, columnCount, colWidthsPx, innerMode, outerMode, borderLines, node.columns, tableCellPadding);
    }));
    return new DocxTable({
        rows,
        width: { size: colWidthsTwip.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnWidths: colWidthsTwip,
        borders: { top: NONE_BORDER, bottom: NONE_BORDER, left: NONE_BORDER, right: NONE_BORDER, insideHorizontal: NONE_BORDER, insideVertical: NONE_BORDER },
    });
}
// px -> twip margins on all 4 sides, same resolution order table/layout.ts's layoutCell uses
// (cell.padding ?? column.padding ?? table cellPadding) — docx's per-cell `margins` is the direct
// analog of that padding (a docx TableCell has no separate "padding" prop; margins IS the inset).
function cellMargins(paddingPx) {
    const twip = pxToTwip(paddingPx);
    return { top: twip, bottom: twip, left: twip, right: twip };
}
// Cell content goes through the SAME nodeToBlocks() recursion as everything else in the document —
// a group/container/table nested inside a cell (e.g. an item name paragraph stacked over a labelled
// row of sub-fields) gets real paragraph breaks and real per-run styling, not a flattened, single-
// style string. Only text/richText/table cells were previously exempt from this (a synchronous-only
// fallback that flattened anything else to plain text) — nodeToBlocks is already async everywhere
// else (image fetching), so there's no real cost to routing cells through it uniformly too.
async function docxRow(cells, row, r, totalRows, columnCount, colWidthsPx, innerMode, outerMode, borderLines, columns, tableCellPadding) {
    const children = await Promise.all(cells.map(async (cell, i) => {
        const colStart = cell.__resolvedCol ?? i;
        const colSpan = cell.colSpan ?? 1;
        const rowSpan = cell.rowSpan ?? 1;
        const colEnd = colStart + colSpan - 1;
        const rowEnd = r + rowSpan - 1;
        const widthPx = colWidthsPx.slice(colStart, colEnd + 1).reduce((a, b) => a + b, 0);
        const sides = borderSides(innerMode, outerMode, r, rowEnd, colStart, colEnd, totalRows, columnCount);
        // A full rect on all 4 sides, independent of the table-wide inner/outer modes — reuses
        // cellBorders()'s edge-picker with every side forced to 'outer' and `outer` set to the
        // cell's own resolved style (see TableCell.border's doc comment: two adjacent bordered
        // cells double up, by design).
        const fullRectSides = { top: 'outer', bottom: 'outer', left: 'outer', right: 'outer' };
        const borders = cell.border !== undefined
            ? cellBorders(fullRectSides, { inner: NONE_BORDER, outer: borderOption(cell.border.thickness ?? 1, cell.border.color ?? '#000000', docxBorderStyle(cell.border.style)) })
            : cellBorders(sides, borderLines);
        const padding = cell.padding ?? columns[colStart]?.padding ?? tableCellPadding;
        const blocks = cell.content !== undefined ? await nodeToBlocks(cell.content, Math.max(0, widthPx - 2 * padding)) : [];
        return new DocxTableCell({
            children: blocks.length > 0 ? blocks : [new Paragraph({})],
            columnSpan: colSpan > 1 ? colSpan : undefined,
            rowSpan: rowSpan > 1 ? rowSpan : undefined,
            width: { size: pxToTwip(widthPx), type: WidthType.DXA },
            shading: shadingFor(cell.background ?? row?.background),
            verticalAlign: verticalAlignFor(cell.verticalAlign ?? row?.verticalAlign),
            margins: cellMargins(padding),
            borders,
        });
    }));
    return new DocxTableRow({ children });
}
function resolveColumnWidthsPx(node, widthPx) {
    const sizing = node.columns.map(column => {
        const width = column.width;
        if (width === 'shrink') {
            warnShrinkUnsupportedOnce();
            return { kind: 'flex', weight: 1 };
        }
        if (typeof width === 'string')
            return { kind: 'fixed', size: Number.parseFloat(width) };
        return { kind: 'flex', weight: width ?? 1 };
    });
    return resolveFlexWidths(sizing, widthPx);
}
// --- Header/footer + page setup ---
function resolveHeaderFooterContent(content) {
    return typeof content === 'function' ? content(PLACEHOLDER_CTX) : content;
}
async function headerFooterBlocks(content, widthPx) {
    const node = resolveHeaderFooterContent(content);
    return node.type === 'text'
        ? [textNodeParagraph(node, true)]
        : node.type === 'richText'
            ? [richTextNodeParagraph(node, true)]
            : nodeToBlocks(node, widthPx);
}
// --- Watermark (DISABLED — see generateDocx()'s watermarkRuns below and the commented-out imports
// at the top of this file; uncomment all three together to re-enable): rasterized via OffscreenCanvas
// (browser-only) into a transparent PNG, then embedded as one or more floating, behind-text images
// anchored to the page — placed in the document HEADER (not the body) purely because a header is the
// one thing that automatically repeats on every Word page, the same "resolved once, repeats per-page
// automatically" property header/footer content already has. Text watermarks bake color/opacity/
// rotation into the rasterized pixels directly (mirrors generatePdf()'s own non-selectable-watermark
// path); image watermarks are re-drawn through the same canvas pipeline so `opacity`/`rotation` apply
// uniformly to both kinds instead of only text. Unavailable outside a browser (e.g. `bun test`) —
// skips with a warning, since there is no non-canvas way to rasterize/re-encode pixels here.
// type RasterizedImage = { data: Uint8Array; widthPx: number; heightPx: number }
//
// async function rasterizeRotated(baseWidthPx: number, baseHeightPx: number, rotationDeg: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<RasterizedImage> {
//   const diag = Math.ceil(Math.sqrt(baseWidthPx ** 2 + baseHeightPx ** 2)) + 4
//   const canvas = new OffscreenCanvas(diag, diag)
//   const ctx = canvas.getContext('2d')!
//   ctx.translate(diag / 2, diag / 2)
//   ctx.rotate((rotationDeg * Math.PI) / 180)
//   draw(ctx)
//   const blob = await canvas.convertToBlob({ type: 'image/png' })
//   return { data: new Uint8Array(await blob.arrayBuffer()), widthPx: diag, heightPx: diag }
// }
//
// function watermarkFont(watermark: TextWatermark): string {
//   const style = watermark.fontStyle === 'italic' ? 'italic ' : ''
//   const weight = watermark.fontWeight ?? 700
//   return `${style}${weight} ${watermark.fontSize ?? 72}px ${watermark.fontFamily ?? 'Helvetica, Arial, sans-serif'}`
// }
//
// function rasterizeTextWatermark(watermark: TextWatermark): Promise<RasterizedImage> {
//   const font = watermarkFont(watermark)
//   const measureCtx = new OffscreenCanvas(1, 1).getContext('2d')!
//   measureCtx.font = font
//   const textWidth = measureCtx.measureText(watermark.text).width
//   const textHeight = (watermark.fontSize ?? 72) * 1.2
//   return rasterizeRotated(textWidth, textHeight, watermark.rotation ?? -45, ctx => {
//     ctx.globalAlpha = watermark.opacity ?? 0.15
//     ctx.fillStyle = `#${resolveExportColor(watermark.color ?? '#000000')}`
//     ctx.font = font
//     ctx.textAlign = 'center'
//     ctx.textBaseline = 'middle'
//     ctx.fillText(watermark.text, 0, 0)
//   })
// }
//
// async function rasterizeImageWatermark(watermark: ImageWatermark): Promise<RasterizedImage | null> {
//   const fetched = await fetchImageData(watermark.src)
//   if (fetched === null) return null
//   const mime = fetched.type === 'jpg' ? 'image/jpeg' : `image/${fetched.type}`
//   const bitmap = await createImageBitmap(new Blob([new Uint8Array(fetched.data)], { type: mime }))
//   return rasterizeRotated(watermark.width, watermark.height, watermark.rotation ?? -45, ctx => {
//     ctx.globalAlpha = watermark.opacity ?? 0.15
//     ctx.drawImage(bitmap, -watermark.width / 2, -watermark.height / 2, watermark.width, watermark.height)
//   })
// }
//
// function resolveWatermarkContent(content: WatermarkContent): Watermark | undefined {
//   const resolved = typeof content === 'function' ? content(PLACEHOLDER_CTX) : content
//   return resolved ?? undefined
// }
//
// async function watermarkImageRuns(content: WatermarkContent, pageWidthPx: number, pageHeightPx: number): Promise<ImageRun[]> {
//   if (typeof OffscreenCanvas === 'undefined') {
//     warnWatermarkUnsupportedOnce()
//     return []
//   }
//   const watermark = resolveWatermarkContent(content)
//   if (watermark === undefined) return []
//
//   const rasterized = watermark.kind === 'text' ? await rasterizeTextWatermark(watermark) : await rasterizeImageWatermark(watermark)
//   if (rasterized === null) return []
//
//   const instances = resolveWatermarkInstances(watermark, pageWidthPx, pageHeightPx, rasterized.widthPx, rasterized.heightPx)
//   return instances.map(
//     ({ x, y }) =>
//       new ImageRun({
//         type: 'png',
//         data: rasterized.data,
//         transformation: { width: rasterized.widthPx, height: rasterized.heightPx },
//         outline: NO_IMAGE_OUTLINE,
//         floating: {
//           horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: pxToEmu(x - rasterized.widthPx / 2) },
//           verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: pxToEmu(y - rasterized.heightPx / 2) },
//           behindDocument: true,
//           wrap: { type: TextWrappingType.NONE },
//           allowOverlap: true,
//         },
//       }),
//   )
// }
export async function generateDocx(doc, metadata) {
    const pageSize = resolvePageSize(doc.size);
    const contentWidthPx = pageSize.width - doc.margins.left - doc.margins.right;
    if (doc.background !== undefined)
        warnPageBackgroundOnce();
    if (doc.marginContent !== undefined)
        warnMarginContentUnsupportedOnce();
    const bodyChildren = await nodeToBlocks(doc.body, contentWidthPx);
    const headerBlocks = doc.header !== undefined ? await headerFooterBlocks(doc.header, contentWidthPx) : [];
    //const watermarkRuns = doc.watermark !== undefined ? await watermarkImageRuns(doc.watermark, pageSize.width, pageSize.height) : []
    const watermarkRuns = [];
    const headerChildren = watermarkRuns.length > 0 ? [...headerBlocks, new Paragraph({ children: watermarkRuns })] : headerBlocks;
    const headers = headerChildren.length > 0 ? { default: new Header({ children: headerChildren }) } : undefined;
    const footers = doc.footer !== undefined ? { default: new Footer({ children: await headerFooterBlocks(doc.footer, contentWidthPx) }) } : undefined;
    const document = new Document({
        title: metadata?.title,
        creator: metadata?.author,
        subject: metadata?.subject,
        keywords: metadata?.keywords?.join(', '),
        sections: [
            {
                properties: {
                    page: {
                        size: { width: pxToTwip(pageSize.width), height: pxToTwip(pageSize.height) },
                        margin: { top: pxToTwip(doc.margins.top), right: pxToTwip(doc.margins.right), bottom: pxToTwip(doc.margins.bottom), left: pxToTwip(doc.margins.left) },
                    },
                },
                headers,
                footers,
                children: bodyChildren,
            },
        ],
    });
    const arrayBuffer = await Packer.toArrayBuffer(document);
    return new Uint8Array(arrayBuffer);
}
