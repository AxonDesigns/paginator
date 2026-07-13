import { chart, group, separator, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

const chartIntro = `A chart node is an SVG built entirely by hand at render time — no charting library, consistent with the rest of this engine having no runtime dependency beyond pretext. It sizes itself the same way an image does (height or aspectRatio, resolved before anything is drawn), then chart-render.ts fills that box with axis ticks, gridlines, a legend, and the marks themselves, all as inline SVG attributes. chartKind: "categorical" merges what used to be separate bar and line chart kinds into one: each series independently declares kind: "bar" | "line" | "points" (points = markers only, no connecting stroke), so a single chart can freely mix e.g. two grouped bar series with a line series and a points series, all sharing the same category x-axis and y-domain — grouping/stacking (barMode) only ever applies among the bar-kind series. The last chart on this page turns off axis/legend/title entirely via config to show that chrome is opt-out, not baked in. The first chart is also draggable, same as the demo image above — interaction wiring needed zero chart-specific code.`

// First third of the "Charts" section: the section header/intro, categorical (mixed series kinds +
// multi-series line), radial (plain pie / donut / sunburst), custom text sizing, and barMode.
// Continues in charts-2.ts / charts-3.ts.
export const chartsSection1: Node[] = [
  text({ content: 'Charts', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: chartIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Revenue vs. Target (Mixed Series Kinds)',
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [
          { name: 'North', kind: 'bar', data: [42, 55, 61, 58] },
          { name: 'South', kind: 'bar', data: [30, 34, 39, 45] },
          { name: 'Target', kind: 'line', curve: 'monotone', data: [38, 48, 58, 60] },
          { name: 'Forecast', kind: 'points', data: [40, 50, 55, 62] },
        ],
        interactive: true,
        draggable: true,
        dragType: 'chart',
      }),
      text({ content: 'one series.kind per series: "bar" + "bar" + "line" + "points"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Weekly Active Users',
        categories: ['W1', 'W2', 'W3', 'W4', 'W5'],
        lineCurve: 'monotone',
        series: [
          { name: '2025', kind: 'line', data: [120, 132, 145, 140, 158], fill: true },
          { name: '2026', kind: 'line', data: [140, 151, 149, 162, 171], fill: true },
        ],
      }),
      text({ content: 'every series kind: "line" (multi-series)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({
    content: `chartKind: "radial" merges what used to be separate pie and donut chart kinds into one — a hole is now just innerRadiusRatio (default 0 = a solid pie), not a different kind. Every radial chart is authored as "rings": a single-ring pie/donut is just rings: [{ slices: [...] }], since there's no separate top-level "slices" shorthand anymore. Below: a plain single-ring pie; a single-ring donut (innerRadiusRatio, title/axis/legend all off); and a two-ring sunburst, where the outer ring's slices each declare a parentIndex into the inner ring, nesting their arc inside their parent's own — a ring's slices are either ALL parented or NONE (chart() throws on a ring that mixes both), so "some nested, some not" only ever means different rings.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'radial',
        height: 220,
        sliceGap: 2,
        title: 'Traffic Sources',
        rings: [
          {
            slices: [
              { label: 'Organic', value: 48 },
              { label: 'Referral', value: 22 },
              { label: 'Social', value: 18 },
              { label: 'Direct', value: 12 },
            ],
          },
        ],
      }),
      text({ content: 'rings: [{ slices }] — a plain pie', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'radial',
        height: 220,
        sliceGap: 2,
        innerRadiusRatio: 0.6,
        rings: [
          {
            slices: [
              { label: 'Passed', value: 82 },
              { label: 'Failed', value: 9 },
              { label: 'Skipped', value: 9 },
            ],
          },
        ],
        axis: { show: false },
        legend: { show: false },
      }),
      text({
        content: 'innerRadiusRatio: 0.6, title/axis/legend all off',
        fontFamily: UI_FONT,
        fontSize: 11,
        color: '#666666',
        align: 'center',
      }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'radial',
        height: 220,
        sliceGap: 1.5,
        innerRadiusRatio: 0.3,
        title: 'Sunburst: Traffic by Source & Device',
        rings: [
          {
            slices: [
              { label: 'Organic', value: 48 },
              { label: 'Paid', value: 30 },
              { label: 'Direct', value: 22 },
            ],
          },
          {
            slices: [
              { label: 'Desktop', value: 30, parentIndex: 0 },
              { label: 'Mobile', value: 18, parentIndex: 0 },
              { label: 'Desktop', value: 20, parentIndex: 1 },
              { label: 'Mobile', value: 10, parentIndex: 1 },
              { label: 'Desktop', value: 14, parentIndex: 2 },
              { label: 'Mobile', value: 8, parentIndex: 2 },
            ],
            colors: ['#a8c8ee', '#f5c98c', '#a8c8ee', '#f5c98c', '#a8c8ee', '#f5c98c'],
          },
        ],
        legend: { show: false },
      }),
      text({
        content: 'two rings, outer ring parentIndex-nested under the inner one; long title auto-wraps instead of overflowing',
        fontFamily: UI_FONT,
        fontSize: 11,
        color: '#666666',
        align: 'center',
      }),
    ]),
  ]),
  text({
    content: `Every chart text role has an independently configurable size: axis.tickFontSize (y-axis numbers), axis.categoryFontSize (x-axis labels), legend.fontSize, and title's own fontSize — set unevenly below (large category labels, small tick numbers, larger legend) to prove margins/row-heights/baselines all recompute from whatever size you pick, rather than a fixed layout that only happens to fit the default 11px.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  chart({
    chartKind: 'categorical',
    height: 240,
    title: { text: 'Custom Text Sizing', fontSize: 22 },
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'North', data: [42, 55, 61, 58] },
      { name: 'South', data: [30, 34, 39, 45] },
    ],
    axis: { tickFontSize: 9, categoryFontSize: 16 },
    legend: { fontSize: 15 },
  }),
  text({
    content: `Bar charts also take a barMode: the default "grouped" places each category's series side by side (see "Quarterly Revenue by Region" above); "stacked" below sums them into one bar per category instead, positive segments growing up from zero and negative ones growing down, each in series order, with the rounded bar-end reserved for the outermost segment only. Segments render fully flush by default — opt into a gap between them with barSegmentGap (px), shown on the right below. Pie/donut slices similarly default to flush at sliceGap: 0 (no stroke, no residual seam) and take an explicit "colors" palette override, replacing the default categorical palette wholesale — see the donut further down.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Stacked, Flush (Default)',
        barMode: 'stacked',
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [
          { name: 'Revenue', data: [42, 55, 61, 58] },
          { name: 'Costs', data: [-28, -31, -35, -33] },
          { name: 'Other', data: [8, 6, 9, 7] },
        ],
      }),
      text({ content: 'barMode: "stacked" (barSegmentGap defaults to 0)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Stacked, With a Gap',
        barMode: 'stacked',
        barSegmentGap: 3,
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [
          { name: 'Revenue', data: [42, 55, 61, 58] },
          { name: 'Costs', data: [-28, -31, -35, -33] },
          { name: 'Other', data: [8, 6, 9, 7] },
        ],
      }),
      text({ content: 'barSegmentGap: 3', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
]
