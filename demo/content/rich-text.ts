import { richText, separator, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

const richTextIntro = `A richText node mixes styled runs inline within a single paragraph — a separate node type from plain text, which stays one uniform run. Below, one paragraph carries a bold run, a colored run, and a real inline link, all wrapping and reflowing together exactly like an ordinary paragraph. The link renders as a genuine anchor element on screen and a real clickable annotation in the exported PDF, both natively clickable with no custom hit-testing involved.`

export const richTextSection: Node[] = [
  text({ content: 'Rich Text', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: richTextIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  richText({
    fontFamily: BODY_FONT,
    fontSize: 14,
    runs: [
      { text: 'This paragraph starts in plain text, then switches to a ' },
      { text: 'bold run', fontWeight: 700 },
      { text: ' mid-sentence, continues with a ' },
      { text: 'colored run', color: '#4f7cff' },
      { text: ', and ends with an inline link to the ' },
      { text: 'pretext repository', color: '#4f7cff', textDecoration: 'underline', href: 'https://github.com/chenglou/pretext' },
      { text: ' — the same rich-inline layout engine this node is built on.' },
    ],
  }),
]
