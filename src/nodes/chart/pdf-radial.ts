// PDF drawing for the merged pie+donut 'radial' chart kind, including multi-ring and sunburst
// (parentIndex-nested) charts — split out of pdf.ts (see that file's header comment). Mirrors
// src/render/chart-render-radial.ts field-for-field on the SVG side.

import type { RadialChartNode } from '../../core/nodes.ts'
import type { PdfRenderCtx } from '../../core/behavior.ts'
import { resolvePdfColor } from '../../render/pdf-render.ts'
import { donutSlicePath, pieSlicePath, resolveRingRadii, resolveRingSliceAngles, ringSliceColor } from '../../render/chart-geometry.ts'
import type { ChartBox, RingSliceAngle } from '../../render/chart-geometry.ts'
import { drawChartPath } from './pdf.ts'

export function drawRadialChart(ctx: PdfRenderCtx, node: RadialChartNode, plot: ChartBox, originX: number, originY: number): void {
  const rings = node.rings
  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const outerRadius = Math.max(0, Math.min(plot.width, plot.height) / 2 - 8)
  const ringRadii = resolveRingRadii(rings.length, node.innerRadiusRatio ?? 0, outerRadius)

  // Ring 0 first, always — see chart-render-radial.ts's renderRadialChart for the full rationale.
  let previousArcs: RingSliceAngle[] | null = null
  rings.forEach((ring, ri) => {
    const arcs = resolveRingSliceAngles(ring.slices, previousArcs)
    const { innerR, outerR } = ringRadii[ri]!
    const isRingDonut = innerR > 0

    const gapDeg = ring.slices.length > 1 ? (ring.sliceGap ?? node.sliceGap ?? 1.5) : 0
    const halfGapPx = outerR * Math.sin((gapDeg / 2) * (Math.PI / 180))

    ring.slices.forEach((s, si) => {
      const arc = arcs[si]!
      const sweep = arc.end - arc.start
      if (sweep > 0) {
        // No border here — separation comes entirely from the offset geometry, so `sliceGap: 0`
        // means genuinely flush slices in the PDF too.
        const d = isRingDonut
          ? donutSlicePath(cx, cy, innerR, outerR, arc.start, arc.end, halfGapPx)
          : pieSlicePath(cx, cy, outerR, arc.start, arc.end, halfGapPx)
        drawChartPath(ctx, d, resolvePdfColor(ringSliceColor(node, ring, s, si)), originX, originY)
      }
    })

    previousArcs = arcs
  })
}
