import { chart, group, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

// Second third of the "Charts" section: view/domain control, orientation, a themed radial demo,
// custom theme/mark geometry, and scatter. Continued from charts-1.ts, continues in charts-3.ts.
export const chartsSection2: Node[] = [
  text({
    content: `The y-axis domain is controlled by "view", separate from "axis" (which only ever draws chrome — ticks/gridlines/labels — on top of whatever domain view resolves). view.domain defaults to 'zero': auto-computed, always including 0. 'auto' instead computes a domain tight to the data's own min/max — not forced through zero — then widened by view.padding (a fraction of that range, default 0.1) on each side, so the lowest/highest mark isn't flush against the plot's own edge. An explicit { min, max } object overrides either mode outright. Below, the same daily-temperature line is plotted three ways: the default zero-based domain, where a tight real-world range of 68-79°F reads as a nearly flat line; an explicit view: { domain: { min: 50, max: 80 } } zoomed in by hand; and view: { domain: 'auto' } letting the chart pick that same kind of tight range automatically. Bars behave the same way — if zero falls outside the resolved domain, a bar simply grows from whichever domain edge is nearer instead of from zero, since zero is no longer on the visible axis to grow from.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
    lineHeight: 20,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Default Domain (Includes 0)',
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        series: [{ name: 'High °F', kind: 'line', data: [72, 75, 79, 74, 68] }],
      }),
      text({ content: "view: {} (default, 'zero' — always includes 0)", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Custom Domain: 50-80',
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        series: [{ name: 'High °F', kind: 'line', data: [72, 75, 79, 74, 68] }],
        view: { domain: { min: 50, max: 80 } },
      }),
      text({ content: 'view: { domain: { min: 50, max: 80 } }', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Auto Domain + Padding',
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        series: [{ name: 'High °F', kind: 'line', data: [72, 75, 79, 74, 68] }],
        view: { domain: 'auto', padding: 0.2 },
      }),
      text({ content: "view: { domain: 'auto', padding: 0.2 }", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({
    content: `Both bar and line charts also take orientation: "horizontal", swapping which axis carries categories vs. values — categories run top-to-bottom on the left, values run left-to-right along the bottom, and bars grow rightward instead of upward. It's a separate rendering path rather than a single axis-agnostic function (same reasoning as group-layout.ts's layoutRow/layoutColumn split gives), so every other option — barMode, barSegmentGap, view.domain, custom font sizes — works identically in both orientations.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 240,
        title: 'Horizontal Bar',
        orientation: 'horizontal',
        categories: ['Organic', 'Referral', 'Social', 'Direct', 'Email'],
        series: [{ name: 'Sessions', data: [4820, 2210, 1840, 1200, 640] }],
      }),
      text({ content: 'orientation: "horizontal"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 240,
        title: 'Horizontal Line',
        orientation: 'horizontal',
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        series: [
          { name: 'North', kind: 'line', data: [42, 55, 61, 58, 66] },
          { name: 'South', kind: 'line', data: [30, 34, 39, 45, 41] },
        ],
      }),
      text({ content: 'orientation: "horizontal" (multi-series)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'radial',
        height: 220,
        title: 'Custom Palette, Zero Gap',
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
        colors: ['#0f7a3d', '#b3261e', '#8a8a8a'],
        sliceGap: 0,
      }),
      text({ content: 'colors: [...], sliceGap: 0', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({
    content: `Beyond series colors, a chart's chrome is themeable too: axis.color/gridlineColor/tickColor override the axis line, gridlines, and tick/category text independently of each other; legend.color overrides legend text; and fontFamily (chart-level) applies to every text role — on the PDF export specifically, this now goes through the SAME font registry text() nodes use, so a chart can render in a registered custom font instead of always falling back to a system font in the exported PDF. Mark geometry is configurable too: barCornerRadius (bar charts), lineStrokeWidth and markerRadius (line charts).`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Custom Theme + Font',
        fontFamily: BODY_FONT,
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: 'Revenue', data: [42, 55, 61, 58] }],
        axis: { color: '#8a5a00', gridlineColor: '#f3e0b8', tickColor: '#8a5a00' },
        legend: { color: '#8a5a00' },
        colors: ['#c98a1a'],
        barCornerRadius: 10,
      }),
      text({ content: 'axis/gridline/tick/legend colors + fontFamily + barCornerRadius: 10', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'categorical',
        height: 220,
        title: 'Custom Mark Geometry',
        categories: ['W1', 'W2', 'W3', 'W4', 'W5'],
        series: [{ name: '2026', kind: 'line', data: [140, 151, 149, 162, 171] }],
        lineStrokeWidth: 4,
        markerRadius: 7,
      }),
      text({ content: 'lineStrokeWidth: 4, markerRadius: 7', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({
    content: `chartKind: "scatter" is this library's first chart with two genuinely independent NUMERIC axes — every other kind has at most one (the other side is a category band), so scatter draws a full axis frame (a left baseline for y, a bottom baseline for x) instead of a single baseline on whichever edge carries the category axis. xView/yView default to 'auto' rather than 'zero' (unlike every other chart's y-domain) since scatter data routinely sits far from either axis' zero. Points can optionally be sized by an arbitrary data value via sizeScale — its mere presence (even {}) opts every point WITH a "size" into bubble sizing, mapped through a sqrt (area-proportional, the standard bubble-chart convention) or linear scale onto a px radius range.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
    lineHeight: 20,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'scatter',
        height: 240,
        title: 'Height vs. Weight',
        series: [
          {
            name: 'Group A',
            points: [
              { x: 61, y: 105 }, { x: 64, y: 115 }, { x: 66, y: 128 }, { x: 68, y: 141 }, { x: 70, y: 155 }, { x: 72, y: 168 },
            ],
          },
          {
            name: 'Group B',
            points: [
              { x: 62, y: 118 }, { x: 65, y: 130 }, { x: 67, y: 138 }, { x: 69, y: 150 }, { x: 71, y: 160 }, { x: 73, y: 175 },
            ],
          },
        ],
      }),
      text({ content: "xView/yView default to 'auto' (tight to data)", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      chart({
        chartKind: 'scatter',
        height: 240,
        title: 'Cities: Income vs. Cost of Living',
        series: [
          {
            name: 'Metro Areas',
            points: [
              { x: 52, y: 62, size: 0.9 },
              { x: 61, y: 71, size: 2.4 },
              { x: 58, y: 66, size: 1.3 },
              { x: 74, y: 88, size: 8.8 },
              { x: 68, y: 79, size: 4.6 },
              { x: 65, y: 74, size: 2.1 },
              { x: 80, y: 95, size: 20.1 },
            ],
          },
        ],
        sizeScale: { range: [5, 26] },
      }),
      text({ content: 'sizeScale: bubble radius ∝ √size (population, millions)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
]
