// Encode-only tests — no DOM/pdfkit/docx involved, just verifying the hand-rolled Code128/EAN-13/
// Code39 tables and checksum math against known-correct reference values (see barcode-encode.ts's
// header comment for how those tables were sourced/cross-verified).

import { describe, expect, test } from 'bun:test'
import { encodeCode128, encodeCode39, encodeEan13 } from '../src/render/barcode-encode.ts'
import { buildQrMatrix } from '../src/render/qrcode-encode.ts'

describe('encodeCode128', () => {
  test('total module count = 11 per symbol (start + data + check) + 13 for the stop pattern', () => {
    // 'PJJ123C': start(1) + 7 data symbols (Code Set B, one per char) + check(1) = 9 symbols.
    const pattern = encodeCode128('PJJ123C')
    expect(pattern.totalModules).toBe(9 * 11 + 13)
    expect(pattern.runs.reduce((a, b) => a + b, 0)).toBe(pattern.totalModules)
  })

  test('auto-switches to the more compact Code Set C for an even-length digit run', () => {
    // '12345678': start(1) + 4 Code-Set-C symbols (2 digits each) + check(1) = 6 symbols.
    const pattern = encodeCode128('12345678')
    expect(pattern.totalModules).toBe(6 * 11 + 13)
  })

  test('stays on Code Set B for an odd-length digit run (below the Set C threshold)', () => {
    // '123': too short for Set C (needs length >= 4) — 1 symbol per digit instead of per pair.
    const pattern = encodeCode128('123')
    expect(pattern.totalModules).toBe((1 + 3 + 1) * 11 + 13)
  })

  test('rejects an empty value', () => {
    expect(() => encodeCode128('')).toThrow()
  })

  test('rejects characters outside printable ASCII (Code Set A not supported in v1)', () => {
    expect(() => encodeCode128('a\tb')).toThrow(/printable-ASCII/)
  })
})

describe('encodeEan13', () => {
  // Wikipedia's own worked example (Stabilo Point 88, Art. No. 88/57): 12 digits "400638133393"
  // checksum to a check digit of 1.
  test('computes the standard EAN-13 check digit from 12 digits', () => {
    const pattern = encodeEan13('400638133393')
    expect(pattern.text).toBe('4006381333931')
  })

  test('total width is always 95 modules (3 + 42 + 5 + 42 + 3)', () => {
    const pattern = encodeEan13('400638133393')
    expect(pattern.totalModules).toBe(95)
    expect(pattern.runs.reduce((a, b) => a + b, 0)).toBe(95)
  })

  test('"validate" accepts a correctly-computed 13th digit', () => {
    expect(encodeEan13('4006381333931', 'validate').text).toBe('4006381333931')
  })

  test('"validate" throws on an incorrect 13th digit', () => {
    expect(() => encodeEan13('4006381333930', 'validate')).toThrow(/check digit/)
  })

  test('"omit" accepts a 13-digit value without validating it', () => {
    expect(encodeEan13('4006381333939', 'omit').text).toBe('4006381333939')
  })

  test('rejects non-digit characters', () => {
    expect(() => encodeEan13('40063813339x')).toThrow(/only digits/)
  })

  test('rejects lengths other than 12 or 13', () => {
    expect(() => encodeEan13('12345')).toThrow(/12 digits.*or 13 digits/)
  })
})

describe('encodeCode39', () => {
  test('encodes a standard worked example ("CODE39")', () => {
    const pattern = encodeCode39('CODE39')
    expect(pattern.text).toBe('CODE39')
    // 8 characters total (* + CODE39 + *), each 9-element pattern is 6 narrow(1) + 3 wide(3) = 15
    // modules, plus one narrow inter-character gap between each of the 7 adjacent pairs.
    expect(pattern.totalModules).toBe(8 * 15 + 7)
  })

  test('normalizes to uppercase', () => {
    expect(encodeCode39('code39').text).toBe('CODE39')
  })

  test('"auto" appends a mod-43 check character (widens the pattern by one more character + gap)', () => {
    const withoutCheck = encodeCode39('CODE39')
    const withCheck = encodeCode39('CODE39', 'auto')
    expect(withCheck.totalModules).toBe(withoutCheck.totalModules + 15 + 1)
  })

  test('"validate" accepts a correctly-computed mod-43 check character and rejects a wrong one', () => {
    // mod-43 of "CODE39" (C=12, O=24, D=13, E=14, 3=3, 9=9 -> sum 75, 75 % 43 = 32 -> 'W').
    expect(encodeCode39('CODE39W', 'validate').text).toBe('CODE39W')
    expect(() => encodeCode39('CODE39A', 'validate')).toThrow(/check character/)
  })

  test('rejects characters outside the 43-character set', () => {
    expect(() => encodeCode39('abc@')).toThrow(/outside the Code 39 character set/)
  })

  test('rejects an empty value', () => {
    expect(() => encodeCode39('')).toThrow()
  })
})

describe('buildQrMatrix', () => {
  test('module count is a valid QR size (21 + 4n) for a range of inputs', () => {
    for (const value of ['https://example.com', 'A', '1234567890', 'x'.repeat(100)]) {
      const matrix = buildQrMatrix(value, 'M')
      expect(matrix.moduleCount).toBeGreaterThanOrEqual(21)
      expect((matrix.moduleCount - 21) % 4).toBe(0)
    }
  })

  test('isDark is deterministic', () => {
    const matrix = buildQrMatrix('https://example.com', 'M')
    for (let row = 0; row < matrix.moduleCount; row++) {
      for (let col = 0; col < matrix.moduleCount; col++) {
        expect(matrix.isDark(row, col)).toBe(matrix.isDark(row, col))
      }
    }
  })

  test('higher error-correction levels never produce a smaller matrix for the same data', () => {
    const low = buildQrMatrix('https://example.com/some/path', 'L')
    const high = buildQrMatrix('https://example.com/some/path', 'H')
    expect(high.moduleCount).toBeGreaterThanOrEqual(low.moduleCount)
  })
})
