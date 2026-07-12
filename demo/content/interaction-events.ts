import { group, separator, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

const interactionIntro = `Interactivity is opt-in per node and off by default — nothing on this page responds to a pointer unless explicitly marked. Hover and click are gated by "interactive" alone. Dragging needs a second flag, "draggable", set alongside it — an interactive node without it still hovers and clicks normally but never arms a drag. Dropping is checked against a third, fully independent flag, "droppable": a node can be a landing zone without being interactive or draggable itself, and a draggable node need not be droppable. The banner image above and the "JD" initials below are both interactive and draggable; the "Columns of Text" row above and the card below are both interactive and droppable. Try dragging the image or "JD" and releasing over either row to see the drop resolve — and notice the dragged text never gets accidentally selected mid-drag.

Drop zones can also filter by type: the image carries dragType "image" and the "Columns of Text" row only accepts "image", while "JD" carries dragType "avatar" and only the card below accepts "avatar". Drag the image over the card, or "JD" over the "Columns of Text" row, and nothing highlights — the mismatched type is filtered out and the drop resolves to nothing, live as you drag, not just at release. Drag each one over its matching zone instead and it highlights green the moment it's a valid target.`

const cardIntro = `In this card, the outer row is interactive and droppable but its contents are plain — clicking the name or the email bubbles up and resolves to the whole card, since neither of them opted in themselves. The "JD" initials are the one exception: they are ALSO marked interactive and draggable, so clicking or dragging them resolves to that text specifically instead — the more specific match always wins over an interactive ancestor.`

const splitFragmentIntro = `The paragraph below is marked "interactive: true" and is long enough that pagination splits it across several pages. Hover any fragment of it — here or several pages further down — and every fragment highlights at once, not just the one under the pointer: that's findFragments(), which recovers every page a split node landed on with zero authoring effort (no "id" needed), powered by an internal lineage id splitNode() stamps onto each fragment as it splits (src/core/behavior.ts).`

const longSplitParagraph = Array.from(
  { length: 24 },
  (_, i) =>
    `Fragment-highlighting filler sentence ${i + 1}: this run of repeated text exists purely to force this single text node to overflow one page and continue onto the next, so hovering any part of it demonstrates multi-page fragment highlighting.`,
).join(' ')

// "Interaction Events" and "Split-Node Fragment Highlighting" — the closing sections of the demo
// document. The actual hover/click/drag/drop wiring lives in demo/interaction-demo.ts, not here;
// this file only authors the nodes that wiring attaches to.
export const interactionEventsSection: Node[] = [
  text({ content: 'Interaction Events', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: interactionIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  text({ content: cardIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', gap: 12, crossAlign: 'center', interactive: true, droppable: true, accepts: ['avatar'] }, [
    text({
      content: 'JD',
      fontFamily: UI_FONT,
      fontSize: 18,
      fontWeight: 700,
      color: '#4f7cff',
      flex: '48px',
      align: 'center',
      interactive: true, // more specific than the card — wins when clicked or dragged directly
      draggable: true,
      dragType: 'avatar',
    }),
    group({ direction: 'column', gap: 2 }, [
      text({ content: 'Jane Doe', fontFamily: UI_FONT, fontSize: 14, fontWeight: 700 }),
      text({ content: 'jane@example.com', fontFamily: BODY_FONT, fontSize: 12, color: '#666666' }),
    ]),
  ]),
  text({ content: 'Split-Node Fragment Highlighting', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: splitFragmentIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  text({ content: longSplitParagraph, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20, interactive: true }),
]
