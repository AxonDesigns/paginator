// Builds the inline <svg> content for a ChartNode. Pure DOM/SVG API usage (createElementNS +
// setAttribute) — no charting library, consistent with this project having none in package.json.
//
// The chart's own width×height box is already fixed by the time this runs (resolved synchronously
// in chart-layout.ts, before any SVG text exists to measure) — see that file's header comment. So
// every internal band (title, legend, axis margins) here is sized by a FIXED heuristic, never by
// measuring rendered text, even though this code technically runs late enough (inside mount(), not
// inside paginate()) that DOM text measurement would be technically possible. Keeping the two
// consistent avoids a chart whose internal proportions silently depend on which pass produced them.
//
// Palette, ink roles, and mark specs (bar thickness cap, line width, marker size, gridline weight,
// legend-presence rule) come from this repo's `dataviz` skill reference palette + mark spec — see
// palette.md / marks-and-anatomy.md. The categorical palette below was run through the skill's
// validate_palette.js (light mode): CVD-safe (worst adjacent ΔE 24.2), three slots (aqua/yellow/
// magenta) fall under 3:1 contrast on a white surface — the "relief" mitigation for that is applied
// throughout below by never coloring TEXT with a series color (labels/ticks/legend text always use
// an ink role; only swatches/marks/fills carry the series hue).

import type { CategoricalChartNode, ChartAxisConfig, ChartNode, ChartSeries, ChartViewConfig, LineChartNode, RadialChartNode } from '../core/nodes.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const CHART_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif'

// dataviz skill reference palette, categorical theme, light mode — fixed order, never cycled per
// the skill's "assign categorical hues in fixed order" rule; wraps via modulo only past 8 series/
// slices, which is an explicit MVP simplification (the skill's own guidance is to fold a 9th series
// into "Other" instead — not attempted here since chart() accepts arbitrary-length series/slices).
export const DEFAULT_CHART_PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834']

export const INK_PRIMARY = '#0b0b0b'
export const INK_SECONDARY = '#52514e'
export const INK_MUTED = '#898781'
export const GRIDLINE_COLOR = '#e1e0d9'
export const AXIS_COLOR = '#c3c2b7'
// Matches the white page background mount() paints pages with (shadow-dom.ts) — used for the
// "surface gap"/"surface ring" separators between touching marks, per the mark spec.
export const SURFACE_COLOR = '#ffffff'

export const BAR_MAX_THICKNESS = 24
export const BAR_CORNER_RADIUS = 4
export const MARK_SURFACE_GAP = 2
export const LINE_STROKE_WIDTH = 2
export const MARKER_RADIUS = 4
export const MARKER_RING_RADIUS = 6

// The white "surface ring" behind a marker stays exactly this many px larger than the marker
// itself, matching the library's default (4px marker / 6px ring) — so an overridden markerRadius
// keeps the same visual relationship rather than needing its own separate ring-radius config.
const MARKER_RING_GAP = MARKER_RING_RADIUS - MARKER_RADIUS

export function resolveMarkerRadii(node: LineChartNode): { radius: number; ringRadius: number } {
  const radius = node.markerRadius ?? MARKER_RADIUS
  return { radius, ringRadius: radius + MARKER_RING_GAP }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K]
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value))
  return el
}

// SVG presentation attributes are kebab-case ("font-size", "font-family"), unlike the camelCase
// `fontSize` every call site passes in — setAttribute('fontSize', …) sets a nonstandard attribute
// name the renderer silently ignores, so this is the one place that translates the ergonomic
// camelCase call-site shape into the attribute names the SVG spec actually recognizes.
function svgText(content: string, x: number, y: number, attrs: Record<string, string | number> & { fontSize?: number; fontFamily?: string }): SVGTextElement {
  const { fontSize, fontFamily, ...rest } = attrs
  const el = svgEl('text', {
    x,
    y,
    'font-family': fontFamily ?? CHART_FONT_FAMILY,
    ...(fontSize !== undefined ? { 'font-size': fontSize } : {}),
    ...rest,
  })
  el.textContent = content
  return el
}

// Rough single-line width heuristic (no text measurement available at this layer by design — see
// header comment) — used only to decide margins/truncation, never to derive final pixel-exact box
// sizes for the chart itself. Exported for reuse by pdf-render.ts's chart drawer, which needs the
// exact same (approximate) positioning math as this file's own SVG rendering.
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58
}

// Approximate baseline offset to vertically center a text element against a target y-coordinate —
// used everywhere a configurable font size replaces what used to be a fixed `fontSize / 2 - 1`
// constant (tick labels, legend entries), so centering stays correct as the size changes.
export function textBaselineOffset(fontSize: number): number {
  return fontSize * 0.35
}

export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.58)) - 1)
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}

// Unique per gradient, not per chart/svg — `renderChartSvg` runs once per ChartNode, but every
// mounted page lives in the SAME shadow root (see shadow-dom.ts's mount()), so two charts sharing an
// unqualified id like "area-fill-0" would collide and make the second chart's fill reference the
// first's gradient. A monotonically increasing module-level counter sidesteps that cheaply.
let areaFillGradientCounter = 0

function ensureDefs(svg: SVGSVGElement): SVGDefsElement {
  const existing = svg.querySelector('defs')
  if (existing !== null) return existing as SVGDefsElement
  const defs = svgEl('defs', {})
  svg.appendChild(defs)
  return defs
}

