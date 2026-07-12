import { BASE_ELEMENT_STYLE } from "../../render/reset.js";
import { renderChartSvg } from "../../render/chart-render.js";
export function renderChartNode(rendered, x, y, ctx) {
    const svg = renderChartSvg(rendered.node, rendered.box.width, rendered.box.height);
    Object.assign(svg.style, BASE_ELEMENT_STYLE, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
        // SVG <text> (axis labels, legend, title) is natively selectable same as HTML text — without
        // this, a drag gesture starting on (or bubbling up through) a draggable chart can also select
        // its labels, exactly the problem text.ts's own `unselectable` threading solves for text nodes.
        ...(ctx.unselectable ? { userSelect: 'none' } : {}),
        ...(ctx.cursor !== undefined ? { cursor: ctx.cursor } : {}),
    });
    ctx.container.appendChild(svg);
}
