import { registerNode } from '../../core/behavior.ts'
import { chartNaturalWidth, layoutChart, measureChartHeight } from './layout.ts'
import { renderChartNode } from './dom.ts'
import { drawChartNode } from './pdf.ts'

registerNode('chart', {
  measureHeight: measureChartHeight,
  isSplittable: () => false,
  layout: layoutChart,
  naturalWidth: chartNaturalWidth,
  renderDom: renderChartNode,
  drawPdf: drawChartNode,
})