// `axis` matches areaFillGradientVector's own — the gradient vector runs along whichever axis is
// PERPENDICULAR to the line's progression axis (vertical, x1===x2, for a vertical line chart;
// horizontal, y1===y2, for a horizontal one). `userSpaceOnUse` (rather than the default
// objectBoundingBox) so `from`/`to` can be passed as the exact same local chart-px numbers
// areaPath() itself drew the fill shape in, with no bounding-box-relative reinterpretation.
function appendAreaFillGradient(svg: SVGSVGElement, axis: 'x' | 'y', from: number, to: number, color: string, opacity: number): string {
  const id = `paginator-chart-area-fill-${++areaFillGradientCounter}`
  const gradient = svgEl('linearGradient', {
    id,
    gradientUnits: 'userSpaceOnUse',
    x1: axis === 'x' ? 0 : from,
    y1: axis === 'x' ? from : 0,
    x2: axis === 'x' ? 0 : to,
    y2: axis === 'x' ? to : 0,
  })
  const opaqueStop = svgEl('stop', { offset: '0', 'stop-color': color, 'stop-opacity': opacity })
  const transparentStop = svgEl('stop', { offset: '1', 'stop-color': color, 'stop-opacity': 0 })
  gradient.appendChild(opaqueStop)
  gradient.appendChild(transparentStop)
  ensureDefs(svg).appendChild(gradient)
  return id
}

export function resolveColor(explicit: string | undefined, overridePalette: string[] | undefined, index: number): string {
  if (explicit !== undefined) return explicit
  if (overridePalette !== undefined && overridePalette.length > 0) return overridePalette[index % overridePalette.length]!
  return DEFAULT_CHART_PALETTE[index % DEFAULT_CHART_PALETTE.length]!
}

