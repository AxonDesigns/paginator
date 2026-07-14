import { group, text } from '../../src/index.ts'
import type { MarginContent } from '../../src/index.ts'
import { UI_FONT } from '../fonts.ts'

// PageDef.marginContent demo — free-positioned content in the page margin whitespace, resolved
// once per page exactly like header/footer/watermark. Every note is always shrink-wrapped to its
// own content's natural width (no width to configure — see MarginNote's own doc comment). Two
// notes, exercising both MarginPosition forms and TextNode.orientation together:
//
// 1. Two vertical running titles side by side down the left margin, each `orientation:
//    'vertical-inverted'` (reads bottom-to-top), wrapped in an ordinary ROW group — proof that
//    vertical text composes with normal group layout: the row sizes each label to its own
//    POST-rotation thickness (not its pre-rotation wrap width), so the two sit snugly `gap: 4`
//    apart rather than leaving a large stale gap sized off the unrotated text. Anchored via the
//    margin-strip-relative form (`region: 'left'`, centered in both the strip's own thickness and
//    its full-page run). Static across every page (a plain array, not a callback).
// 2. A small per-page "DRAFT" marker anchored to the top-right of the top margin strip, offset
//    inward from the physical corner — demonstrates the callback form (content varies by
//    pageNumber) alongside a different cross/along combination.
export const marginContent: MarginContent = [
  {
    node: group({
      direction: 'row',
      crossAlign: "center",
      gap: 4,
    }, [
      text({
        content: 'PAGINATOR — MARGIN CONTENT DEMO',
        fontFamily: UI_FONT,
        fontSize: 10,
        fontWeight: 700,
        color: '#4f7cff',
        letterSpacing: 1.5,
        orientation: 'vertical-inverted',
      }),
      text({
        content: 'SECOND LINE',
        fontFamily: UI_FONT,
        fontSize: 10,
        fontWeight: 700,
        color: '#4f7cff',
        letterSpacing: 1.5,
        orientation: 'vertical-inverted',
      }),
    ]),
    position: { region: 'left', cross: 'center', along: 'center' },
  },
  {
    node: ({ pageNumber }) =>
      text({
        content: `DRAFT · page ${pageNumber}`,
        fontFamily: UI_FONT,
        fontSize: 9,
        fontWeight: 700,
        color: '#c0392b',
      }),
    position: { region: 'top', cross: 'center', along: 'end', offsetX: -50 },
  },
]
