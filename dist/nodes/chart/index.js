import { registerNode } from "../../core/behavior.js";
import { chartNaturalWidth, layoutChart, measureChartHeight } from "./layout.js";
import { renderChartNode } from "./dom.js";
import { drawChartNode } from "./pdf.js";
registerNode('chart', {
    measureHeight: measureChartHeight,
    isSplittable: () => false,
    layout: layoutChart,
    naturalWidth: chartNaturalWidth,
    renderDom: renderChartNode,
    drawPdf: drawChartNode,
});
