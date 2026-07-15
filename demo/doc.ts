import { definePage, group, richText, separator, text } from '../src/index.ts'
import type { PageDef } from '../src/index.ts'
import { UI_FONT } from './fonts.ts'
import { introSection } from './content/intro.ts'
import { tablesSection } from './content/tables.ts'
import { mediaSection } from './content/media.ts'
import { barcodeQrcodeSection } from './content/barcode-qrcode.ts'
import { containersSection } from './content/containers.ts'
import { richTextSection } from './content/rich-text.ts'
import { orientationSection } from './content/orientation.ts'
import { chartsSection1 } from './content/charts-1.ts'
import { chartsSection2 } from './content/charts-2.ts'
import { chartsSection3 } from './content/charts-3.ts'
import { interactionEventsSection } from './content/interaction-events.ts'
import { salesTable } from './content/table-test.ts'
import { marginContent } from './content/margin-content.ts'

// The full demo document, assembled from one section per topic (see demo/content/). Section order
// here is the order sections appear on the page.
export const doc: PageDef = definePage(
  {
    size: 'Letter',
    margins: { top: 50, right: 50, bottom: 50, left: 50 },
    headerGap: 16,
    footerGap: 16,
    // Page-level background/border, both page-aware — resolved once per page exactly like header/
    // footer/watermark. Only page 1 gets a tinted background (no charts there yet, so no clash with
    // chart-render.ts's white "surface ring" assumption around markers, documented there); the border
    // is heavier on the cover and final page, thin everywhere else.
    background: ({ pageNumber }) => (pageNumber === 1 ? '#f5f8ff' : '#ffffff'),
    border: ({ pageNumber, totalPages }) => ({ thickness: pageNumber === 1 || pageNumber === totalPages ? 3 : 1, color: '#4f7cff' }),
    marginContent,
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
    ...barcodeQrcodeSection,
    ...containersSection,
    ...richTextSection,
    ...orientationSection,
    ...chartsSection1,
    ...chartsSection2,
    ...chartsSection3,
    ...interactionEventsSection,
    salesTable,
    group({ direction: 'row', gap: 16, crossAlign: 'stretch' }, [
      group({ direction: 'column', gap: 6, flex: "shrink", interactive: true, minWidth: 200 },
        [
          ...Array.from({ length: 10 }).map((_, i) => (
            group({ direction: 'row', gap: 16 }, [
              text({ content: `Label ${i + 1}`, fontFamily: UI_FONT, fontSize: 11 }),
              text({ content: `Content ${i + 1}`, fontFamily: UI_FONT, fontSize: 11, flex: 1, align: 'right' }),
            ])
          )),
          separator({ thickness: 1, color: '#dddddd', }),
          richText({
            fontFamily: UI_FONT,
            fontSize: 11,
            alignSelf: 'stretch',
            runs: [
              { text: 'RichTextNode asdf asdf asdf asd fasd fasd fasd fasd fasd fasd saf', fontFamily: UI_FONT, fontSize: 11, color: '#666666' },
              { text: ' - ', fontFamily: UI_FONT, fontSize: 11, color: '#666666', fontWeight: 700 },
              { text: 'richText nodes can be interactive', fontFamily: UI_FONT, fontSize: 11, color: '#4f7cff', href: 'https://example.com' }
            ]
          })
        ]
      ),
      group({ direction: 'column', gap: 6, interactive: true },
        Array.from({ length: 7 }).map((_, i) => (
          group({ direction: 'row', gap: 16 }, [
            text({ content: `Label ${i + 1}`, fontFamily: UI_FONT, fontSize: 11, flex: 1 }),
            text({ content: `Content ${i + 1}`, fontFamily: UI_FONT, fontSize: 11, flex: 1, align: 'right' }),
          ])
        )))
    ])
  ]),
)
