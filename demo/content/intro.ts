import { group, pageBreak, separator, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

export const longParagraph1 = `Pretext exploits an asymmetry the browser has always had but never exposed: canvas measureText resolves against the exact same font engine as DOM rendering, yet carries none of DOM layout's reflow penalty. When text first appears, pretext measures every segment once via canvas and caches the widths. After that one-time preparation pass, laying text out at any width and any line height is pure arithmetic over cached numbers — no synchronous layout, no forced reflow, no dependency on how many other elements exist on the page. This document's pagination is built entirely on that arithmetic: every line break, every page break, and every box position below was computed before a single DOM node existed, then painted once, flat, and absolute.`

export const longParagraph2 = `A paragraph long enough to overflow a page is not a special case here — it is the same recursive rule applied again. The pagination engine asks a splittable node for as many lines (or, for a vertical group, as many children) as fit in the remaining space on the current page. Whatever is left over becomes a continuation node carried forward: for text, that continuation is nothing more than a saved cursor into the already-prepared segment stream, so pretext resumes exactly where it left off with no re-measurement, no duplicated words, and no dropped characters. The same paragraph you are reading now may cross a page boundary right in the middle of a sentence, and if it does, the words on the far side of that boundary are the literal continuation of this cursor, not a re-flowed approximation of it. Below this paragraph, a labelled row demonstrates horizontal grouping with space-between alignment and a stretched vertical divider, and after that, a second long paragraph continues pushing content past the bottom of this page to force a second page break, and a third page break beyond that, so you can see the header and footer repeat correctly with an accurate "Page X of Y" count that could only be known after the entire document had already been paginated once.`

export const longParagraph3 = `Every element on every page in this demo — including this paragraph, this page's header, and its footer — is styled entirely through inline styles inside an open shadow root, with no class name and no <style> tag anywhere in the tree. That is deliberate: a shadow boundary already prevents host-page stylesheets (Tailwind's Preflight reset among them) from ever matching anything inside, and setting box-sizing, margin, padding, font, and color inline on every single node means there is nothing left for even a maximally aggressive host rule to override, since there is no selector for it to match in the first place. Open the browser devtools console and inject a rule like "* { box-sizing: content-box !important; margin: 8px !important; font-size: 40px !important; }" into the top-level document — the pages rendered here will not move a single pixel, because that rule structurally cannot cross the shadow boundary, and even if some property could inherit across it, every element already carries its own explicit value that wins regardless of source.`

export const longParagraph4 = `Group layout in this engine is a small, deliberately literal reimplementation of the parts of flexbox that a print-style document actually needs: a main axis and a cross axis, alignment along each, and a fixed gap between children. A column group stacks its children top to bottom and treats height as intrinsic — the sum of every child's own height, plus the gaps between them — while a row group lays children left to right and treats width as intrinsic in the same way. Every child in this engine is always handed a definite width from its parent, mirroring how block-level layout on the web has always worked, and the other dimension is always computed bottom-up from content. Separators are the simplest possible leaf: a thin line drawn perpendicular to whichever axis is "main" for its immediate parent, reserving space equal to its thickness plus twice its margin along that axis, and stretching to fill the full length of the parent's other axis regardless of any alignment setting. That single rule is what makes the same separator definition work correctly as both a horizontal rule under a heading and a vertical divider inside a row of labelled fields, with no separate orientation flag required anywhere in its declaration.`

export const longParagraph5 = `None of the arithmetic above would matter if the final paint step could be silently rewritten by whatever stylesheet happens to be loaded on the host page. A design system's reset, a CSS-in-JS runtime's global styles, or a utility framework's base layer can all redefine what a bare <div> looks like by default, and none of them ask permission first. The two defenses stacked in this renderer are chosen to be independently sufficient, not merely additive: Shadow DOM enforces, at the browser's own style-resolution boundary, that selectors written outside the shadow tree simply cannot match elements inside it, regardless of specificity or the presence of "!important" — this is not a convention that a sufficiently determined stylesheet could defeat, it is a hard rule the rendering engine itself enforces. Separately, every element created here carries an explicit inline value for every property this layout math depends on, so even in a hypothetical embedding context without a shadow boundary at all, cascade-derived surprises have nothing left to attach to. You should be able to delete either defense and the pages would still render correctly; keeping both is simply cheap insurance against the other one having a bug.`

const columnA = `Every row child defaults to flex: 1, so three text blocks like this one automatically divide the row into three equal columns, each wrapping independently at its own share of the width rather than at the full row width.`

const columnB = `Passing a bare number instead changes only the weight, not the mechanism: a column with flex: 2 claims twice the share of whatever space is left after any fixed-width siblings are subtracted, exactly like CSS flex-grow. Being twice as wide as its narrow neighbors, this column also wraps far more efficiently per character, so it comfortably finishes on the first page even carrying more text than they do — a small demonstration that row height in this engine tracks actual wrapped line count at a column's own width, never character count alone.`

const columnC = `This column opts the whole row into splitColumns: true, which changes what happens at a page boundary. Without it, a row is atomic: if it does not fit in the space left on the page, the entire row — every column at once — moves forward together to a fresh page, the same as a separator or an image would. With splitColumns enabled, each column instead asks independently how much of itself fits in the remaining space, exactly the way pretext's own cursor mechanism lets a single paragraph resume mid-sentence. Every other column in this row is short enough to finish on the first page, each leaving a same-width blank slot behind on the continuation so the grid stays aligned instead of quietly reflowing into a different shape — that placeholder mechanism is what you're looking at in their empty space below. This column alone is deliberately long enough to keep going onto a second page-instance of this very row, resuming mid-sentence exactly where the first page's portion left off, the same guarantee pretext's cursor already gives a single splitting paragraph, just applied independently per column instead of to one shared flow.`

const sidebarNote = `Fixed at 160px regardless of how much space the other two columns claim. This one finishes quickly too.`

const pageBreakIntro = `Sometimes a break shouldn't depend on running out of room at all. The paragraph below this one is short — comfortably shorter than the space left on this page — yet it starts on a fresh page anyway, because a pageBreak() node sits between them in the document tree. Pagination treats it as an explicit, unconditional cut: whatever came before stays here, and everything from the marker onward moves to the top of the next page, regardless of how much space remains.`

const pageBreakOutro = `This paragraph is the proof: it begins at the very top of its page, with a large stretch of white space above where it easily could have started instead. Two safeguards keep this from misbehaving at the edges. First, if a pageBreak() lands as the very first thing on an already-empty page — for instance two of them placed back to back — the redundant one is silently dropped rather than producing a blank page. Second, a break nested inside content that would otherwise fit entirely on the current page is still discovered and honored, not silently absorbed by the fast path that places whole-fitting subtrees in one step.`

// Title, isolation-from-host-CSS, group-layout, columns-of-text, and explicit-page-break sections —
// the opening run of the demo document, before any table/image/chart content appears.
export const introSection: Node[] = [
  // The row itself needs no `alignSelf: 'stretch'` — a nested GROUP column child defaults to
  // that now — and its two text children need no `flex: 'shrink'` either, since a leaf child
  // defaults to that too; both are left implicit here to show the new defaults doing the work.
  group({ direction: 'row', mainAlign: 'center' }, [
    text({ content: 'Title', fontFamily: UI_FONT, fontSize: 24, fontWeight: 700 }),
    separator({ thickness: 1, margin: 4, color: '#dddddd' }),
    text({ content: 'Text Flows Without Touching the DOM', fontFamily: UI_FONT, fontSize: 24, fontWeight: 700 }),
  ]),
  separator({ thickness: 1, margin: 0, color: '#dddddd', style: 'dashed' }),
  text({ content: longParagraph1, fontFamily: BODY_FONT, fontSize: 13, }),
  // Same story: the row stretches to full width by default (it's a GROUP), and each text child
  // shrinks to its own content by default (it's a leaf) — `mainAlign: 'start'` then left-packs
  // them with the separators, matching a compact metadata line instead of spreading across the
  // page (swap to 'space-between' for that instead, now that the row actually has free space).
  group({ direction: 'row', mainAlign: 'start', crossAlign: 'stretch', gap: 12 }, [
    text({ content: 'Prepared by: Jane Doe', fontFamily: UI_FONT, fontSize: 12 }),
    separator({ margin: 4, color: '#cccccc' }),
    text({ content: 'Date: 2026-07-01', fontFamily: UI_FONT, fontSize: 12 }),
    separator({ thickness: 1, color: '#cccccc' }),
    text({ content: 'Status: Draft', fontFamily: UI_FONT, fontSize: 12, color: '#2a7a2a' }),
  ]),
  text({ content: longParagraph2, fontFamily: BODY_FONT, fontSize: 13 }),
  // A nested GROUP column child now defaults to 'stretch' (fills the page width) and its own
  // leaf text children default to 'shrink' (hug their own content) — no explicit alignSelf/flex
  // needed for either anymore.
  group({ direction: 'row', gap: 16 }, [
    text({ content: 'Normal text', fontFamily: BODY_FONT, fontSize: 13 }),
    text({ content: 'Underlined text', fontFamily: BODY_FONT, fontSize: 13, textDecoration: 'underline' }),
    text({ content: 'Struck-through text', fontFamily: BODY_FONT, fontSize: 13, textDecoration: 'line-through' }),
  ]),
  text({ content: 'Isolation From Host CSS', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: longParagraph3, fontFamily: BODY_FONT, fontSize: 13 }),
  text({ content: 'Group Layout as a Small, Literal Flexbox', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: longParagraph4, fontFamily: BODY_FONT, fontSize: 13 }),
  text({ content: longParagraph5, fontFamily: BODY_FONT, fontSize: 13 }),
  text({ content: 'Columns of Text', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  group({ direction: 'row', gap: 16, crossAlign: 'start', splitColumns: true, interactive: true, droppable: true, accepts: ['image'] }, [
    // Leaf text children now default to 'shrink' (hug content), not an equal flex-grow share —
    // these three columns need explicit flex weights to keep splitting the row into newspaper
    // columns instead of each hugging its own (very long) single-line natural width.
    text({ content: columnA, fontFamily: BODY_FONT, fontSize: 12, flex: 1 }),
    text({ content: columnB, fontFamily: BODY_FONT, fontSize: 12, flex: 2 }),
    text({ content: columnC, fontFamily: BODY_FONT, fontSize: 12, flex: 1, interactive: true }),
    group({ direction: 'column', gap: 4, flex: '160px' }, [
      text({ content: 'Sidebar', fontFamily: UI_FONT, fontSize: 11, fontWeight: 700 }),
      text({ content: sidebarNote, fontFamily: BODY_FONT, fontSize: 11, color: '#666666' }),
    ]),
  ]),
  pageBreak(),
  text({ content: 'Forcing a Page Break', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: pageBreakIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  pageBreak(),
  text({ content: 'This Page Starts Deliberately, Not by Accident', fontFamily: UI_FONT, fontSize: 18, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: pageBreakOutro, fontFamily: BODY_FONT, fontSize: 13 }),
]