// Rounded corner on the end AWAY from the baseline, square where it meets the baseline — per the
// mark spec ("4px rounded data-end, square at the baseline"). `round: 'top'` is a bar growing
// upward from the baseline (the common non-negative case); `'bottom'` one growing downward;
// `'none'` a fully square rect — used for every interior segment of a stacked bar, where only the
// outermost segment (furthest from the zero baseline) gets the rounded "data-end" treatment.
// `'left'`/`'right'` are the horizontal-orientation equivalent of `'top'`/`'bottom'` — the caller
// (renderCategoricalChart) is the one that knows whether a given chart is vertical or horizontal;
// this function only knows which literal corners to round.
export function barPath(x: number, y: number, w: number, h: number, round: 'top' | 'bottom' | 'left' | 'right' | 'none', cornerRadius = BAR_CORNER_RADIUS): string {
  if (round === 'none') return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
  if (round === 'top' || round === 'bottom') {
    const r = Math.min(cornerRadius, w / 2, h)
    if (r <= 0) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
    if (round === 'top') {
      return `M ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h} H ${x} Z`
    }
    const bottom = y + h
    return `M ${x} ${y} H ${x + w} V ${bottom - r} A ${r} ${r} 0 0 1 ${x + w - r} ${bottom} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${bottom - r} Z`
  }
  const r = Math.min(cornerRadius, h / 2, w)
  if (r <= 0) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
  if (round === 'right') {
    return `M ${x} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x} Z`
  }
  const right = x + w
  return `M ${x + r} ${y} H ${right} V ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
}

// Default peak opacity (at the line, fading linearly to 0 at the baseline) for an unfilled-in
// `series.fill: true` — see ChartSeriesFillConfig in nodes.ts.
export const DEFAULT_AREA_FILL_OPACITY = 0.25

export function resolveLineFill(series: ChartSeries, resolvedColor: string): { color: string; opacity: number } | null {
  if (!series.fill) return null
  if (series.fill === true) return { color: resolvedColor, opacity: DEFAULT_AREA_FILL_OPACITY }
  return { color: series.fill.color ?? resolvedColor, opacity: series.fill.opacity ?? DEFAULT_AREA_FILL_OPACITY }
}

// Fritsch–Carlson monotone cubic Hermite tangents for a sequence of (coord, value) pairs whose
// `coords` are strictly increasing — the same technique behind d3's curveMonotoneX/Y. Producing a
// per-point tangent this way (rather than, say, a naive Catmull-Rom average of neighboring secants)
// guarantees the resulting curve never overshoots past either endpoint's own value on the segment
// between it and a neighbor — important here since chart data has no "smooth by construction"
// guarantee a hand-drawn curve would.
function monotoneTangents(coords: number[], values: number[]): number[] {
  const n = coords.length
  const tangents = new Array(n).fill(0)
  if (n < 2) return tangents
  const secants: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = coords[i + 1]! - coords[i]!
    secants.push(dx === 0 ? 0 : (values[i + 1]! - values[i]!) / dx)
  }
  tangents[0] = secants[0]!
  tangents[n - 1] = secants[n - 2]!
  for (let i = 1; i < n - 1; i++) {
    const s0 = secants[i - 1]!
    const s1 = secants[i]!
    tangents[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2
  }
  // Fritsch-Carlson monotonicity clamp: rescales a segment's two tangents together, toward the
  // segment's own secant, whenever they'd otherwise pull the curve past a flat/reversing neighbor.
  for (let i = 0; i < n - 1; i++) {
    const s = secants[i]!
    if (s === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    let alpha = tangents[i]! / s
    let beta = tangents[i + 1]! / s
    if (alpha < 0) tangents[i] = 0
    if (beta < 0) tangents[i + 1] = 0
    alpha = tangents[i]! / s
    beta = tangents[i + 1]! / s
    const mag = alpha * alpha + beta * beta
    if (mag > 9) {
      const tau = 3 / Math.sqrt(mag)
      tangents[i] = tau * alpha * s
      tangents[i + 1] = tau * beta * s
    }
  }
  return tangents
}

// `axis` names which of the point's two coordinates is the strictly-increasing "progression" one —
// categories along x for a vertical line chart, categories along y for a horizontal one (see
// renderHorizontalCategoricalChart's header comment) — so this one function serves both
// orientations instead of a duplicated axis-specific copy, unlike renderCategoricalChart's own
// vertical/horizontal split (there, margins/anchors/labels differ per axis; here only which
// coordinate plays which role differs, so a single parameterized function stays clear).
export function linePath(points: readonly (readonly [number, number])[], curve: 'linear' | 'monotone', axis: 'x' | 'y'): string {
  if (points.length === 0) return ''
  if (points.length === 1 || curve === 'linear') {
    return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
  }
  const coords = points.map(p => (axis === 'x' ? p[0] : p[1]))
  const values = points.map(p => (axis === 'x' ? p[1] : p[0]))
  const tangents = monotoneTangents(coords, values)
  let d = `M ${points[0]![0]} ${points[0]![1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const c0 = coords[i]!
    const v0 = values[i]!
    const c1 = coords[i + 1]!
    const v1 = values[i + 1]!
    const dc = (c1 - c0) / 3
    const cp1v = v0 + tangents[i]! * dc
    const cp2v = v1 - tangents[i + 1]! * dc
    const cp1 = axis === 'x' ? [c0 + dc, cp1v] : [cp1v, c0 + dc]
    const cp2 = axis === 'x' ? [c1 - dc, cp2v] : [cp2v, c1 - dc]
    const end = axis === 'x' ? [c1, v1] : [v1, c1]
    d += ` C ${cp1[0]} ${cp1[1]} ${cp2[0]} ${cp2[1]} ${end[0]} ${end[1]}`
  }
  return d
}

// Same line, closed down to the baseline (a straight edge, never curved) to form a fillable area —
// `baselineCoord` is a single fixed pixel coordinate on the axis PERPENDICULAR to `axis` (the
// y-coordinate of the value baseline for a vertical chart, or its x-coordinate for a horizontal
// one), matching the same baseline bars grow from (see barBaselineValue in the two render*Chart
// functions) so a fill and a bar chart of the same data would bound the same area.
export function areaPath(points: readonly (readonly [number, number])[], curve: 'linear' | 'monotone', axis: 'x' | 'y', baselineCoord: number): string {
  if (points.length === 0) return ''
  const line = linePath(points, curve, axis)
  const first = points[0]!
  const last = points[points.length - 1]!
  if (axis === 'x') return `${line} L ${last[0]} ${baselineCoord} L ${first[0]} ${baselineCoord} Z`
  return `${line} L ${baselineCoord} ${last[1]} L ${baselineCoord} ${first[1]} Z`
}

// The two endpoints (in local chart px, along the axis perpendicular to `axis`) of the gradient
// vector an area fill fades along: opaque at `from` — the series' own extreme point, on whichever
// side of the baseline its data actually sits — transparent at `to`, always the baseline itself.
// Comparing the AVERAGE perpendicular coordinate against the baseline (rather than assuming
// "values are always positive, baseline is always at the bottom/right") is what makes this work
// for an all-negative series too, where the baseline sits at the near edge instead of the far one.
export function areaFillGradientVector(points: readonly (readonly [number, number])[], axis: 'x' | 'y', baselineCoord: number): { from: number; to: number } {
  const perp = points.map(p => (axis === 'x' ? p[1] : p[0]))
  const avgPerp = perp.reduce((a, b) => a + b, 0) / perp.length
  const from = avgPerp <= baselineCoord ? Math.min(...perp) : Math.max(...perp)
  return { from, to: baselineCoord }
}

export type StackedSegment = {
  seriesIndex: number
  valueStart: number
  valueEnd: number
  round: 'top' | 'bottom' | 'none'
  /** True only for the single segment sitting flush against the TRUE zero baseline — i.e. there's
   *  no segment on the other side of zero for this category. When both positive and negative values
   *  are present, the zero line is an INTERNAL boundary shared by two touching segments (the last
   *  positive one and the first negative one) and gets the same gap inset as any other boundary. */
  startIsBaseline: boolean
}

// Splits one category's per-series values into stacked segments: positive values stack upward from
// zero, negative values stack downward, each in original series order (zero values contribute no
// segment). Pure value-space geometry — shared unchanged between chart-render.ts (SVG) and
// pdf-render.ts, same as barPath/pieSlicePath/donutSlicePath above.
export function stackedBarSegments(values: number[]): StackedSegment[] {
  const segments: StackedSegment[] = []
  const positive = values.map((v, i) => [v, i] as const).filter(([v]) => v > 0)
  const negative = values.map((v, i) => [v, i] as const).filter(([v]) => v < 0)
  // Only a true, ungapped baseline when nothing occupies the other side of zero — otherwise
  // "touching" positive and negative stacks share that boundary just like any two segments.
  const zeroIsTrueBaseline = positive.length === 0 || negative.length === 0

  let cum = 0
  positive.forEach(([v, i], j) => {
    const valueStart = cum
    cum += v
    segments.push({ seriesIndex: i, valueStart, valueEnd: cum, round: j === positive.length - 1 ? 'top' : 'none', startIsBaseline: j === 0 && zeroIsTrueBaseline })
  })
  cum = 0
  negative.forEach(([v, i], j) => {
    const valueStart = cum
    cum += v
    segments.push({ seriesIndex: i, valueStart, valueEnd: cum, round: j === negative.length - 1 ? 'bottom' : 'none', startIsBaseline: j === 0 && zeroIsTrueBaseline })
  })
  return segments
}

// Converts one stacked segment's value-space range to a pixel (coordStart, length) span along
// whichever axis `scale` maps values onto — the y-axis for a vertical chart (where larger values
// produce SMALLER pixel coordinates) or the x-axis for a horizontal one (larger values produce
// LARGER coordinates). Direction-agnostic by construction: it insets each edge toward the OTHER
// edge (`dir`, derived from the actual pixel-space relationship, not assumed from value-space) by
// `gap` at every INTERNAL boundary (shared with a neighboring segment), while leaving the true
// zero-baseline edge and the outermost tip edge flush — the "surface gap separates touching marks"
// rule applied to a stack instead of to adjacent bars. Returns null when the inset leaves nothing
// visible (a segment small enough that the gap consumes its whole span).
export function stackedSegmentPixelRange(seg: StackedSegment, scale: (value: number) => number, gap: number): { coordStart: number; length: number } | null {
  let pBaselineEdge = scale(seg.valueStart)
  let pTipEdge = scale(seg.valueEnd)
  const dir = pTipEdge >= pBaselineEdge ? 1 : -1 // pixel-space direction from the baseline edge toward the tip edge
  if (!seg.startIsBaseline) pBaselineEdge += dir * (gap / 2)
  if (seg.round === 'none') pTipEdge -= dir * (gap / 2)
  const coordMin = Math.min(pBaselineEdge, pTipEdge)
  const coordMax = Math.max(pBaselineEdge, pTipEdge)
  const length = coordMax - coordMin
  return length > 0 ? { coordStart: coordMin, length } : null
}

// Unit vector along the radial line at angleDeg, and the unit vector perpendicular to it that
// points toward INCREASING angle (verified by construction: nudging a point on the radial line by
// an infinitesimal +perpDir lands at angleDeg+ε, matching the small-angle addition formulas for
// sin/cos) — the two building blocks every offset-edge computation below is expressed in terms of.
function radialDir(angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [Math.cos(rad), Math.sin(rad)]
}
function perpDir(angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [-Math.sin(rad), Math.cos(rad)]
}

// The point at `radius` from center on the line that runs PARALLEL to (not through) the true
// radial line at `angleDeg`, offset perpendicular to it by `halfGapPx` toward increasing angle
// (sign=1) or decreasing angle (sign=-1). Because perpDir/radialDir are orthonormal, the offset
// point at parameter t is center + halfGapPx*perp + t*radial, and |halfGapPx*perp + t*radial| = R
// reduces to halfGapPx^2 + t^2 = R^2 by Pythagoras — no general line/circle intersection needed.
function offsetEdgePoint(cx: number, cy: number, angleDeg: number, halfGapPx: number, sign: 1 | -1, radius: number): [number, number] {
  const perp = perpDir(angleDeg)
  const radial = radialDir(angleDeg)
  const d = sign * Math.min(halfGapPx, radius * 0.999) // keeps t real or a hair above zero, however large the configured gap
  const t = Math.sqrt(Math.max(radius * radius - d * d, 0))
  return [cx + d * perp[0] + t * radial[0], cy + d * perp[1] + t * radial[1]]
}

// Intersection of this slice's two offset edge lines (its start boundary, offset toward increasing
// angle, and its end boundary, offset toward decreasing angle) — the slice's true apex once a gap
// pulls it back from the circle's exact center, per the geometry: a constant-width gap channel
// (rather than an angular wedge that tapers to nothing at r=0) requires the inner vertex to move
// off-center by an amount that grows as the slice narrows or the gap widens. Falls back to the
// circle's own center if the two edges are parallel (a slice of exactly 180°, i.e. det≈0) — the
// only configuration where they never meet.
function offsetApex(cx: number, cy: number, startAngleDeg: number, endAngleDeg: number, halfGapPx: number): [number, number] {
  const p1 = perpDir(startAngleDeg)
  const u1 = radialDir(startAngleDeg)
  const u2 = radialDir(endAngleDeg)
  const q1: [number, number] = [cx + halfGapPx * p1[0], cy + halfGapPx * p1[1]]
  const p2 = perpDir(endAngleDeg)
  const q2: [number, number] = [cx - halfGapPx * p2[0], cy - halfGapPx * p2[1]]
  const det = u2[0] * u1[1] - u1[0] * u2[1]
  if (Math.abs(det) < 1e-9) return [cx, cy]
  const rx = q2[0] - q1[0]
  const ry = q2[1] - q1[1]
  const t1 = (-rx * u2[1] + u2[0] * ry) / det
  return [q1[0] + t1 * u1[0], q1[1] + t1 * u1[1]]
}

// `startAngle`/`endAngle` are this slice's TRUE, un-trimmed boundary angles (shared with its
// neighbors) — unlike the old angle-trim approach, nothing here shrinks the angular range; the gap
// comes entirely from offsetting the edges perpendicular to those true boundaries, so it stays a
// constant `halfGapPx*2` wide from the apex all the way to the rim instead of tapering to zero at
// the center. `halfGapPx: 0` degenerates exactly to the no-gap case (apex = true center).
export function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, halfGapPx = 0): string {
  const apex = offsetApex(cx, cy, startAngle, endAngle, halfGapPx)
  const p0 = offsetEdgePoint(cx, cy, startAngle, halfGapPx, 1, r)
  const p1 = offsetEdgePoint(cx, cy, endAngle, halfGapPx, -1, r)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${apex[0]} ${apex[1]} L ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${largeArc} 1 ${p1[0]} ${p1[1]} Z`
}

// Same constant-width-gap construction as pieSlicePath, applied to BOTH the outer and inner rim —
// the inner straight edges are offset exactly like the outer ones (same halfGapPx, same true
// boundary angles), so the channel is the same width at the inner rim as the outer one instead of
// narrowing (an angle-trim gap would subtend a smaller arc, hence a visually thinner gap, at the
// smaller inner radius).
export function donutSlicePath(cx: number, cy: number, rInner: number, rOuter: number, startAngle: number, endAngle: number, halfGapPx = 0): string {
  const o0 = offsetEdgePoint(cx, cy, startAngle, halfGapPx, 1, rOuter)
  const o1 = offsetEdgePoint(cx, cy, endAngle, halfGapPx, -1, rOuter)
  const i1 = offsetEdgePoint(cx, cy, endAngle, halfGapPx, -1, rInner)
  const i0 = offsetEdgePoint(cx, cy, startAngle, halfGapPx, 1, rInner)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${o0[0]} ${o0[1]} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o1[0]} ${o1[1]} L ${i1[0]} ${i1[1]} A ${rInner} ${rInner} 0 ${largeArc} 0 ${i0[0]} ${i0[1]} Z`
}

