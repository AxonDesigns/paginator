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
    return { type: 'separator', box: { x: 0, y: 0, width, height: separatorMainSize(node) }, node, orientation: 'horizontal' };
}
// The reserved box spans `thickness + 2*margin` along the main axis (see separatorMainSize) but only
// the `thickness`-wide middle should be painted — `margin` is blank space, not part of the line.
function insetLineRect(rendered, x, y) {
    const margin = rendered.node.margin ?? 0;
    const { box, orientation } = rendered;
    if (orientation === 'horizontal')
        return { x, y: y + margin, width: box.width, height: box.height - 2 * margin };
    return { x: x + margin, y, width: box.width - 2 * margin, height: box.height };
}
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const line = insetLineRect(rendered, x, y);
    const el = styledDiv({
        left: `${line.x}px`,
        top: `${line.y}px`,
        width: `${line.width}px`,
        height: `${line.height}px`,
        background: node.color ?? '#000000',
    });
    ctx.container.appendChild(el);
}
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const line = insetLineRect(rendered, x, y);
    const rect = toPdfRect(line.x, line.y, line.width, line.height);
    ctx.pdf.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(resolvePdfColor(node.color ?? '#000000'));
}
registerNode('separator', {
    measureHeight: node => separatorMainSize(node),
    isSplittable: () => false,
    layout,
    renderDom,
    drawPdf,
});
