import { definePage, group, text } from '../src/index.ts'
import type { PageDef } from '../src/index.ts'
import { UI_FONT } from './fonts.ts'
import { introSection } from './content/intro.ts'
import { tablesSection } from './content/tables.ts'
import { mediaSection } from './content/media.ts'
import { containersSection } from './content/containers.ts'
import { richTextSection } from './content/rich-text.ts'
import { chartsSection1 } from './content/charts-1.ts'
import { chartsSection2 } from './content/charts-2.ts'
import { chartsSection3 } from './content/charts-3.ts'
import { interactionEventsSection } from './content/interaction-events.ts'

// The full demo document, assembled from one section per topic (see demo/content/). Section order
// here is the order sections appear on the page.
export const doc: PageDef = definePage(
  {
    size: 'Letter',
    margins: { top: 35, right: 35, bottom: 35, left: 35 },
    headerGap: 16,
    footerGap: 16,
    // Page-level background/border, both page-aware — resolved once per page exactly like header/
    // footer/watermark. Only page 1 gets a tinted background (no charts there yet, so no clash with
    // chart-render.ts's white "surface ring" assumption around markers, documented there); the border
    // is heavier on the cover and final page, thin everywhere else.
    background: ({ pageNumber }) => (pageNumber === 1 ? '#f5f8ff' : '#ffffff'),
    border: ({ pageNumber, totalPages }) => ({ thickness: pageNumber === 1 || pageNumber === totalPages ? 3 : 1, color: '#4f7cff' }),
    watermark: ({ pageNumber }) =>
      pageNumber === 1
        ? {
          kind: 'text',
          text: 'ORIGINAL',
          fontSize: 80,
          tile: true,
          tileGapX: 0,
          opacity: 0.05,
        }
        : null,
    header: () =>
      text({
        content: 'Paginator — Declarative Document Pagination Engine',
        fontFamily: UI_FONT,
        fontSize: 11,
        color: '#888888',
      }),
    footer: ({ pageNumber, totalPages }) =>
      text({
        content: `Page ${pageNumber} of ${totalPages}`,
        fontFamily: UI_FONT,
        fontSize: 10,
        color: '#888888',
        align: 'right',
      }),
  },
  group({ direction: 'column', gap: 16 }, [
    ...introSection,
    ...tablesSection,
    ...mediaSection,
    ...containersSection,
    ...richTextSection,
    ...chartsSection1,
    ...chartsSection2,
    ...chartsSection3,
    ...interactionEventsSection,
  ]),
)
