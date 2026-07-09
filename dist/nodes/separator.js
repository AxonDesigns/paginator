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
import { applyLineStyle, pxToPt, resetLineStyle, resolvePdfColor, toPdfRect } from "../render/pdf-render.js";
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
// `thickness+2*margin` reserved, but only the `thickness`-wide middle is painted (see
// insetLineRect above). Rendered via a zero-size, single-side `border` rather than a filled
// rectangle so `style: 'dashed'`/`'dotted'` fall out of the native CSS border-style keywords —
// box-sizing: border-box (BASE_ELEMENT_STYLE) means a 0-height/width box with only its
// top/left border set still paints exactly `thickness` px, flush with the box's own top-left
// corner, matching the old filled-rect's geometry exactly for the default 'solid' case.
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const line = insetLineRect(rendered, x, y);
    const color = node.color ?? '#000000';
    const style = node.style ?? 'solid';
    const el = styledDiv(rendered.orientation === 'horizontal'
        ? {
            left: `${line.x}px`,
            top: `${line.y}px`,
            width: `${line.width}px`,
            height: '0',
            borderTopWidth: `${line.height}px`,
            borderTopStyle: style,
            borderTopColor: color,
        }
        : {
            left: `${line.x}px`,
            top: `${line.y}px`,
            width: '0',
            height: `${line.height}px`,
            borderLeftWidth: `${line.width}px`,
            borderLeftStyle: style,
            borderLeftColor: color,
        });
    ctx.container.appendChild(el);
}
// pdfkit has no native border-style keyword, so 'dashed'/'dotted' are approximated by stroking the
// centerline with a dash pattern instead of filling the inset rect: a plain fill can't produce gaps.
// 'solid' still fills the rect directly (exact geometry, cheapest path, and the default/common case).
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const line = insetLineRect(rendered, x, y);
    const color = resolvePdfColor(node.color ?? '#000000');
    const style = node.style ?? 'solid';
    if (style === 'solid') {
        const rect = toPdfRect(line.x, line.y, line.width, line.height);
        ctx.pdf.doc.rect(rect.x, rect.y, rect.width, rect.height).fill(color);
        return;
    }
    const thicknessPt = pxToPt(rendered.orientation === 'horizontal' ? line.height : line.width);
    const start = rendered.orientation === 'horizontal'
        ? { x: pxToPt(line.x), y: pxToPt(line.y + line.height / 2) }
        : { x: pxToPt(line.x + line.width / 2), y: pxToPt(line.y) };
    const end = rendered.orientation === 'horizontal'
        ? { x: pxToPt(line.x + line.width), y: pxToPt(line.y + line.height / 2) }
        : { x: pxToPt(line.x + line.width / 2), y: pxToPt(line.y + line.height) };
    const doc = ctx.pdf.doc;
    doc.lineWidth(thicknessPt);
    applyLineStyle(doc, style, thicknessPt);
    doc.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke(color);
    resetLineStyle(doc);
}
registerNode('separator', {
    measureHeight: node => separatorMainSize(node),
    isSplittable: () => false,
    layout,
    renderDom,
    drawPdf,
});
