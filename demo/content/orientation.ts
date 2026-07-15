import { group, pageBreak, richText, separator, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

const orientationIntro = `TextNode and RichTextNode share one orientation field with four states: unset/'horizontal' is the ordinary default, 'vertical' reads top-to-bottom (rotated clockwise), 'vertical-reversed' reads bottom-to-top (rotated counter-clockwise), and 'horizontal-reversed' flips the block upside-down without turning it sideways. The two sideways states are atomic — like a rotated barcode, they can never split across a page boundary — but 'horizontal-reversed' keeps ordinary top-to-bottom line flow, so it splits across a page break exactly like normal text (demonstrated below).`

const longUpsideDownText = Array.from(
  { length: 40 },
  (_, i) =>
    `This is sentence number ${i + 1} of a long upside-down paragraph, deliberately repeated many times so it overflows well past a single page and must split — proving that "horizontal-reversed" text keeps ordinary top-to-bottom line flow instead of becoming atomic like the sideways orientations.`,
).join(' ')

export const orientationSection: Node[] = [
  pageBreak(),
  text({ content: 'Orientation', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: orientationIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', gap: 24, mainAlign: 'center', alignSelf: 'stretch' }, [
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      text({ content: 'Reads left-to-right', fontFamily: BODY_FONT, fontSize: 13, color: '#333333' }),
      text({ content: 'orientation: (unset)', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      text({ content: 'Upside-down, no sideways rotation', fontFamily: BODY_FONT, fontSize: 13, color: '#333333', orientation: 'horizontal-reversed' }),
      text({ content: "orientation: 'horizontal-reversed'", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      text({ content: 'Reads top-to-bottom', fontFamily: BODY_FONT, fontSize: 13, color: '#333333', orientation: 'vertical' }),
      text({ content: "orientation: 'vertical'", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      text({ content: 'Reads bottom-to-top', fontFamily: BODY_FONT, fontSize: 13, color: '#333333', orientation: 'vertical-reversed' }),
      text({ content: "orientation: 'vertical-reversed'", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  group({ direction: 'row', gap: 24, mainAlign: 'center', alignSelf: 'stretch' }, [
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      richText({
        fontFamily: BODY_FONT,
        fontSize: 13,
        orientation: 'vertical',
        runs: [{ text: 'RichText mixes a ' }, { text: 'bold run', fontWeight: 700, color: '#4f7cff' }, { text: ' with orientation too' }],
      }),
      text({ content: "richText({ orientation: 'vertical' })", fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  pageBreak(),
  text({ content: 'Upside-down text splitting across a page break', fontFamily: UI_FONT, fontSize: 16, fontWeight: 700 }),
  text({
    content:
      "The paragraph below is orientation: 'horizontal-reversed' and long enough that it must split across this page and the next — proof that upside-down text, unlike the sideways orientations, is not atomic.",
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  text({ content: longUpsideDownText, fontFamily: BODY_FONT, fontSize: 13, orientation: 'horizontal-reversed' }),
]
