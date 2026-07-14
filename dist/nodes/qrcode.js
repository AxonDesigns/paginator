// QR code node — no SVG/canvas rendering dependency: `qrcode-generator` (via qrcode-encode.ts)
// only ever supplies the raw module matrix (isDark/getModuleCount); every pixel drawn here
// (DOM/PDF) is hand-built from that matrix, mirroring how chart nodes hand-draw their own vector
// primitives (see src/render/chart-render.ts's header comment) rather than going through any
// rendering library.
import { registerNode } from "../core/behavior.js";
import { BASE_ELEMENT_STYLE } from "../render/reset.js";
import { toPdfRect, resolvePdfColor } from "../render/pdf-render.js";
import { buildQrMatrix, qrcodeRunsForRow } from "../render/qrcode-encode.js";
// qrcode()'s constructor already guarantees at least one of height/aspectRatio is present (or
// derives both from moduleSize), so the fallback branch here is unreachable in practice — kept as
// a defensive error rather than a silent NaN, same as image.ts/svg.ts's own resolveHeight.
function resolveHeight(node, width) {
    if (node.height !== undefined)
        return node.height;
    if (node.aspectRatio !== undefined)
        return width / node.aspectRatio;
    throw new Error('[paginator] qrcode node has neither "height" nor "aspectRatio" — use the qrcode() builder, which validates this upfront.');
}
export function qrcodeNaturalWidth(node, availableWidth) {
    if (node.width !== undefined)
        return node.width;
    if (node.height !== undefined && node.aspectRatio !== undefined)
        return node.height * node.aspectRatio;
    return availableWidth;
}
function layout(node, width) {
    return { type: 'qrcode', box: { x: 0, y: 0, width, height: resolveHeight(node, width) }, node };
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const matrix = buildQrMatrix(node.value, node.errorCorrectionLevel ?? 'M');
    const quietZone = node.quietZone ?? 4;
    const side = matrix.moduleCount + quietZone * 2;
    const moduleWidth = rendered.box.width / side;
    const moduleHeight = rendered.box.height / side;
    const svg = document.createElementNS(SVG_NS, 'svg');
    Object.assign(svg.style, BASE_ELEMENT_STYLE, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
        ...(node.opacity !== undefined ? { opacity: `${node.opacity}` } : {}),
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
    const moduleColor = node.moduleColor ?? '#000000';
    for (let row = 0; row < matrix.moduleCount; row++) {
        for (const run of qrcodeRunsForRow(matrix, row)) {
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', `${(quietZone + run.startCol) * moduleWidth}`);
            rect.setAttribute('y', `${(quietZone + row) * moduleHeight}`);
            rect.setAttribute('width', `${run.length * moduleWidth}`);
            rect.setAttribute('height', `${moduleHeight}`);
            rect.setAttribute('fill', moduleColor);
            svg.appendChild(rect);
        }
    }
    ctx.container.appendChild(svg);
}
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const matrix = buildQrMatrix(node.value, node.errorCorrectionLevel ?? 'M');
    const quietZone = node.quietZone ?? 4;
    const side = matrix.moduleCount + quietZone * 2;
    const moduleWidth = rendered.box.width / side;
    const moduleHeight = rendered.box.height / side;
    const doc = ctx.pdf.doc;
    const needsOpacity = node.opacity !== undefined;
    if (needsOpacity)
        doc.save().opacity(node.opacity);
    const backgroundRect = toPdfRect(x, y, rendered.box.width, rendered.box.height);
    doc.rect(backgroundRect.x, backgroundRect.y, backgroundRect.width, backgroundRect.height).fill(resolvePdfColor(node.backgroundColor ?? '#ffffff'));
    const moduleColor = resolvePdfColor(node.moduleColor ?? '#000000');
    for (let row = 0; row < matrix.moduleCount; row++) {
        for (const run of qrcodeRunsForRow(matrix, row)) {
            const rect = toPdfRect(x + (quietZone + run.startCol) * moduleWidth, y + (quietZone + row) * moduleHeight, run.length * moduleWidth, moduleHeight);
            doc.rect(rect.x, rect.y, rect.width, rect.height).fill(moduleColor);
        }
    }
    if (needsOpacity)
        doc.restore();
}
registerNode('qrcode', {
    measureHeight: (node, width) => resolveHeight(node, width),
    isSplittable: () => false,
    layout,
    naturalWidth: qrcodeNaturalWidth,
    renderDom,
    drawPdf,
});
