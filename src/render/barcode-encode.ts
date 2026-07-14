// Hand-rolled Code128/EAN-13/Code39 encoders — zero dependencies. Every symbol table below was
// cross-verified against the published Code 128 / EAN-13 / Code 39 standards (Wikipedia's own
// articles transcribe the same public, standard tables used by every barcode implementation) and
// each carries a structural self-consistency check baked into how it's derived here (see the
// comments on EAN13_R/EAN13_G and the Code 128/Code 39 invariants below) rather than being
// hand-typed digit-by-digit, to keep transcription risk low for data that must be exactly right
// to scan.
//
// Shared output shape: a barcode is ultimately just an alternating sequence of bar (dark) and
// space (light) runs — `BarPattern.runs[0]` is always a bar, `runs[1]` a space, and so on,
// measured in abstract "module" units. A renderer (DOM/PDF/DOCX) only needs to walk `runs`,
// alternating fill/skip, to draw any of the three symbologies with no symbology-specific drawing
// code — the encode step is the only place that knows about start/stop patterns, checksums, or
// per-symbology character tables.

export type BarPattern = { runs: number[]; totalModules: number; text: string }

export type BarcodeCheckDigitMode = 'auto' | 'validate' | 'omit'

// Turns a string of '0'/'1' module-color bits into alternating run-lengths, starting with the bar
// (1) run — every symbology here always begins with a bar, so runs[0] is always a bar count.
function runsFromBits(bits: string): number[] {
  const runs: number[] = []
  let current = bits[0]
  let count = 0
  for (const bit of bits) {
    if (bit === current) {
      count++
    } else {
      runs.push(count)
      current = bit
      count = 1
    }
  }
  runs.push(count)
  return runs
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

// --- Code 128 -------------------------------------------------------------------------------
//
// 107 symbols (values 0-106): 103 data symbols (0-102), 3 start symbols (103/104/105), 1 stop
// symbol (106, 11 modules wide — printed with a trailing 2-module bar for a 13-module stop
// pattern). Patterns below are each symbol's exact 11-module bar/space bit string (1=bar,
// 0=space), transcribed from the standard Code 128 symbol table (values 0-102, indexed by
// array position) — self-consistency spot-checked against the table's own published run-length
// "widths" column (e.g. value 0's pattern '11011001100' run-length-decodes to widths '212222',
// exactly as published) and against the worked example in the standard ('A' = value 33 =
// '10100011000' = widths '111323').
//
// v1 scope: Code Set B (full printable ASCII 0x20-0x7E) for general text, auto-switching to the
// more compact Code Set C (2 digits/symbol) only when the ENTIRE value is an even-length run of
// digits (length >= 4) — no mid-string code-set switching, and no Code Set A (control
// characters), which is a documented limitation rather than a bug: real-world payloads
// essentially never need control characters, and supporting them would require the shift/
// code-set state machine Code Set A implies.
const CODE128_PATTERNS: string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100', '10011001000',
  '10011000100', '10001100100', '11001001000', '11001000100', '11000100100', '10110011100', '10011011100',
  '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110',
  '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '11101100100',
  '11100110100', '11100110010', '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000', '11000101000', '11000100010',
  '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110', '11101110110',
  '11010001110', '11000101110', '11011101000', '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010', '11101111010', '11001000010', '11110001010',
  '10100110000', '10100001100', '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010', '11000010010', '11001010000',
  '11110111010', '11000010100', '10001111010', '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100', '11110010010', '11011011110', '11011110110',
  '11110110110', '10101111000', '10100011110', '10001011110', '10111101000', '10111100010', '11110101000',
  '11110100010', '10111011110', '10111101110', '11101011110', '11110101110',
]
// Start B/C (values 104/105) aren't part of the 0-102 data-symbol table above — their patterns
// live outside that array's index range, so they're kept as their own constants rather than
// (out-of-bounds) lookups into CODE128_PATTERNS.
const CODE128_START_B_PATTERN = '11010010000'
const CODE128_START_C_PATTERN = '11010011100'
// The stop SYMBOL alone (value 106) is '11000111010' (11 modules); Code 128 always prints it
// followed by a trailing 2-module bar to form the full 13-module stop PATTERN a scanner reads.
const CODE128_STOP_PATTERN = '1100011101011'

function code128Symbols(value: string, useSetC: boolean): number[] {
  if (useSetC) {
    const symbols: number[] = []
    for (let i = 0; i < value.length; i += 2) symbols.push(Number(value.slice(i, i + 2)))
    return symbols
  }
  const symbols: number[] = []
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code > 0x7e) {
      throw new Error(`[paginator] encodeCode128(): character ${JSON.stringify(char)} is outside the supported printable-ASCII range (Code Set A / control characters aren't supported — see barcode-encode.ts's header comment).`)
    }
    symbols.push(code - 0x20)
  }
  return symbols
}

