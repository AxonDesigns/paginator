// SeparatorNode is a trivial atomic leaf. Its registered entry models the canonical "horizontal rule
// as a column child" orientation: reserved main-axis (height) size is thickness + 2*margin, spanning
// the full width handed to it. When a separator is used as a ROW child (vertical divider), the
// row-specific stretch-to-full-row-height behavior is assembled directly by group.ts, which already
// knows the row's final height only after laying out every child — a separator always renders as a
// line perpendicular to its parent's main axis, spanning the parent's cross axis fully, using
// `thickness + 2*margin` along the main axis. That row-specific box is pre-resolved by group.ts
// itself rather than by this file's own `layout()` — see group.ts's layoutResolvedChild.
import { registerNode } from "../core/behavior.js";
import { styledDiv } from "../render/shadow-dom.js";
import { resolvePdfColor, toPdfRect } from "../render/pdf-render.js";
export function separatorMainSize(node) {
    return (node.thickness ?? 1) + 2 * (node.margin ?? 0);
}
function layout(node, width) {
    return { type: 'separator', box: { x: 0, y: 0, width, height: separatorMainSize(node) }, node };
}
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const el = styledDiv({
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
        background: node.color ?? '#000000',
    });
    ctx.container.appendChild(el);
}
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height);
    ctx.pdf.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(node.color ?? '#000000'));
}
registerNode('separator', {
    measureHeight: node => separatorMainSize(node),
    isSplittable: () => false,
    layout,
    renderDom,
    drawPdf,
});
