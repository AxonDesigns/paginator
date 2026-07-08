import { registerNode } from "../../core/behavior.js";
import { layoutTable, measureTableHeight, splitTable } from "./layout.js";
import { renderTableNode } from "./dom.js";
import { drawTableNode } from "./pdf.js";
export { resolveColumnWidths } from "./layout.js";
registerNode('table', {
    measureHeight: measureTableHeight,
    isSplittable: () => true,
    split: splitTable,
    layout: layoutTable,
    renderDom: renderTableNode,
    drawPdf: drawTableNode,
});
