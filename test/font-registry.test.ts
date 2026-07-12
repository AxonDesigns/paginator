// Regression coverage for the font-registry refactor: registerFont()/lookupFont()/
// listRegisteredFonts() (src/render/font-registry.ts) take an explicit FontRegistry map instead of
// reading/writing module state, specifically so two Paginator instances can register different font
// files under the same family/weight/style without one clobbering the other's PDF output — see
// paginator.ts's header comment and GUIDE.md's "Multiple Paginator instances" section.
//
// This exercises that isolation at the data/PdfContext level directly, bypassing
// Paginator#registerFont's fetch()/document.fonts.add() calls and Paginator#generatePdf's
// OffscreenCanvas-dependent font-metrics step — neither available under `bun test`, same DOM
// constraint test/behavior.test.ts's header comment documents for the built-in node types.

import { describe, expect, test } from 'bun:test'
import { listRegisteredFonts, lookupFont, resolveActiveFontFamily, resolveFontFamilyForRendering, withActiveFontRegistry } from '../src/render/font-registry.ts'
import type { FontRegistry, RegisteredFont } from '../src/render/font-registry.ts'
import { resolveTextFont } from '../src/render/pdf-fonts.ts'
import type { PdfContext } from '../src/render/pdf-render.ts'
import { text } from '../src/core/nodes.ts'

// Mirrors font-registry.ts's private registryKey() format (`family.trim().toLowerCase()}|${weight}|
// ${style}`) — two Paginator instances each registering 'Inter'/400/'normal' via their own
// registerFont() call would each land on this same key in their own, separate Map.
const INTER_400_NORMAL_KEY = 'inter|400|normal'

function fakeFont(tag: string, alias = `alias-${tag}`): RegisteredFont {
  return { family: 'Inter', weight: 400, style: 'normal', bytes: new TextEncoder().encode(tag), alias }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function makeFakePdfContext(fonts: FontRegistry, registerFontCalls: { name: string; bytes: Uint8Array }[]): PdfContext {
  return {
    doc: { registerFont: (name: string, bytes: Uint8Array) => registerFontCalls.push({ name, bytes }) } as unknown as PdfContext['doc'],
    fonts,
    registeredFontNames: new Map(),
    imageEmbedCache: new Map(),
  }
}

describe('font registry isolation (two Paginator instances)', () => {
  test('lookupFont() resolves independently per registry — one instance registering a font never leaks into another', () => {
    const registryA: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('instance-A-bytes')]])
    const registryB: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('instance-B-bytes')]])

    const fromA = lookupFont(registryA, 'Inter', 400, 'normal')
    const fromB = lookupFont(registryB, 'Inter', 400, 'normal')

    expect(fromA).toBeDefined()
    expect(fromB).toBeDefined()
    expect(decode(fromA!.bytes)).toBe('instance-A-bytes')
    expect(decode(fromB!.bytes)).toBe('instance-B-bytes')
  })

  test('listRegisteredFonts() only reports the registry it was given', () => {
    const registryA: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A')]])
    const registryB: FontRegistry = new Map()

    expect(listRegisteredFonts(registryA)).toHaveLength(1)
    expect(listRegisteredFonts(registryB)).toHaveLength(0)
  })

  test("generatePdf()'s font resolution embeds each instance's own bytes under the same family/weight/style, not whichever instance registered last", () => {
    const node = text({ content: 'hi', fontFamily: 'Inter', fontWeight: 400, fontSize: 12, lineHeight: 14 })

    const registryA: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('instance-A-bytes')]])
    const registryB: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('instance-B-bytes')]])

    const callsA: { name: string; bytes: Uint8Array }[] = []
    const callsB: { name: string; bytes: Uint8Array }[] = []
    const ctxA = makeFakePdfContext(registryA, callsA)
    const ctxB = makeFakePdfContext(registryB, callsB)

    // Instance B resolves AFTER instance A — the exact ordering that used to corrupt instance A's
    // already-generated PDF output back when the registry was module-global state.
    resolveTextFont(ctxA, node)
    resolveTextFont(ctxB, node)

    expect(callsA).toHaveLength(1)
    expect(callsB).toHaveLength(1)
    expect(decode(callsA[0]!.bytes)).toBe('instance-A-bytes')
    expect(decode(callsB[0]!.bytes)).toBe('instance-B-bytes')
  })
})

describe('unregistered fontFamily resolution (Standard-14 fallback vs. throw)', () => {
  test('an unregistered "Helvetica" resolves directly to the matching Standard-14 name, no registerFont() call', () => {
    const node = text({ content: 'hi', fontFamily: 'Helvetica', fontWeight: 700, fontSize: 12, lineHeight: 14 })
    const calls: { name: string; bytes: Uint8Array }[] = []
    const ctx = makeFakePdfContext(new Map(), calls)

    expect(resolveTextFont(ctx, node)).toBe('Helvetica-Bold')
    expect(calls).toHaveLength(0)
  })

  test('a stack falling through to an unregistered "Times, serif" resolves to the Times-Italic variant', () => {
    const node = text({ content: 'hi', fontFamily: 'Times, serif', fontStyle: 'italic', fontSize: 12, lineHeight: 14 })
    const ctx = makeFakePdfContext(new Map(), [])

    expect(resolveTextFont(ctx, node)).toBe('Times-Italic')
  })

  test('an unregistered, non-standard fontFamily throws instead of silently substituting a font', () => {
    const node = text({ content: 'hi', fontFamily: 'Comic Sans MS', fontSize: 12, lineHeight: 14 })
    const ctx = makeFakePdfContext(new Map(), [])

    expect(() => resolveTextFont(ctx, node)).toThrow(/no font registered for family "Comic Sans MS"/)
  })
})