export type ChartBox = { x: number; y: number; width: number; height: number }
type Box = ChartBox
export type LegendEntry = { label: string; color: string }

export function resolveTitle(node: ChartNode): { text: string; fontSize: number; color: string } | null {
  if (node.title === undefined) return null
  if (typeof node.title === 'string') return { text: node.title, fontSize: 14, color: INK_PRIMARY }
  return { text: node.title.text, fontSize: node.title.fontSize ?? 14, color: node.title.color ?? INK_PRIMARY }
}

export function legendEntriesFor(node: ChartNode): LegendEntry[] {
  if (node.chartKind === 'pie' || node.chartKind === 'donut') {
    return node.slices.map((s, i) => ({ label: s.label, color: resolveColor(s.color, node.colors, i) }))
  }
  return node.series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, color: resolveColor(s.color, node.colors, i) }))
}

// Default legend visibility per the dataviz skill's rule: always present for >=2 series/slices
// (color is the only identity channel), never a lone single-swatch box for one series.
export function resolveShowLegend(node: ChartNode, entryCount: number): boolean {
  if (node.legend?.show !== undefined) return node.legend.show
  if (node.chartKind === 'pie' || node.chartKind === 'donut') return true
  return entryCount > 1
}


function renderLegend(svg: SVGSVGElement, entries: LegendEntry[], box: Box, orientation: 'vertical' | 'horizontal', fontSize: number, fontFamily: string, color: string): void {
  const swatch = 10
  const baselineOffset = textBaselineOffset(fontSize)

  if (orientation === 'vertical') {
    const rowHeight = Math.max(swatch + 4, fontSize + 9)
    const maxRows = Math.max(0, Math.floor(box.height / rowHeight))
    entries.slice(0, maxRows).forEach((entry, i) => {
      const rowCenterY = box.y + i * rowHeight + rowHeight / 2
      svg.appendChild(svgEl('rect', { x: box.x, y: rowCenterY - swatch / 2, width: swatch, height: swatch, rx: 2, fill: entry.color }))
      const label = truncateToWidth(entry.label, box.width - swatch - 6, fontSize)
      svg.appendChild(svgText(label, box.x + swatch + 6, rowCenterY + baselineOffset, { fontSize, fontFamily, fill: color }))
    })
    return
  }

  let x = box.x
  const centerY = box.y + box.height / 2
  for (const entry of entries) {
    const labelMaxWidth = 90
    const label = truncateToWidth(entry.label, labelMaxWidth, fontSize)
    const labelWidth = Math.min(labelMaxWidth, estimateTextWidth(label, fontSize))
    const entryWidth = swatch + 6 + labelWidth
    if (x + entryWidth > box.x + box.width) break // remaining entries dropped rather than overflowing the box
    svg.appendChild(svgEl('rect', { x, y: centerY - swatch / 2, width: swatch, height: swatch, rx: 2, fill: entry.color }))
    svg.appendChild(svgText(label, x + swatch + 6, centerY + baselineOffset, { fontSize, fontFamily, fill: color }))
    x += entryWidth + 14
  }
}

