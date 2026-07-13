import { group, image, pageBreak, separator, svg, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

const imageIntro = `Image sizing is deliberately explicit rather than auto-detected from the loaded asset: paginate() stays fully synchronous, so an image node always needs enough of width, height, and aspectRatio to compute its box before anything has actually loaded. The banner below only declares an aspectRatio, so it stretches to the full column width and derives its height from that — the same behavior CSS's own aspect-ratio property gives an element with one auto dimension.`

const objectFitIntro = `Below, the same 400x300 source image is forced into a 220x140 box three times, once per objectFit value, to see how each reconciles a box whose aspect ratio does not match the asset — exactly the native CSS property doing exactly its native job on a real <img> element.`

// Self-contained 4:3 SVG data URI — keeps the demo free of network/asset dependencies. Baked-in
// dimensions (400x300) and label make it obvious when a box's aspect ratio doesn't match the
// source, which is exactly the case objectFit exists to reconcile.
const DEMO_IMAGE_ASPECT_RATIO = 400 / 300
const DEMO_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4f7cff"/>
      <stop offset="100%" stop-color="#22c1a0"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <circle cx="200" cy="150" r="90" fill="#ffffff" fill-opacity="0.22"/>
  <text x="200" y="158" font-family="Arial" font-size="30" fill="#ffffff" text-anchor="middle">400 x 300</text>
</svg>
`)}`

const svgIntro = `Unlike an image() node — which rasterizes any src, SVG included, to a fixed-resolution PNG before embedding it in the PDF — an svg() node takes raw markup and draws it as true vector content: crisp at any zoom, tiny file size. The badge below mixes a linear gradient fill, a <g transform="rotate(...)"> star, and plain shape elements, all redrawn as real pdfkit vector paths in the exported PDF via svg-to-pdfkit rather than rasterized.`

const DEMO_SVG_BADGE = `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="badgeFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f7cff" />
      <stop offset="1" stop-color="#1baf7a" />
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="90" fill="url(#badgeFill)" stroke="#ffffff" stroke-width="4" />
  <g transform="translate(100 100) rotate(0)" fill="#ffffff" fill-opacity="0.9">
    <polygon points="0,-45 10,-14 42,-14 16,5 26,36 0,17 -26,36 -16,5 -42,-14 -10,-14" />
  </g>
</svg>
`

// "Images" and "SVG" sections — starts with a fresh page (the previous "Tables" section ends
// mid-page).
export const mediaSection: Node[] = [
  pageBreak(),
  text({ content: 'Images', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, align: 'center', alignSelf: 'stretch' }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: imageIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  image({
    src: DEMO_IMAGE_SRC,
    aspectRatio: DEMO_IMAGE_ASPECT_RATIO,
    alt: 'Demo gradient banner, stretched to the full column width',
    interactive: true,
    draggable: true,
    dragType: 'image',
  }),
  text({ content: objectFitIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', alt: 'objectFit: cover' }),
      text({ content: 'objectFit: "cover"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'contain', alt: 'objectFit: contain' }),
      text({ content: 'objectFit: "contain"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'fill', alt: 'objectFit: fill' }),
      text({ content: 'objectFit: "fill"', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({
    content: `An image also takes a "borderRadius" (clips the image's own pixels — a container's borderRadius only decorates around a still-rectangular image, since it doesn't know how to clip arbitrary content) and "opacity". Both below use the same 400x300 source.`,
    fontFamily: BODY_FONT,
    fontSize: 13,
  }),
  group({ direction: 'row', gap: 16 }, [
    group({ direction: 'column', gap: 6 }, [
      image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', borderRadius: 24, alt: 'borderRadius: 24' }),
      text({ content: 'borderRadius: 24', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      image({ src: DEMO_IMAGE_SRC, height: 140, objectFit: 'cover', opacity: 0.4, alt: 'opacity: 0.4' }),
      text({ content: 'opacity: 0.4', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  text({ content: 'SVG', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: svgIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  // alignSelf: 'stretch' claims the full column width for this row alone (the outer body column
  // defaults to crossAlign: 'start', which would otherwise shrink-wrap the row to its content —
  // here, just the svg's own fixed 160px — leaving mainAlign: 'center' nothing to center within).
  group({ direction: 'row', mainAlign: 'center', alignSelf: 'stretch' }, [
    svg({ markup: DEMO_SVG_BADGE, width: 160, aspectRatio: 1 }),
  ]),
]
