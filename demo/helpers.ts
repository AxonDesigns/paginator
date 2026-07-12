import { text } from '../src/index.ts'
import { UI_FONT } from './fonts.ts'

// Header captions live directly on each table column — table() derives a single auto-repeating
// header row from them (see column.content in GUIDE.md), rather than requiring a hand-authored row
// kept in sync with column order by hand. Shared across the tables and containers demo sections.
export function headerCaption(content: string): ReturnType<typeof text> {
  return text({ content, fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 })
}
