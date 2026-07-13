import { chart, group, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

// Final third of the "Charts" section: gantt, radar, candlestick, and treemap. Continued from
// charts-1.ts / charts-2.ts.
export const chartsSection3: Node[] = [
  text({
    content: `chartKind: "gantt" plots tasks as pill-shaped bars over a single numeric time axis (xAxis/xView — the same ChartNumericAxisConfig scatter's axes use, defaulting to 'auto' rather than 'zero' for the same reason). Task start/end are plain numbers, never Date objects — this library does no date math anywhere, so a real schedule is pre-converted to numeric offsets by the caller, with xAxis.formatTick rendering them back as dates. Tasks sharing a "group" value in a CONTIGUOUS run get a header band above them — deliberately much simpler than table's column grouping: no reordering, no aggregation, just a divider wherever the group value changes. Header bands are themeable: groupHeaderColor/groupHeaderBackground set a chart-wide default, and a "groups" lookup (keyed by group name) overrides either for one group's own band specifically — below, "Build" gets its own color while every other band falls back to the chart-level default. Task row-label text is independently themeable too: taskLabelColor sets a chart-wide default, and a task's own labelColor overrides it — independent of that task's bar color entirely (below, "Launch" gets a red label to flag it as the critical milestone, while its bar stays the default palette color).`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  chart({
    chartKind: 'gantt',
    height: 260,
    title: 'Product Launch Plan',
    xAxis: { formatTick: v => `Day ${Math.round(v)}` },
    groupHeaderColor: '#4a3aa7',
    groupHeaderBackground: '#efecfb',
    groups: {
      Build: { color: '#8a5a00', background: '#fdf1d8' },
    },
    taskLabelColor: '#52514e',
    tasks: [
      { label: 'Kickoff', start: 0, end: 0, group: 'Discovery' },
      { label: 'User Research', start: 0, end: 8, group: 'Discovery' },
      { label: 'Wireframes', start: 6, end: 14, group: 'Design' },
      { label: 'Visual Design', start: 12, end: 24, group: 'Design' },
      { label: 'Backend API', start: 14, end: 34, group: 'Build' },
      { label: 'Frontend UI', start: 20, end: 38, group: 'Build' },
      { label: 'Integration', start: 34, end: 42, group: 'Build' },
      { label: 'QA Pass', start: 40, end: 48, group: 'Launch' },
      { label: 'Launch', start: 48, end: 48, group: 'Launch', labelColor: '#b3261e' },
    ],
  }),
  text({
    content: 'groupHeaderColor/Background (purple default, amber "Build" override) + taskLabelColor (default) with a per-task labelColor override on "Launch"',
    fontFamily: UI_FONT,
    fontSize: 11,
    color: '#666666',
    align: 'center',
  }),
  text({
    content: `chartKind: "radar" (spider chart) reuses the familiar categories/series shape — each category becomes a spoke arranged evenly around the circle (0°=top, clockwise, same convention the radial chart's own slices use), each series becomes one closed polygon connecting a vertex per spoke. The shared radial domain reuses the exact same zero/auto/explicit resolution as a categorical chart's y-domain, so unlike a pie's always-positive slice values, radar values CAN go negative — the domain's own minimum simply becomes the center (radius 0), not a hard-coded literal zero. A polygon's fill (series.fill) is flat solid-color-at-opacity rather than line's gradient-to-baseline fade, since a closed radial shape has no single edge that reads as "the baseline."`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'radar',
        height: 260,
        title: 'Skill Assessment',
        categories: ['Speed', 'Power', 'Defense', 'Stamina', 'Tech', 'Agility'],
        series: [
          { name: 'Player A', data: [80, 65, 70, 90, 60, 75], fill: true },
          { name: 'Player B', data: [60, 85, 55, 70, 80, 65], fill: true },
        ],
      }),
      text({ content: 'two filled polygons, shared zero-based domain', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'radar',
        height: 260,
        title: 'Quarterly Change (Can Go Negative)',
        categories: ['North', 'South', 'East', 'West', 'Central'],
        series: [{ name: 'Δ vs. last Q', data: [12, -8, 4, -15, 6] }],
        markerRadius: 5,
        lineStrokeWidth: 3,
      }),
      text({ content: 'negative values: domain min (not 0) sits at the center', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({
    content: `chartKind: "candlestick" plots OHLC (open/high/low/close) bars over the same category-band x-axis a categorical chart's vertical orientation uses — always vertical, since real candlestick charts have no meaningful horizontal-orientation counterpart. Each candle's data is entirely caller-supplied (this library computes no statistics anywhere) — chart() only validates the shape is internally consistent (low <= min(open,close), high >= max(open,close)). A candle's fill color comes from whether it closed up or down (close >= open), not from a series identity, defaulting to green/red with per-series upColor/downColor overrides. Like scatter/gantt, view defaults to 'auto' rather than 'zero', since real price data rarely sits near zero.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  chart({
    chartKind: 'candlestick',
    height: 280,
    title: 'Weekly Close Price',
    categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
    series: [
      {
        name: 'Stock A',
        data: [
          { open: 142, high: 148, low: 140, close: 146 },
          { open: 146, high: 150, low: 144, close: 145 },
          { open: 145, high: 147, low: 138, close: 140 },
          { open: 140, high: 143, low: 136, close: 141 },
          { open: 141, high: 152, low: 141, close: 150 },
          { open: 150, high: 155, low: 148, close: 153 },
          { open: 153, high: 154, low: 147, close: 149 },
          { open: 149, high: 158, low: 149, close: 157 },
        ],
      },
    ],
  }),
  text({ content: 'green: close >= open, red: close < open — same domain "auto" default as scatter/gantt', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
  text({
    content: `chartKind: "treemap" is the last new kind, and the odd one out: no axis, no domain, no ticks — the whole plot box IS the chart. Rectangle area is proportional to each item's value, packed via the standard squarified layout algorithm (Bruls/Huizing/van Wijk) to keep rectangles close to square instead of the thin slivers a naive left-to-right slice-and-dice would produce. Flat, single level only — a hierarchical drill-down treemap was considered and deliberately scoped out. formatLabel lets the caller format each rectangle's own content as rich ChartText — receiving the whole item, not just its label, so a name run and a value run can be styled independently (bigger/bolder name, smaller/faded value on the line below). A rectangle too small to fit its own (possibly multi-line) content at labelFontSize simply omits it rather than overflowing past its own edge or wrapping; formatLabel returning "" does the same on purpose, hiding the label for the smallest items below.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  chart({
    chartKind: 'treemap',
    height: 280,
    title: 'Disk Usage by Folder',
    formatLabel(item) {
      if (item.value < 10) return ''
      return [
        { text: `${item.label}\n`, fontSize: 11, fontWeight: 700 },
        { text: `${item.value} MB`, fontSize: 9, opacity: 0.7 },
      ]
    },
    items: [
      { label: 'node_modules', value: 420 },
      { label: 'src', value: 85 },
      { label: 'dist', value: 60 },
      { label: 'public', value: 38 },
      { label: '.git', value: 150 },
      { label: 'test', value: 22 },
      { label: 'docs', value: 9 },
      { label: '.cache', value: 4 },
    ],
  }),
  text({
    content: 'formatLabel: big bold name run + smaller, lower-opacity value run — area ∝ value, tiny items just go label-less',
    fontFamily: UI_FONT,
    fontSize: 11,
    color: '#666666',
    align: 'center',
  }),
]
