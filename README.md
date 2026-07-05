# Paginator

Declarative, print/PDF-style document layout and pagination engine for the browser. You author a
document as a tree of building blocks — page config with header/footer/margins, `group`, `text`,
`separator`, `pageBreak`, `image`, `container`, `table`, `chart` — and the engine computes page
breaks and exact pixel positions **purely arithmetically** (never via DOM measurement), then
renders the result into real, isolated DOM. PDF export and an opt-in hover/click/drag/drop
interaction layer are built on top of the same computed layout.

Built on [pretext](https://www.npmjs.com/package/@chenglou/pretext) for text measurement/line-
breaking and [pdfkit](https://pdfkit.org) for vector PDF export.

## Quick start

```ts
import { definePage, group, text, separator, image, pageBreak, ready, paginate, mount } from './index.ts'

const doc = definePage(
  {
    size: 'Letter', // or 'A4' or { width, height } in px
    margins: { top: 56, right: 56, bottom: 56, left: 56 },
    headerGap: 16,
    footerGap: 16,
    header: () => text({ content: 'My Document', fontFamily: 'Arial', fontSize: 11, lineHeight: 14 }),
    footer: ({ pageNumber, totalPages }) =>
      text({ content: `Page ${pageNumber} of ${totalPages}`, fontFamily: 'Arial', fontSize: 10, lineHeight: 13, align: 'right' }),
  },
  group({ direction: 'column', gap: 16 }, [
    text({ content: 'Title', fontFamily: 'Arial', fontSize: 24, fontWeight: 700, lineHeight: 30 }),
    separator({ thickness: 1, color: '#ddd' }),
    text({ content: 'Body copy...', fontFamily: 'Georgia', fontSize: 13, lineHeight: 20 }),
    image({ src: '/logo.png', width: 200, height: 80, objectFit: 'contain' }),
  ]),
)

await ready()
const result = paginate(doc)
mount(result, document.getElementById('app')!)
```

## Development

```sh
bun install     # or npm/pnpm/yarn install
bun run dev     # start the Vite dev server, opens the demo in src/main.ts
bun run build   # type-check (tsc) then build for production
bun run preview # preview the production build
```

`src/main.ts` is a living demo app (not shipped library code) that exercises every feature: multi-
page text splitting (including text decoration), header/footer pagination, all group/flex layout
modes, containers (background/border/borderRadius/padding, min-height, splitting across a page
boundary), images (including borderRadius/opacity), multi-page tables (header repetition, column
grouping with totals, cell spans, per-cell border/padding, zebra striping), charts (including
theming, custom fonts, and mark-geometry overrides), PDF export, and the full interaction system.
Reading it top to bottom is a good way to see every API in realistic use.

## Project layout

```
src/
  core/         node types + pure pagination/layout algorithms (no DOM)
  render/       DOM mounting (Shadow DOM), printing, PDF export, chart SVG rendering
  interaction/  opt-in hover/click/drag/drop layer over the computed layout
  index.ts      public API surface — import from here
  main.ts       demo app
```

## Documentation

See [GUIDE.md](GUIDE.md) for the full architecture and API reference: core invariants, the node
type reference (including `table()` and `chart()` options), the pagination algorithm, CSS
isolation, printing, PDF export internals, the interaction system, the extension seam for adding
new node types, and known limitations/pitfalls.
