// Container is a single-child decorative wrapper (background/border/borderRadius/padding) around
// arbitrary content — see nodes.ts's ContainerNode for the full field contract. `height` is a
// MINIMUM, not exact: box content height is Math.max(node.height ?? 0, childNaturalHeight +
// padding.top + padding.bottom), the same targetHeight-as-floor pattern group.ts's layoutColumn
// already uses — deliberately chosen over exact/clipped sizing so no clip-region code is needed in
// either renderer, and content is never silently lost. Padding always insets the child from
// whatever width/height the box resolved to, exactly like table/layout.ts's layoutCell does with
// cellPadding. Border/borderRadius are pure paint, never consuming layout space.
//
// Unlike the old container-layout.ts, this module recurses into its child via the fully generic
// measureNodeHeight/layoutNodeFull/isSplittable/splitNode/renderNodeDom/drawPdfNode dispatchers —
// safe now that behavior.ts never imports concrete node modules (see behavior.ts's header comment),
// so there's no cycle left to avoid by hand-rolling a local copy of that dispatch.
import { translateRendered } from "../core/geometry.js";
import { drawPdfNode, isSplittable, layoutNodeFull, measureNodeHeight, registerNode, renderNodeDom, splitNode } from "../core/behavior.js";
import { styledDiv } from "../render/shadow-dom.js";
import { applyLineStyle, pxToPt, resetLineStyle, resolvePdfColor, toPdfRect } from "../render/pdf-render.js";
function resolvePadding(padding) {
    if (padding === undefined)
        return { top: 0, right: 0, bottom: 0, left: 0 };
    if (typeof padding === 'number')
        return { top: padding, right: padding, bottom: padding, left: padding };
    return padding;
}
// The width this container would claim on its own, before the parent's alignment/flex rules are
// applied — used for column shrink-wrap sizing, mirroring imageNaturalWidth/chartNaturalWidth
// exactly (no aspectRatio concept here, so it's simpler).
export function containerNaturalWidth(node, availableWidth) {
    return node.width ?? availableWidth;
}
function measureHeight(node, width) {
    const pad = resolvePadding(node.padding);
    const childWidth = Math.max(0, width - pad.left - pad.right);
    const childHeight = measureNodeHeight(node.child, childWidth);
    return Math.max(node.height ?? 0, childHeight + pad.top + pad.bottom);
}
function layout(node, width) {
    const pad = resolvePadding(node.padding);
    const childWidth = Math.max(0, width - pad.left - pad.right);
    const rawChild = layoutNodeFull(node.child, childWidth);
    const boxHeight = Math.max(node.height ?? 0, rawChild.box.height + pad.top + pad.bottom);
    const child = translateRendered(rawChild, pad.left, pad.top);
    return { type: 'container', box: { x: 0, y: 0, width, height: boxHeight }, node, child };
}
function split(node, width, availableHeight) {
    if (!isSplittable(node.child))
        return null;
    const pad = resolvePadding(node.padding);
    const childWidth = Math.max(0, width - pad.left - pad.right);
    const childAvailable = availableHeight - pad.top - pad.bottom;
    if (childAvailable <= 0)
        return null;
    const childSplit = splitNode(node.child, childWidth, childAvailable);
    if (childSplit === null)
        return null;
    const child = translateRendered(childSplit.rendered, pad.left, pad.top);
    const consumedHeight = pad.top + childSplit.consumedHeight + pad.bottom;
    // `height` is a MINIMUM only, deliberately NOT re-applied here: enforcing it on a fragment that
    // continues onto the next page would inflate consumedHeight past what the child actually used,
    // corrupting the caller's page-cursor bookkeeping. If `rest` later fits fully on its own (no
    // further split needed), the ordinary layout() path above re-applies the minimum naturally on
    // that final fragment.
    const rest = childSplit.rest === null ? null : { ...node, child: childSplit.rest };
    return {
        rendered: { type: 'container', box: { x: 0, y: 0, width, height: consumedHeight }, node, child },
        consumedHeight,
        rest,
    };
}
function renderDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const style = {
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
    };
    if (node.background !== undefined)
        style.background = node.background;
    if (node.border !== undefined)
        style.border = `${node.border.thickness ?? 1}px ${node.border.style ?? 'solid'} ${node.border.color ?? '#000000'}`;
    if (node.borderRadius !== undefined)
        style.borderRadius = `${node.borderRadius}px`;
    ctx.container.appendChild(styledDiv(style));
    // Same convention as group/table: rendered.child.box is already resolved relative to this SAME
    // (originX, originY), not to the container's own box (translateRendered's container branch
    // shifts both by the same delta) — so recursion reuses the UNCHANGED origin, not (x, y).
    renderNodeDom(rendered.child, ctx.originX, ctx.originY, ctx);
}
async function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const rect = toPdfRect(x, y, rendered.box.width, rendered.box.height);
    const radiusPt = node.borderRadius !== undefined ? pxToPt(node.borderRadius) : 0;
    const doc = ctx.pdf.doc;
    if (node.background !== undefined) {
        doc.roundedRect(rect.x, rect.y, rect.width, rect.height, radiusPt).fill(resolvePdfColor(node.background));
    }
    if (node.border !== undefined) {
        const thicknessPt = pxToPt(node.border.thickness ?? 1);
        applyLineStyle(doc, node.border.style, thicknessPt);
        doc.roundedRect(rect.x, rect.y, rect.width, rect.height, radiusPt).lineWidth(thicknessPt).stroke(resolvePdfColor(node.border.color ?? '#000000'));
        resetLineStyle(doc);
    }
    // Same origin convention as group/table (NOT the chart module's own-origin exception) — see
    // shadow-dom.ts's renderContainerNode-era rationale, preserved here.
    await drawPdfNode(rendered.child, ctx.originX, ctx.originY, ctx.pdf);
}
registerNode('container', {
    measureHeight,
    isSplittable: node => isSplittable(node.child),
    split,
    layout,
    naturalWidth: containerNaturalWidth,
    renderDom,
    drawPdf,
});