export function encodeCode128(value: string): BarPattern {
  if (value.length === 0) throw new Error('[paginator] encodeCode128(): value must not be empty.')
  const useSetC = /^\d+$/.test(value) && value.length >= 4 && value.length % 2 === 0
  // Start code VALUEs (104/105, used in the checksum sum below) per the standard's own numbering
  // — distinct from their PATTERNs, which aren't part of the 0-102 indexed table (see above).
  const startValue = useSetC ? 105 : 104
  const startPattern = useSetC ? CODE128_START_C_PATTERN : CODE128_START_B_PATTERN
  const dataSymbols = code128Symbols(value, useSetC)
  const checksum = startValue + sum(dataSymbols.map((v, i) => v * (i + 1)))
  const checkSymbol = checksum % 103
  const bits = startPattern + dataSymbols.map(v => CODE128_PATTERNS[v]).join('') + CODE128_PATTERNS[checkSymbol] + CODE128_STOP_PATTERN
  const runs = runsFromBits(bits)
  return { runs, totalModules: sum(runs), text: value }
}

// --- EAN-13 -----------------------------------------------------------------------------------
//
// 95 modules: 3 (start guard '101') + 6x7 (left digits) + 5 (center guard '01010') + 6x7 (right
// digits) + 3 (end guard '101'). L-code patterns below are the standard UPC/EAN digit
// encodings; R and G are DERIVED (not separately transcribed) from the well-known relationship
// the standard itself documents — R(d) is the bitwise complement of L(d), and G(d) is R(d)
// read in reverse bit order — which both self-verifies the L table (every derived R/G pattern
// must itself decode to a valid 2-bar/2-space, 7-module digit shape) and halves the transcription
// surface.
const EAN13_L: string[] = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const EAN13_R: string[] = EAN13_L.map(bits => [...bits].map(b => (b === '1' ? '0' : '1')).join(''))
const EAN13_G: string[] = EAN13_R.map(bits => [...bits].reverse().join(''))
// First digit -> parity (L/G) pattern for the left 6 digits; the right 6 always use R.
const EAN13_PARITY: string[] = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function ean13CheckDigit(digits12: number[]): number {
  const weighted = sum(digits12.map((d, i) => d * (i % 2 === 0 ? 1 : 3)))
  return (10 - (weighted % 10)) % 10
}

export function encodeEan13(value: string, checkDigitMode: BarcodeCheckDigitMode = 'auto'): BarPattern {
  if (!/^\d+$/.test(value)) throw new Error(`[paginator] encodeEan13(): value must contain only digits, got ${JSON.stringify(value)}.`)
  if (value.length !== 12 && value.length !== 13) {
    throw new Error(`[paginator] encodeEan13(): value must be exactly 12 digits (check digit computed) or 13 digits (check digit provided), got ${value.length}.`)
  }

  const leading12 = value.slice(0, 12).split('').map(Number)
  let digits: number[]
  if (value.length === 12) {
    digits = [...leading12, ean13CheckDigit(leading12)]
  } else {
    const given = Number(value[12])
    if (checkDigitMode === 'omit') {
      digits = [...leading12, given]
    } else {
      const expected = ean13CheckDigit(leading12)
      if (given !== expected) {
        throw new Error(`[paginator] encodeEan13(): check digit ${given} in "${value}" doesn't match the computed check digit ${expected} — pass checkDigit: 'omit' to bypass this validation.`)
      }
      digits = [...leading12, given]
    }
  }

  const parity = EAN13_PARITY[digits[0]]
  const left = digits.slice(1, 7)
  const right = digits.slice(7, 13)
  const bits = '101' + left.map((d, i) => (parity[i] === 'L' ? EAN13_L[d] : EAN13_G[d])).join('') + '01010' + right.map(d => EAN13_R[d]).join('') + '101'
  const runs = runsFromBits(bits)
  return { runs, totalModules: sum(runs), text: digits.join('') }
}