// Shared by chart-render.ts (SVG) and pdf-render.ts, same as the other pure per-chart-kind geometry
// above (stackedBarSegments, barPath, ...) — keeps the domain math itself in exactly one place
// rather than duplicated field-for-field between the two renderers.
export function resolveChartDomain(categories: string[], series: ChartSeries[], stacked: boolean, view: ChartViewConfig): { dataMin: number; dataMax: number } {
  let rawMin: number
  let rawMax: number
  if (stacked) {
    // The tallest POSITIVE stack and the deepest NEGATIVE stack per category, not the single
    // largest raw value — a stacked bar's visual extent is the sum of its segments. Each sum is
    // already <=0/>=0 by construction (reduce starts at 0 and only adds same-signed values), so it
    // already carries an implicit zero bound with no separate Math.min(0, ...)/Math.max(0, ...) —
    // unlike the non-stacked branch below, where the raw data can sit entirely off to one side of 0.
    const positiveSums = categories.map((_, ci) => series.reduce((acc, s) => acc + Math.max(0, s.data[ci]!), 0))
    const negativeSums = categories.map((_, ci) => series.reduce((acc, s) => acc + Math.min(0, s.data[ci]!), 0))
    rawMin = Math.min(...negativeSums)
    rawMax = Math.max(...positiveSums)
  } else {
    const allValues = series.flatMap(s => s.data)
    rawMin = Math.min(...allValues)
    rawMax = Math.max(...allValues)
  }

  const domain = view.domain
  let dataMin: number
  let dataMaxRaw: number
  if (domain === 'auto') {
    // Tight to the data's own extent — deliberately NOT forced through zero — then widened by a
    // fraction of that extent on each side so the single lowest/highest mark isn't drawn flush
    // against the plot's own edge (a bar there would render at zero height).
    const padding = view.padding ?? 0.1
    const pad = (rawMax - rawMin) * padding
    dataMin = rawMin - pad
    dataMaxRaw = rawMax + pad
  } else {
    // `'zero'` (default), and also the base that an explicit `{min, max}` override's UNSET bound
    // falls back to — see ChartViewConfig.domain's header comment.
    dataMin = Math.min(0, rawMin)
    dataMaxRaw = Math.max(0, rawMax)
  }
  // An explicit object wins outright over whichever auto mode ran above — chart() already
  // validated min < max when both are set.
  if (typeof domain === 'object') {
    if (domain.min !== undefined) dataMin = domain.min
    if (domain.max !== undefined) dataMaxRaw = domain.max
  }
  const dataMax = dataMaxRaw > dataMin ? dataMaxRaw : dataMin + 1 // avoid a zero-height domain (flat/all-zero data, or a zero-width auto-padded range)
  return { dataMin, dataMax }
}

