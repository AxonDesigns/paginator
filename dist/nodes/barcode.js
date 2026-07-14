// Linear barcode node (Code128/EAN-13/Code39) — zero rendering dependency: barcode-encode.ts only
// ever supplies bar/space module runs; every rect (and the optional human-readable text line)
// drawn here (DOM/PDF) is hand-built from that data, same "no rendering library" contract
// qrcode.ts and chart nodes already follow.
import { registerNode } from "../core/behavior.js";
import { BASE_ELEMENT_STYLE } from "../render/reset.js";
import { toPdfRect, resolvePdfColor, pxToPt } from "../render/pdf-render.js";
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
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const pattern = encodeNode(node);
    const { quietZone, showText, textSize, barHeight, moduleWidth } = barGeometry(node, pattern, rendered.box.width, rendered.box.height);
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
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', `${rendered.box.width}`);
    background.setAttribute('height', `${rendered.box.height}`);
    background.setAttribute('fill', node.backgroundColor ?? '#ffffff');
    svg.appendChild(background);
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
            svg.appendChild(rect);
        }
        cursor += runWidth;
    });
    if (showText) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', `${rendered.box.width / 2}`);
        text.setAttribute('y', `${barHeight + textSize}`);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', `${textSize}`);
        text.setAttribute('font-family', 'ui-monospace, monospace, sans-serif');
        text.setAttribute('fill', node.textColor ?? barColor);
        text.textContent = pattern.text;
        svg.appendChild(text);
    }
    ctx.container.appendChild(svg);
}
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const pattern = encodeNode(node);
    const { quietZone, showText, textSize, barHeight, moduleWidth } = barGeometry(node, pattern, rendered.box.width, rendered.box.height);
    const doc = ctx.pdf.doc;
    const needsOpacity = node.opacity !== undefined;
    if (needsOpacity)
        doc.save().opacity(node.opacity);
    const backgroundRect = toPdfRect(x, y, rendered.box.width, rendered.box.height);
    doc.rect(backgroundRect.x, backgroundRect.y, backgroundRect.width, backgroundRect.height).fill(resolvePdfColor(node.backgroundColor ?? '#ffffff'));
    const barColor = resolvePdfColor(node.barColor ?? '#000000');
    let cursor = quietZone;
    pattern.runs.forEach((runLength, i) => {
        const runWidth = runLength * moduleWidth;
        if (i % 2 === 0) {
            const rect = toPdfRect(x + cursor, y, runWidth, barHeight);
            doc.rect(rect.x, rect.y, rect.width, rect.height).fill(barColor);
        }
        cursor += runWidth;
    });
    // Same anchor-middle idiom chart/pdf.ts's drawChartText uses: measure via pdfkit's own real
    // doc.widthOfString, then shift x left by half that width.
    if (showText) {
        doc.font('Helvetica').fontSize(pxToPt(textSize));
        const widthPt = doc.widthOfString(pattern.text);
        const baseX = pxToPt(x + rendered.box.width / 2) - widthPt / 2;
        const baseY = pxToPt(y + barHeight + textSize);
        doc.fillColor(resolvePdfColor(node.textColor ?? node.barColor ?? '#000000')).text(pattern.text, baseX, baseY, { lineBreak: false, baseline: 0 });
    }
    if (needsOpacity)
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
