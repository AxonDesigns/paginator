import { chart, container, group, separator, table, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { longParagraph1, longParagraph2, longParagraph3, longParagraph4, longParagraph5 } from './intro.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'
import { headerCaption } from '../helpers.ts'

const containerIntro = `A container node is a single-child decorative wrapper (Flutter's Container is the reference point) — the one thing group deliberately never has: background, border, borderRadius, and padding. Below: a plain card; a row of badges sized via "flex" like any other row child; a chart wrapped in a container to prove background/border/padding "for free" on a node that has none of its own; two containers whose "height" is a MINIMUM rather than an exact size — one shorter than its content (the box grows to fit, content is never clipped or lost) and one taller (the extra space just sits below); a long paragraph wrapped in a container that spans a page break, to prove padding/background repaint correctly on the continuation page; a container nested inside a table cell; and an interactive, draggable container wired into the same interaction demo as everything else below.`

const containerSplitParagraph = `${longParagraph1} ${longParagraph2} ${longParagraph3} ${longParagraph4} ${longParagraph5}`

export const containersSection: Node[] = [
  text({ content: 'Containers', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: containerIntro, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
  container(
    { background: '#f7f9fc', border: { thickness: 1, color: '#dddddd' }, borderRadius: 8, padding: 16 },
    group({ direction: 'column', gap: 4 }, [
      text({ content: 'Plain Card', fontFamily: UI_FONT, fontSize: 14, fontWeight: 700 }),
      text({
        content: 'background + border + borderRadius + padding, wrapping an ordinary column group that has none of its own.',
        fontFamily: BODY_FONT,
        fontSize: 12,
        color: '#666666',
      }),
    ]),
  ),
  group({ direction: 'row', gap: 8 }, [
    container(
      { background: '#eef1f6', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, width: 90 },
      text({ content: 'Draft', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, align: 'center' }),
    ),
    container(
      { background: '#e8f5e9', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, width: 90 },
      text({ content: 'Approved', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: '#2a7a2a', align: 'center' }),
    ),
    container(
      { background: '#fdecea', borderRadius: 4, padding: { top: 4, right: 10, bottom: 4, left: 10 }, width: 90 },
      text({ content: 'Rejected', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: '#b3261e', align: 'center' }),
    ),
  ]),
  container(
    { background: '#ffffff', border: { thickness: 1, color: '#dddddd' }, borderRadius: 12, padding: 16 },
    chart({
      chartKind: 'categorical',
      height: 200,
      title: 'Chart Wrapped in a Container',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: 'Revenue', data: [42, 55, 61, 58] }],
    }),
  ),
  group({ direction: 'row', gap: 16 }, [
    container(
      { height: 40, background: '#fff7e6', border: { thickness: 1, color: '#f0c36d' }, padding: 8, flex: 1 },
      text({ content: '"height: 40" — this content needs more room than that, so the box grows to fit it: height is a MINIMUM, never a clip.', fontFamily: BODY_FONT, fontSize: 12 }),
    ),
    container(
      { height: 120, background: '#eef7ff', border: { thickness: 1, color: '#a8d0f0' }, padding: 8, flex: 1 },
      text({ content: '"height: 120" — shorter content, so the extra space just sits below it.', fontFamily: BODY_FONT, fontSize: 12 }),
    ),
  ]),
  container(
    { background: '#fafafa', border: { thickness: 1, color: '#dddddd' }, padding: 16 },
    text({ content: containerSplitParagraph, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 }),
  ),
  table({
    columns: [{ width: 3, content: headerCaption('Item') }, { width: '120px', content: headerCaption('Status') }],
    cellPadding: 8,
    border: { inner: { thickness: 1, color: '#dddddd' }, outer: { thickness: 1, color: '#dddddd' } },
    headerBackground: '#eef1f6',
    rows: [
      {
        cells: [
          { content: text({ content: 'Widget A1', fontFamily: BODY_FONT, fontSize: 12 }) },
          {
            content: container(
              { background: '#e8f5e9', borderRadius: 4, padding: { top: 3, right: 8, bottom: 3, left: 8 } },
              text({ content: 'In Stock', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: '#2a7a2a', align: 'center' }),
            ),
          },
        ],
      },
    ],
  }),
  container(
    {
      background: '#ffffff',
      border: { thickness: 2, color: '#4f7cff' },
      borderRadius: 8,
      interactive: true,
      draggable: true,
      padding: 10,
      dragType: 'container',
    },
    text({ content: 'Drag me — I am an interactive, draggable container', fontFamily: UI_FONT, fontSize: 13, fontWeight: 700, color: '#4f7cff' }),
  ),
]