export function niceTickValues(min: number, max: number, tickCount: number): number[] {
  if (max <= min) return [min]
  const ticks: number[] = []
  for (let i = 0; i <= tickCount; i++) ticks.push(min + ((max - min) * i) / tickCount)
  return ticks
}

// Vertical/horizontal are handled as two dedicated code paths rather than one generic axis-agnostic
// function — same reasoning group-layout.ts gives for layoutRow/layoutColumn: forcing both through
// one path would obscure which concrete axis carries which kind of label (ticks vs. categories,
// each with a different margin/anchor/offset), and the two are similar enough to keep side by side
// but different enough that a forced abstraction would cost more clarity than it saves.
function renderCategoricalChart(svg: SVGSVGElement, node: CategoricalChartNode, plot: Box): void {
  const categories = node.categories
  const series = node.series
  const colors = series.map((s, i) => resolveColor(s.color, node.colors, i))

  const stacked = node.chartKind === 'bar' && (node.barMode ?? 'grouped') === 'stacked'
  const { dataMin, dataMax } = resolveChartDomain(categories, series, stacked, node.view ?? {})
  const axis: ChartAxisConfig = node.axis ?? {}
  // Bars conventionally grow from zero, but if the visible domain doesn't include it (e.g. a
  // zoomed-in view.domain like {min: 50, max: 80}, or an 'auto' domain over all-positive data),
  // there's nothing sensible to grow from except the domain's own nearer edge — same visual effect
  // as a value bar simply getting clipped at the plot boundary.
  const barBaselineValue = Math.max(dataMin, Math.min(dataMax, 0))
  const axisShow = axis.show !== false
  const gridlinesShow = axisShow && axis.gridlines !== false
  const tickCount = axis.tickCount ?? 5
  const formatTick = axis.formatTick ?? ((v: number) => Math.round(v).toLocaleString())
  const ticks = niceTickValues(dataMin, dataMax, tickCount)
  const tickFontSize = axis.tickFontSize ?? 11
  const categoryFontSize = axis.categoryFontSize ?? 11
  const tickBaselineOffset = textBaselineOffset(tickFontSize)
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY
  const axisColor = axis.color ?? AXIS_COLOR
  const gridlineColor = axis.gridlineColor ?? GRIDLINE_COLOR
  const tickColor = axis.tickColor ?? INK_MUTED

  if ((node.orientation ?? 'vertical') === 'horizontal') {
    renderHorizontalCategoricalChart(svg, node, plot, {
      categories,
      series,
      colors,
      stacked,
      dataMin,
      dataMax,
      barBaselineValue,
      axisShow,
      gridlinesShow,
      ticks,
      formatTick,
      tickFontSize,
      categoryFontSize,
      tickBaselineOffset,
      fontFamily,
      axisColor,
      gridlineColor,
      tickColor,
    })
    return
  }

  // Distance from the plot's bottom axis line down to the category label's text baseline — scales
  // with categoryFontSize so a bigger label doesn't collide with the axis line above it.
  const categoryLabelOffset = categoryFontSize + 8

  const leftMargin = axisShow ? Math.max(30, Math.max(...ticks.map(t => estimateTextWidth(formatTick(t), tickFontSize))) + 20) : 4
  const bottomMargin = axisShow ? categoryLabelOffset + 6 : 4

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - 8
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const yScale = (value: number): number => plotBottom - ((value - dataMin) / (dataMax - dataMin)) * plotHeight

  if (gridlinesShow) {
    for (const tick of ticks) {
      const y = yScale(tick)
      svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: y, y2: y, stroke: gridlineColor, 'stroke-width': 1 }))
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const y = yScale(tick)
      svg.appendChild(svgText(formatTick(tick), plotLeft - 8, y + tickBaselineOffset, { fontSize: tickFontSize, fontFamily, fill: tickColor, 'text-anchor': 'end' }))
    }
    svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: plotBottom, y2: plotBottom, stroke: axisColor, 'stroke-width': 1 }))
  }

  const bandWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth
  const labelEstWidth = Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize)), 1)
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstWidth / Math.max(bandWidth, 1))) : Infinity

  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const x = plotLeft + bandWidth * (ci + 0.5)
      svg.appendChild(svgText(category, x, plotBottom + categoryLabelOffset, { fontSize: categoryFontSize, fontFamily, fill: tickColor, 'text-anchor': 'middle' }))
    })
  }

  if (node.chartKind === 'bar' && stacked) {
    const segmentGap = node.barSegmentGap ?? 0
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandWidth - MARK_SURFACE_GAP * 2))
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandX = plotLeft + bandWidth * ci
      const barX = bandX + (bandWidth - barThickness) / 2
      const values = series.map(s => s.data[ci]!)
      for (const seg of stackedBarSegments(values)) {
        const range = stackedSegmentPixelRange(seg, yScale, segmentGap)
        if (range === null) continue
        svg.appendChild(svgEl('path', { d: barPath(barX, range.coordStart, barThickness, range.length, seg.round, cornerRadius), fill: colors[seg.seriesIndex]! }))
      }
    })
    return
  }

  if (node.chartKind === 'bar') {
    const rawThickness = (bandWidth - MARK_SURFACE_GAP * (series.length + 1)) / Math.max(series.length, 1)
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness))
    const groupWidth = barThickness * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)
    const zeroY = yScale(barBaselineValue)
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandX = plotLeft + bandWidth * ci
      const groupStart = bandX + (bandWidth - groupWidth) / 2
      series.forEach((s, si) => {
        const value = s.data[ci]!
        const barX = groupStart + si * (barThickness + MARK_SURFACE_GAP)
        const valueY = yScale(value)
        const barY = Math.min(zeroY, valueY)
        const barH = Math.abs(valueY - zeroY)
        if (barH <= 0) return
        svg.appendChild(svgEl('path', { d: barPath(barX, barY, barThickness, barH, value >= barBaselineValue ? 'top' : 'bottom', cornerRadius), fill: colors[si]! }))
      })
    })
    return
  }

  // Line chart.
  const curve = node.lineCurve ?? 'linear'
  const lineStrokeWidth = node.lineStrokeWidth ?? LINE_STROKE_WIDTH
  const { radius: markerRadius, ringRadius: markerRingRadius } = resolveMarkerRadii(node)
  series.forEach((s, si) => {
    const points = categories.map((_, ci) => {
      const x = plotLeft + bandWidth * (ci + 0.5)
      return [x, yScale(s.data[ci]!)] as const
    })
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      const baselineY = yScale(barBaselineValue)
      const { from, to } = areaFillGradientVector(points, 'x', baselineY)
      const gradientId = appendAreaFillGradient(svg, 'x', from, to, fill.color, fill.opacity)
      svg.appendChild(svgEl('path', { d: areaPath(points, curve, 'x', baselineY), fill: `url(#${gradientId})` }))
    }
    svg.appendChild(
      svgEl('path', {
        d: linePath(points, curve, 'x'),
        fill: 'none',
        stroke: colors[si]!,
        'stroke-width': lineStrokeWidth,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    )
    for (const [x, y] of points) {
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRingRadius, fill: SURFACE_COLOR }))
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRadius, fill: colors[si]! }))
    }
  })
}

