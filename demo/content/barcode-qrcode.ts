import { barcode, group, pageBreak, qrcode, separator, text } from '../../src/index.ts'
import type { Node } from '../../src/index.ts'
import { BODY_FONT, UI_FONT } from '../fonts.ts'

const qrcodeIntro = `A qrcode() node draws its own vector rects from a module matrix qrcode-generator computes — no SVG/canvas rendering library involved, same "hand-draw the primitives" approach chart() already uses. The code below only sets a moduleSize, so its box is derived from the encoded module count rather than typed in by hand.`

const barcodeIntro = `barcode() supports three hand-rolled symbologies with zero dependencies: Code128 (full printable ASCII, auto-compacting into Code Set C for digit runs), EAN-13 (a real 12-digit UPC-style number, auto-computing its check digit), and Code39 (letters/digits/punctuation, self-checking). Each barWidth below derives the node's own width from its encoded module count.`

const verticalBarcodeIntro = `rotation: 90/-90 rotates the whole rendered barcode (bars and the text line together) within its box — the same natural left-to-right drawing, just wrapped in a coordinate transform, so nothing about the encoding changes. 90 reads top-to-bottom; -90 reads bottom-to-top, useful when the printed label itself will be mounted upside down relative to the other. barWidth now derives height instead of width.`

// "QR Codes" and "Barcodes" section — starts with a fresh page (the previous "SVG" section ends
// mid-page).
export const barcodeQrcodeSection: Node[] = [
  pageBreak(),
  text({ content: 'QR Codes', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700, align: 'center', alignSelf: 'stretch' }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: qrcodeIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', mainAlign: 'center', alignSelf: 'stretch' }, [
    qrcode({
      value: 'https://github.com/AxonDesigns/paginator',
      moduleSize: 4,
      errorCorrectionLevel: 'Q',
      interactive: true,
      draggable: true,
      dragType: 'qrcode',
    }),
  ]),
  text({ content: 'Barcodes', fontFamily: UI_FONT, fontSize: 20, fontWeight: 700 }),
  separator({ thickness: 1, color: '#dddddd' }),
  text({ content: barcodeIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', gap: 16, alignSelf: 'stretch' }, [
    group({ direction: 'column', gap: 6 }, [
      barcode({ value: 'PAGINATOR-128', symbology: 'code128', barWidth: 4, height: 70 }),
      text({ content: 'code128', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      barcode({ value: '400638133393', symbology: 'ean13', barWidth: 2, height: 70 }),
      text({ content: 'ean13', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6 }, [
      barcode({ value: 'CODE 39', symbology: 'code39', barWidth: 2, height: 70 }),
      text({ content: 'code39', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
  group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
    barcode({ value: 'PAGINATOR-128', symbology: 'code128', barWidth: 2, height: 70 }),
    text({ content: 'code128', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
  ]),
  group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
    barcode({ value: '400638133393', symbology: 'ean13', barWidth: 2, height: 70 }),
    text({ content: 'ean13', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
  ]),
  group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
    barcode({ value: 'CODE 39', symbology: 'code39', barWidth: 2, height: 70 }),
    text({ content: 'code39', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
  ]),
  text({ content: verticalBarcodeIntro, fontFamily: BODY_FONT, fontSize: 13 }),
  group({ direction: 'row', gap: 24, mainAlign: 'center', alignSelf: 'stretch' }, [
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      barcode({ value: 'VERTICAL-90', symbology: 'code128', rotation: 90, barWidth: 3, width: 70 }),
      text({ content: 'rotation: 90', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
    group({ direction: 'column', gap: 6, crossAlign: 'center' }, [
      barcode({ value: 'VERTICAL-N90', symbology: 'code128', rotation: -90, barWidth: 3, width: 70 }),
      text({ content: 'rotation: -90', fontFamily: UI_FONT, fontSize: 11, color: '#666666', align: 'center' }),
    ]),
  ]),
]