// document.fonts (the CSS Font Loading API's FontFaceSet) is one page-global set with no per-instance
// equivalent — registerFont() itself (untestable here, see this file's header comment) works around
// that by registering each FontFace under a per-instance-unique alias rather than the literal family
// name. These tests exercise the resolution half of that mechanism directly against hand-built
// registries carrying distinct aliases, standing in for what two real registerFont() calls on two
// different Paginator instances would produce.
describe('resolveFontFamilyForRendering() — per-instance alias substitution', () => {
  test('a registered (family, weight, style) resolves to "alias, family" — alias tried first, literal name kept as fallback', () => {
    const registry: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A', 'pgtrfont0x0')]])
    expect(resolveFontFamilyForRendering(registry, 'Inter', 400, 'normal')).toBe('pgtrfont0x0, Inter')
  })

  test('only the registered entry in a multi-name stack gets aliased — the rest pass through unchanged', () => {
    const registry: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A', 'pgtrfont0x0')]])
    expect(resolveFontFamilyForRendering(registry, 'Inter, Arial, sans-serif', 400, 'normal')).toBe('pgtrfont0x0, Inter, Arial, sans-serif')
  })

  test('a weight/style that was never registered falls through unchanged, even when the family name matches', () => {
    const registry: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A', 'pgtrfont0x0')]])
    expect(resolveFontFamilyForRendering(registry, 'Inter', 700, 'normal')).toBe('Inter')
    expect(resolveFontFamilyForRendering(registry, 'Inter', 400, 'italic')).toBe('Inter')
  })

  test('a null registry (no owning Paginator instance) leaves fontFamily completely unchanged', () => {
    expect(resolveFontFamilyForRendering(null, 'Inter, Arial', 400, 'normal')).toBe('Inter, Arial')
  })

  test('a multi-word family name is re-quoted in the fallback position, matching valid CSS font-family syntax', () => {
    const registry: FontRegistry = new Map()
    expect(resolveFontFamilyForRendering(registry, '"Source Serif 4", Georgia', 400, 'normal')).toBe('"Source Serif 4", Georgia')
  })
})

describe('withActiveFontRegistry() / resolveActiveFontFamily() — the ambient hook text.ts/rich-text.ts/shadow-dom.ts consult', () => {
  test('resolves against whichever registry is currently active', () => {
    const registryA: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A', 'pgtrfont0x0')]])
    const registryB: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('B', 'pgtrfont1x0')]])

    withActiveFontRegistry(registryA, () => {
      expect(resolveActiveFontFamily('Inter', 400, 'normal')).toBe('pgtrfont0x0, Inter')
    })
    withActiveFontRegistry(registryB, () => {
      expect(resolveActiveFontFamily('Inter', 400, 'normal')).toBe('pgtrfont1x0, Inter')
    })
  })

  test('two instances\' calls never leak into each other, run back to back — the exact scenario a framework wrapper mounting multiple previews hits', () => {
    const registryA: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A', 'pgtrfont0x0')]])
    const registryB: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('B', 'pgtrfont1x0')]])
    const seenByA = withActiveFontRegistry(registryA, () => resolveActiveFontFamily('Inter', 400, 'normal'))
    const seenByB = withActiveFontRegistry(registryB, () => resolveActiveFontFamily('Inter', 400, 'normal'))

    expect(seenByA).toBe('pgtrfont0x0, Inter')
    expect(seenByB).toBe('pgtrfont1x0, Inter')
  })

  test('restores the previous active registry after returning, including across nested calls', () => {
    const registryA: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('A', 'pgtrfont0x0')]])
    const registryB: FontRegistry = new Map([[INTER_400_NORMAL_KEY, fakeFont('B', 'pgtrfont1x0')]])

    withActiveFontRegistry(registryA, () => {
      expect(resolveActiveFontFamily('Inter', 400, 'normal')).toBe('pgtrfont0x0, Inter')
      withActiveFontRegistry(registryB, () => {
        expect(resolveActiveFontFamily('Inter', 400, 'normal')).toBe('pgtrfont1x0, Inter')
      })
      // Back to registryA after the nested call returns, not left on registryB or cleared to null.
      expect(resolveActiveFontFamily('Inter', 400, 'normal')).toBe('pgtrfont0x0, Inter')
    })
  })

  test('outside any withActiveFontRegistry() call, resolves to fontFamily unchanged (no active registry)', () => {
    expect(resolveActiveFontFamily('Inter, Arial', 400, 'normal')).toBe('Inter, Arial')
  })
})