type CategoricalChartContext = {
  categories: string[]
  series: ChartSeries[]
  colors: string[]
  stacked: boolean
  dataMin: number
  dataMax: number
  barBaselineValue: number
  axisShow: boolean
  gridlinesShow: boolean
  ticks: number[]
  formatTick: (value: number) => string
  tickFontSize: number
  categoryFontSize: number
  tickBaselineOffset: number
  fontFamily: string
  axisColor: string
  gridlineColor: string
  tickColor: string
}

// Categories run top-to-bottom along the y-axis; values run left-to-right along the x-axis (bars
// grow rightward, or leftward below the baseline). Mirrors the vertical path above field-for-field
// with the two axes' roles swapped — see that function's header comment for why this is a separate
// path rather than a shared abstraction.
function renderHorizontalCategoricalChart(svg: SVGSVGElement, node: CategoricalChartNode, plot: Box, ctx: CategoricalChartContext): void {
  const { categories, series, colors, stacked, dataMin, dataMax, barBaselineValue, axisShow, gridlinesShow, ticks, formatTick, tickFontSize, categoryFontSize, tickBaselineOffset, fontFamily, axisColor, gridlineColor, tickColor } =
    ctx

  const leftMargin = axisShow ? Math.max(30, Math.max(...categories.map(c => estimateTextWidth(c, categoryFontSize))) + 16) : 4
  const bottomMargin = axisShow ? tickFontSize + 20 : 4

  const plotLeft = plot.x + leftMargin
  const plotRight = plot.x + plot.width - 8
  const plotTop = plot.y + 8
  const plotBottom = plot.y + plot.height - bottomMargin
  const plotWidth = Math.max(0, plotRight - plotLeft)
  const plotHeight = Math.max(0, plotBottom - plotTop)

  const xScale = (value: number): number => plotLeft + ((value - dataMin) / (dataMax - dataMin)) * plotWidth

  if (gridlinesShow) {
    for (const tick of ticks) {
      const x = xScale(tick)
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: plotTop, y2: plotBottom, stroke: gridlineColor, 'stroke-width': 1 }))
    }
  }
  if (axisShow) {
    for (const tick of ticks) {
      const x = xScale(tick)
      svg.appendChild(svgText(formatTick(tick), x, plotBottom + tickFontSize + 4, { fontSize: tickFontSize, fontFamily, fill: tickColor, 'text-anchor': 'middle' }))
    }
    svg.appendChild(svgEl('line', { x1: plotLeft, x2: plotLeft, y1: plotTop, y2: plotBottom, stroke: axisColor, 'stroke-width': 1 }))
  }

  const bandHeight = categories.length > 0 ? plotHeight / categories.length : plotHeight
  const labelEstHeight = categoryFontSize + 4
  const labelStep = axisShow ? Math.max(1, Math.ceil(labelEstHeight / Math.max(bandHeight, 1))) : Infinity

  if (axisShow) {
    categories.forEach((category, ci) => {
      if (ci % labelStep !== 0) return
      const y = plotTop + bandHeight * (ci + 0.5)
      svg.appendChild(svgText(category, plotLeft - 8, y + tickBaselineOffset, { fontSize: categoryFontSize, fontFamily, fill: tickColor, 'text-anchor': 'end' }))
    })
  }

  if (node.chartKind === 'bar' && stacked) {
    const segmentGap = node.barSegmentGap ?? 0
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, bandHeight - MARK_SURFACE_GAP * 2))
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandY = plotTop + bandHeight * ci
      const barY = bandY + (bandHeight - barThickness) / 2
      const values = series.map(s => s.data[ci]!)
      for (const seg of stackedBarSegments(values)) {
        const range = stackedSegmentPixelRange(seg, xScale, segmentGap)
        if (range === null) continue
        const round = seg.round === 'top' ? 'right' : seg.round === 'bottom' ? 'left' : 'none'
        svg.appendChild(svgEl('path', { d: barPath(range.coordStart, barY, range.length, barThickness, round, cornerRadius), fill: colors[seg.seriesIndex]! }))
      }
    })
    return
  }

  if (node.chartKind === 'bar') {
    const rawThickness = (bandHeight - MARK_SURFACE_GAP * (series.length + 1)) / Math.max(series.length, 1)
    const barThickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, rawThickness))
    const groupHeight = barThickness * series.length + MARK_SURFACE_GAP * Math.max(series.length - 1, 0)
    const zeroX = xScale(barBaselineValue)
    const cornerRadius = node.barCornerRadius ?? BAR_CORNER_RADIUS

    categories.forEach((_, ci) => {
      const bandY = plotTop + bandHeight * ci
      const groupStart = bandY + (bandHeight - groupHeight) / 2
      series.forEach((s, si) => {
        const value = s.data[ci]!
        const barY = groupStart + si * (barThickness + MARK_SURFACE_GAP)
        const valueX = xScale(value)
        const barX = Math.min(zeroX, valueX)
        const barW = Math.abs(valueX - zeroX)
        if (barW <= 0) return
        svg.appendChild(svgEl('path', { d: barPath(barX, barY, barW, barThickness, value >= barBaselineValue ? 'right' : 'left', cornerRadius), fill: colors[si]! }))
      })
    })
    return
  }

  // Line chart.
  const curve = node.lineCurve ?? 'linear'
  const lineStrokeWidth = node.lineStrokeWidth ?? LINE_STROKE_WIDTH
  const { radius: markerRadius, ringRadius: markerRingRadius } = resolveMarkerRadii(node)
  series.forEach((s, si) => {
    const points = categories.map((_, ci) => {
      const y = plotTop + bandHeight * (ci + 0.5)
      return [xScale(s.data[ci]!), y] as const
    })
    const fill = resolveLineFill(s, colors[si]!)
    if (fill !== null) {
      const baselineX = xScale(barBaselineValue)
      const { from, to } = areaFillGradientVector(points, 'y', baselineX)
      const gradientId = appendAreaFillGradient(svg, 'y', from, to, fill.color, fill.opacity)
      svg.appendChild(svgEl('path', { d: areaPath(points, curve, 'y', baselineX), fill: `url(#${gradientId})` }))
    }
    svg.appendChild(
      svgEl('path', {
        d: linePath(points, curve, 'y'),
        fill: 'none',
        stroke: colors[si]!,
        'stroke-width': lineStrokeWidth,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    )
    for (const [x, y] of points) {
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRingRadius, fill: SURFACE_COLOR }))
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: markerRadius, fill: colors[si]! }))
    }
  })
}

