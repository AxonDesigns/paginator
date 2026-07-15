// Linear barcode node (Code128/EAN-13/Code39) — zero rendering dependency: barcode-encode.ts only
// ever supplies bar/space module runs; every rect (and the optional human-readable text line)
// drawn here (DOM/PDF) is hand-built from that data, same "no rendering library" contract
// qrcode.ts and chart nodes already follow.
import { registerNode } from "../core/behavior.js";
import { BASE_ELEMENT_STYLE } from "../render/reset.js";
import { resolvePdfColor, pxToPt, PX_TO_PT } from "../render/pdf-render.js";
import { encodeBarcodeValue } from "../render/barcode-encode.js";
// barcode()'s constructor already guarantees "height"/"aspectRatio" is present, so the fallback
// branch here is unreachable in practice — kept as a defensive error, same as image.ts/svg.ts.
function resolveHeight(node, width) {
    if (node.height !== undefined)
        return node.height;
    if (node.aspectRatio !== undefined)
        return width / node.aspectRatio;
    throw new Error('[paginator] barcode node has neither "height" nor "aspectRatio" — use the barcode() builder, which validates this upfront.');
}
export function barcodeNaturalWidth(node, availableWidth) {
    if (node.width !== undefined)
        return node.width;
    if (node.height !== undefined && node.aspectRatio !== undefined)
        return node.height * node.aspectRatio;
    return availableWidth;
}
function layout(node, width) {
    return { type: 'barcode', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node };
}
// Re-encoded at every render call rather than cached on the node — cheap, pure, deterministic,
// same "don't cache" contract svg() has for its own markup parsing.
function encodeNode(node) {
    return encodeBarcodeValue(node.symbology ?? 'code128', node.value, node.checkDigit);
}
// Bars fill (box width - 2*quietZone) at a constant px quiet zone on each side — the quiet zone
// doesn't scale with the box the way the bars themselves do, same "fixed margin, content scales to
// fill the rest" idea as a container's padding. A showText line reserves a fixed band at the
// bottom; barHeight defaults to whatever's left above that band.
function barGeometry(node, pattern, boxWidth, boxHeight) {
    const quietZone = node.quietZone ?? 10;
    const showText = node.showText ?? true;
    const textSize = node.textSize ?? 10;
    const textBand = showText ? textSize * 1.4 + 4 : 0;
    const barHeight = node.barHeight ?? Math.max(0, boxHeight - textBand);
    const usableWidth = Math.max(0, boxWidth - quietZone * 2);
    const moduleWidth = pattern.totalModules > 0 ? usableWidth / pattern.totalModules : 0;
    return { quietZone, showText, textSize, barHeight, moduleWidth };
}
const SVG_NS = 'http://www.w3.org/2000/svg';
// Draws background + bars + text into `parent` in a LOCAL (contentWidth x contentHeight) coordinate
// space, bars always running left-to-right along contentWidth — the one "natural" drawing routine
// both the unrotated (rotation: 0) and rotated (90/-90) cases below reuse unchanged, so rotation is
// purely a coordinate-transform concern, never a separate "draw vertically" implementation (which
// would have needed to re-derive text placement/rotation from scratch).
function appendBarcodeContentSvg(parent, node, pattern, contentWidth, contentHeight) {
    const { quietZone, showText, textSize, barHeight, moduleWidth } = barGeometry(node, pattern, contentWidth, contentHeight);
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', `${contentWidth}`);
    background.setAttribute('height', `${contentHeight}`);
    background.setAttribute('fill', node.backgroundColor ?? '#ffffff');
    parent.appendChild(background);
    const barColor = node.barColor ?? '#000000';
    let cursor = quietZone;
    pattern.runs.forEach((runLength, i) => {
        const runWidth = runLength * moduleWidth;
        if (i % 2 === 0) {
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', `${cursor}`);
            rect.setAttribute('y', '0');
            rect.setAttribute('width', `${runWidth}`);
            rect.setAttribute('height', `${barHeight}`);
            rect.setAttribute('fill', barColor);
            parent.appendChild(rect);
        }
        cursor += runWidth;
    });
    if (showText) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', `${contentWidth / 2}`);
        text.setAttribute('y', `${barHeight + textSize}`);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', `${textSize}`);
        text.setAttribute('font-family', 'ui-monospace, monospace, sans-serif');
        text.setAttribute('fill', node.textColor ?? barColor);
        text.textContent = pattern.text;
        parent.appendChild(text);
    }
}
// The SVG transform that maps `rotation`'s natural (contentWidth=box.height x
// contentHeight=box.width) content into the final (box.width x box.height) box. Derived from the
// standard "translate then rotate" composition (SVG applies the rightmost transform to the point
// first): rotating 90° clockwise about the origin sends (x,y) -> (-y,x), so following it with
// translate(boxWidth,0) lands the natural content's starting edge (x=0) at the box's TOP —
// bars read top-to-bottom. -90 is the mirror image (translate(0,boxHeight) rotate(-90)) — bars
// read bottom-to-top instead, with the text line ending up on the opposite edge.
function verticalTransform(rotation, boxWidth, boxHeight) {
    return rotation === 90 ? `translate(${boxWidth} 0) rotate(90)` : `translate(0 ${boxHeight}) rotate(-90)`;
}
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const pattern = encodeNode(node);
    const rotation = node.rotation ?? 0;
    const svg = document.createElementNS(SVG_NS, 'svg');
    Object.assign(svg.style, BASE_ELEMENT_STYLE, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
        ...(node.opacity !== undefined ? { opacity: `${node.opacity}` } : {}),
        // Barcode's text line is real SVG <text> — same "keep it out of drag-select" treatment
        // chart's own <text> labels get in chart/dom.ts.
        ...(ctx.unselectable ? { userSelect: 'none' } : {}),
        ...(ctx.cursor !== undefined ? { cursor: ctx.cursor } : {}),
    });
    svg.setAttribute('width', `${rendered.box.width}`);
    svg.setAttribute('height', `${rendered.box.height}`);
    if (rotation === 0) {
        appendBarcodeContentSvg(svg, node, pattern, rendered.box.width, rendered.box.height);
    }
    else {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('transform', verticalTransform(rotation, rendered.box.width, rendered.box.height));
        appendBarcodeContentSvg(g, node, pattern, rendered.box.height, rendered.box.width);
        svg.appendChild(g);
    }
    ctx.container.appendChild(svg);
}
// Same natural (left-to-right) drawing as appendBarcodeContentSvg, but issuing raw pdfkit calls in
// LOCAL, UNSCALED px coordinates — meant to run inside a doc.scale(PX_TO_PT) block (see drawPdf),
// exactly like chart/pdf.ts's drawChartPath/drawChartAreaFill already do for their own vector
// content. pdfkit's fontSize()/widthOfString() are pure glyph-metric arithmetic with no awareness
// of the active CTM, so measuring/positioning text in these same raw local units is self-consistent
// with everything else drawn here — the active scale/rotate/translate transform converts the whole
// thing to the correct final page position and size at render time.
function drawBarcodeContentPdf(doc, node, pattern, contentWidth, contentHeight) {
    const { quietZone, showText, textSize, barHeight, moduleWidth } = barGeometry(node, pattern, contentWidth, contentHeight);
    doc.rect(0, 0, contentWidth, contentHeight).fill(resolvePdfColor(node.backgroundColor ?? '#ffffff'));
    const barColor = resolvePdfColor(node.barColor ?? '#000000');
    let cursor = quietZone;
    pattern.runs.forEach((runLength, i) => {
        const runWidth = runLength * moduleWidth;
        if (i % 2 === 0)
            doc.rect(cursor, 0, runWidth, barHeight).fill(barColor);
        cursor += runWidth;
    });
    // Same anchor-middle idiom chart/pdf.ts's drawChartText uses: measure via pdfkit's own real
    // doc.widthOfString, then shift x left by half that width.
    if (showText) {
        doc.font('Helvetica').fontSize(textSize);
        const textWidth = doc.widthOfString(pattern.text);
        doc.fillColor(resolvePdfColor(node.textColor ?? node.barColor ?? '#000000'))
            .text(pattern.text, contentWidth / 2 - textWidth / 2, barHeight + textSize, { lineBreak: false, baseline: 0 });
    }
}
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const pattern = encodeNode(node);
    const rotation = node.rotation ?? 0;
    const doc = ctx.pdf.doc;
    doc.save();
    if (node.opacity !== undefined)
        doc.opacity(node.opacity);
    if (rotation === 0) {
        doc.translate(pxToPt(x), pxToPt(y));
        doc.scale(PX_TO_PT);
        drawBarcodeContentPdf(doc, node, pattern, rendered.box.width, rendered.box.height);
    }
    else if (rotation === 90) {
        doc.translate(pxToPt(x + rendered.box.width), pxToPt(y));
        doc.rotate(90);
        doc.scale(PX_TO_PT);
        drawBarcodeContentPdf(doc, node, pattern, rendered.box.height, rendered.box.width);
    }
    else {
        doc.translate(pxToPt(x), pxToPt(y + rendered.box.height));
        doc.rotate(-90);
        doc.scale(PX_TO_PT);
        drawBarcodeContentPdf(doc, node, pattern, rendered.box.height, rendered.box.width);
    }
    doc.restore();
}
registerNode('barcode', {
    measureHeight: (node, width) => resolveHeight(node, width),
    isSplittable: () => false,
    layout,
    naturalWidth: barcodeNaturalWidth,
    renderDom,
    drawPdf,
});