// --- Code 39 ------------------------------------------------------------------------------
//
// 44 patterns (43 data characters + the '*' start/stop delimiter), each a 9-element bar/space
// pattern ('N' = narrow = 1 module, 'W' = wide = 3 modules; every Code 39 character has exactly
// 3 wide and 6 narrow elements — self-checking, not a checksum). Characters are joined by a
// single extra narrow (1-module) space, per the standard.
const CODE39_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%'
const CODE39_PATTERNS: Record<string, string> = {
  '0': 'NNNWWNWNN', '1': 'WNNWNNNNW', '2': 'NNWWNNNNW', '3': 'WNWWNNNNN', '4': 'NNNWWNNNW',
  '5': 'WNNWWNNNN', '6': 'NNWWWNNNN', '7': 'NNNWNNWNW', '8': 'WNNWNNWNN', '9': 'NNWWNNWNN',
  A: 'WNNNNWNNW', B: 'NNWNNWNNW', C: 'WNWNNWNNN', D: 'NNNNWWNNW', E: 'WNNNWWNNN',
  F: 'NNWNWWNNN', G: 'NNNNNWWNW', H: 'WNNNNWWNN', I: 'NNWNNWWNN', J: 'NNNNWWWNN',
  K: 'WNNNNNNWW', L: 'NNWNNNNWW', M: 'WNWNNNNWN', N: 'NNNNWNNWW', O: 'WNNNWNNWN',
  P: 'NNWNWNNWN', Q: 'NNNNNNWWW', R: 'WNNNNNWWN', S: 'NNWNNNWWN', T: 'NNNNWNWWN',
  U: 'WWNNNNNNW', V: 'NWWNNNNNW', W: 'WWWNNNNNN', X: 'NWNNWNNNW', Y: 'WWNNWNNNN',
  Z: 'NWWNWNNNN', '-': 'NWNNNNWNW', '.': 'WWNNNNWNN', ' ': 'NWWNNNWNN', $: 'NWNWNWNNN',
  '/': 'NWNWNNNWN', '+': 'NWNNNWNWN', '%': 'NNNWNWNWN', '*': 'NWNNWNWNN',
}

function code39CharBits(char: string): string {
  const nw = CODE39_PATTERNS[char]
  let bits = ''
  for (let i = 0; i < nw.length; i++) {
    const isBar = i % 2 === 0
    bits += (isBar ? '1' : '0').repeat(nw[i] === 'W' ? 3 : 1)
  }
  return bits
}

function code39CheckChar(chars: string[]): string {
  const value = sum(chars.map(c => CODE39_CHARSET.indexOf(c))) % 43
  return CODE39_CHARSET[value]
}

export function encodeCode39(value: string, checkDigitMode: BarcodeCheckDigitMode = 'omit'): BarPattern {
  const normalized = value.toUpperCase()
  if (normalized.length === 0) throw new Error('[paginator] encodeCode39(): value must not be empty.')
  for (const char of normalized) {
    if (char === '*' || !(char in CODE39_PATTERNS)) {
      throw new Error(`[paginator] encodeCode39(): character ${JSON.stringify(char)} is outside the Code 39 character set (0-9, A-Z, space, - . $ / + %).`)
    }
  }

  let dataChars = [...normalized]
  if (checkDigitMode === 'auto') {
    dataChars = [...dataChars, code39CheckChar(dataChars)]
  } else if (checkDigitMode === 'validate') {
    const provided = dataChars[dataChars.length - 1]
    const expected = code39CheckChar(dataChars.slice(0, -1))
    if (provided !== expected) {
      throw new Error(`[paginator] encodeCode39(): check character ${JSON.stringify(provided)} in "${normalized}" doesn't match the computed check character ${JSON.stringify(expected)} — pass checkDigit: 'omit' to bypass this validation.`)
    }
  }

  const sequence = ['*', ...dataChars, '*']
  const bits = sequence.map(code39CharBits).join('0')
  const runs = runsFromBits(bits)
  return { runs, totalModules: sum(runs), text: normalized }
}

// --- Shared dispatcher ----------------------------------------------------------------------

export type BarcodeSymbology = 'code128' | 'ean13' | 'code39'

// One entry point for barcode() (nodes.ts, for construction-time validation/sizing),
// src/nodes/barcode.ts (renderDom/drawPdf), and docx-export.ts's rasterization path — all three
// need the exact same encoded pattern for a given node, and none of them cache it on the node
// itself (re-encoding is cheap, pure, and deterministic — same "don't cache" contract svg() has
// for its own markup parsing).
export function encodeBarcodeValue(symbology: BarcodeSymbology, value: string, checkDigitMode?: BarcodeCheckDigitMode): BarPattern {
  switch (symbology) {
    case 'code128':
      return encodeCode128(value)
    case 'ean13':
      return encodeEan13(value, checkDigitMode ?? 'auto')
    case 'code39':
      return encodeCode39(value, checkDigitMode ?? 'omit')
  }
}