function renderPieChart(svg: SVGSVGElement, node: RadialChartNode, plot: Box): void {
  const slices = node.slices
  const colors = slices.map((s, i) => resolveColor(s.color, node.colors, i))
  const total = slices.reduce((acc, s) => acc + s.value, 0) || 1

  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const radius = Math.max(0, Math.min(plot.width, plot.height) / 2 - 8)
  const isDonut = node.chartKind === 'donut'
  const innerRadius = node.chartKind === 'donut' ? radius * (node.donutInnerRadiusRatio ?? 0.6) : 0

  const gapDeg = slices.length > 1 ? (node.sliceGap ?? 1.5) : 0
  // Converted to a constant PIXEL half-width (evaluated at the outer radius) rather than trimmed
  // straight off the angle: pieSlicePath/donutSlicePath offset each slice's straight edges by this
  // many px perpendicular to its true boundary, so the gap stays this wide from the apex/inner rim
  // all the way to the outer rim, instead of an angular wedge that tapers to nothing at the center.
  // `sin` (not the small-angle `gapRad/2` itself) keeps the outer-rim gap position exact, not just
  // an approximation, and matches the old angle-trimmed model's rim position when gapDeg is small.
  const halfGapPx = radius * Math.sin((gapDeg / 2) * (Math.PI / 180))
  let angle = -90
  slices.forEach((s, i) => {
    const sweep = (s.value / total) * 360
    if (sweep > 0) {
      // No stroke here — separation between slices comes entirely from the offset geometry above,
      // so `sliceGap: 0` means genuinely flush slices. A surface-color stroke would otherwise
      // persist as a visible seam even at zero gap, since stroke-width doesn't participate at all.
      const d = isDonut
        ? donutSlicePath(cx, cy, innerRadius, radius, angle, angle + sweep, halfGapPx)
        : pieSlicePath(cx, cy, radius, angle, angle + sweep, halfGapPx)
      svg.appendChild(svgEl('path', { d, fill: colors[i]! }))
    }
    angle += sweep
  })
}

export function renderChartSvg(node: ChartNode, width: number, height: number): SVGSVGElement {
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` })
  const fontFamily = node.fontFamily ?? CHART_FONT_FAMILY

  let top = 0
  let bottom = height
  let left = 0
  let right = width

  const title = resolveTitle(node)
  if (title !== null) {
    const band = title.fontSize + 16
    svg.appendChild(svgText(title.text, width / 2, top + title.fontSize + 4, { fontSize: title.fontSize, fontFamily, fill: title.color, 'text-anchor': 'middle' }))
    top += band
  }

  const entries = legendEntriesFor(node)
  if (resolveShowLegend(node, entries.length) && entries.length > 0) {
    const legendFontSize = node.legend?.fontSize ?? 11
    const legendColor = node.legend?.color ?? INK_SECONDARY
    const position = node.legend?.position ?? 'right'
    if (position === 'right') {
      const legendWidth = Math.min(140, width * 0.28)
      right -= legendWidth
      renderLegend(svg, entries, { x: right + 12, y: top, width: legendWidth - 12, height: bottom - top }, 'vertical', legendFontSize, fontFamily, legendColor)
    } else {
      const legendHeight = Math.max(24, legendFontSize + 14)
      bottom -= legendHeight
      renderLegend(svg, entries, { x: left, y: bottom, width: right - left, height: legendHeight }, 'horizontal', legendFontSize, fontFamily, legendColor)
    }
  }

  const plot: Box = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  if (node.chartKind === 'bar' || node.chartKind === 'line') {
    renderCategoricalChart(svg, node, plot)
  } else {
    renderPieChart(svg, node, plot)
  }

  return svg
}
