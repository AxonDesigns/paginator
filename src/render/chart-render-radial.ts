// SVG (on-screen) rendering for the merged pie+donut 'radial' chart kind, including multi-ring and
// sunburst (parentIndex-nested) charts — split out of chart-render.ts (see that file's header
// comment). Mirrored field-for-field by src/nodes/chart/pdf-radial.ts on the PDF side.

import type { RadialChartNode } from '../core/nodes.ts'
import { donutSlicePath, pieSlicePath, resolveRingRadii, resolveRingSliceAngles, ringSliceColor } from './chart-geometry.ts'
import type { ChartBox, RingSliceAngle } from './chart-geometry.ts'
import { svgEl } from './chart-render.ts'

export function renderRadialChart(svg: SVGSVGElement, node: RadialChartNode, plot: ChartBox): void {
  const rings = node.rings
  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const outerRadius = Math.max(0, Math.min(plot.width, plot.height) / 2 - 8)
  const ringRadii = resolveRingRadii(rings.length, node.innerRadiusRatio ?? 0, outerRadius)

  // Ring 0 first, always — an outer ring's parented slices read the arc THEIR parent already
  // resolved to (see resolveRingSliceAngles's header comment), so ring i's angles can't be computed
  // before ring i-1's are known.
  let previousArcs: RingSliceAngle[] | null = null
  rings.forEach((ring, ri) => {
    const arcs = resolveRingSliceAngles(ring.slices, previousArcs)
    const { innerR, outerR } = ringRadii[ri]!
    const isRingDonut = innerR > 0

    const gapDeg = ring.slices.length > 1 ? (ring.sliceGap ?? node.sliceGap ?? 1.5) : 0
    // Constant PIXEL half-width (evaluated at THIS ring's own outer radius), not a trimmed angle —
    // see pieSlicePath/donutSlicePath's own header comments for the full rationale.
    const halfGapPx = outerR * Math.sin((gapDeg / 2) * (Math.PI / 180))

    ring.slices.forEach((s, si) => {
      const arc = arcs[si]!
      const sweep = arc.end - arc.start
      if (sweep > 0) {
        const d = isRingDonut
          ? donutSlicePath(cx, cy, innerR, outerR, arc.start, arc.end, halfGapPx)
          : pieSlicePath(cx, cy, outerR, arc.start, arc.end, halfGapPx)
        svg.appendChild(svgEl('path', { d, fill: ringSliceColor(node, ring, s, si) }))
      }
    })

    previousArcs = arcs
  })
}
