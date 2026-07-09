// Excel export: walks every table() node in a document (tables-only scope — see GUIDE.md's export
// section) and emits one worksheet per table. Reads TableNode.rows directly — `.groups`/`.stripe`
// are already fully desugared into a flat `rows` array by table()'s builder (nodes.ts), so this file
// never reimplements grouping/totals/striping, exactly like the existing PDF/DOM table renderers.
//
// Bundler-agnostic Buffer handling: ExcelJS needs a global `Buffer` for its zip/xlsx encoding. Bun
// (which runs `bun test`) implements it natively, but a browser bundle doesn't — rather than a
// bundler-specific polyfill plugin/config, this imports the plain `buffer` npm package (works
// unmodified under any bundler) and shims it in only if missing.
import { Buffer } from 'buffer'
if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as { Buffer?: unknown }).Buffer = Buffer
}

import ExcelJS from 'exceljs'
import type { CrossAlign, Node, PageDef, RichTextNode, RichTextRun, TableBorderMode, TableCell, TableNode, TableRow, TextNode } from '../core/nodes.ts'
import { resolvePageSize } from '../core/page-sizes.ts'
import { resolveColumnWidths } from '../nodes/table/index.ts'
import { findTables } from './find-tables.ts'
import { flattenNodeToText } from './node-to-text.ts'
import { toArgb } from './export-color.ts'
import { pxToExcelWidth, pxToPt } from './units.ts'
import { borderSides, borderStyleForThickness as sharedBorderStyleForThickness } from './table-grid.ts'

export type XlsxMetadata = { title?: string; author?: string; subject?: string; keywords?: string[] }

let warnedNestedCellContent = false

function warnNestedCellContentOnce(): void {
  if (warnedNestedCellContent) return
  warnedNestedCellContent = true
  console.warn('[paginator] generateXlsx(): a cell contains nested layout (e.g. a group/container) that can\'t be represented in a spreadsheet cell — flattening it to plain text.')
}

const HORIZONTAL_ALIGN: Record<CrossAlign, ExcelJS.Alignment['horizontal']> = {
  start: 'left',
  center: 'center',
  end: 'right',
  stretch: 'fill',
}

const VERTICAL_ALIGN: Record<'start' | 'center' | 'end', ExcelJS.Alignment['vertical']> = {
  start: 'top',
  center: 'middle',
  end: 'bottom',
}

function textNodeFont(node: TextNode): Partial<ExcelJS.Font> {
  const font: Partial<ExcelJS.Font> = { size: pxToPt(node.fontSize), name: node.fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '') }
  if (node.fontWeight !== undefined && (node.fontWeight === 'bold' || Number(node.fontWeight) >= 600)) font.bold = true
  if (node.fontStyle === 'italic') font.italic = true
  if (node.color !== undefined) font.color = { argb: toArgb(node.color) }
  if (node.textDecoration === 'underline') font.underline = true
  if (node.textDecoration === 'line-through') font.strike = true
  return font
}

/** A run's own style falls back to its paragraph's ambient style — same resolution order every
 *  richText renderer (DOM/PDF) already uses for a run that omits a field. */
function runFont(paragraph: RichTextNode, run: RichTextRun): Partial<ExcelJS.Font> {
  const fontFamily = run.fontFamily ?? paragraph.fontFamily
  const font: Partial<ExcelJS.Font> = { size: pxToPt(run.fontSize ?? paragraph.fontSize), name: fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '') }
  const fontWeight = run.fontWeight ?? paragraph.fontWeight
  const fontStyle = run.fontStyle ?? paragraph.fontStyle
  const color = run.color ?? paragraph.color
  const textDecoration = run.textDecoration ?? paragraph.textDecoration
  if (fontWeight !== undefined && (fontWeight === 'bold' || Number(fontWeight) >= 600)) font.bold = true
  if (fontStyle === 'italic') font.italic = true
  if (color !== undefined) font.color = { argb: toArgb(color) }
  if (textDecoration === 'underline') font.underline = true
  if (textDecoration === 'line-through') font.strike = true
  return font
}

/** Writes `node`'s content into `cell` — plain text/rich-text cells preserve real styling; anything
 *  else (nested group/container/table content) is flattened to plain text with a one-time warning,
 *  since a spreadsheet cell can't host nested flex layout. */
function applyCellContent(cell: ExcelJS.Cell, node: Node): void {
  if (node.type === 'text') {
    cell.value = node.content
    cell.font = textNodeFont(node)
    return
  }
  if (node.type === 'richText') {
    if (node.runs.length === 1) {
      cell.value = node.runs[0]!.text
      cell.font = runFont(node, node.runs[0]!)
      return
    }
    cell.value = { richText: node.runs.map(run => ({ text: run.text, font: runFont(node, run) })) }
    return
  }
  warnNestedCellContentOnce()
  cell.value = flattenNodeToText(node)
}

function borderStyleForThickness(thickness: number): ExcelJS.BorderStyle {
  return sharedBorderStyleForThickness(thickness, { thin: 'thin', medium: 'medium', thick: 'thick' })
}

/** Applies a border rectangle (a single cell, or a colSpan/rowSpan-merged block) — sets each side
 *  only on the block's own perimeter cells, since ExcelJS renders a merged range's border from the
 *  styles of its edge cells, not just the top-left "master" cell. */
function applyBorderRect(
  sheet: ExcelJS.Worksheet,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  sides: { top: boolean; bottom: boolean; left: boolean; right: boolean },
  style: ExcelJS.BorderStyle,
  argb: string,
): void {
  const edge: Partial<ExcelJS.Border> = { style, color: { argb } }
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const cell = sheet.getCell(r, c)
      const border: Partial<ExcelJS.Borders> = { ...cell.border }
      if (sides.top && r === rowStart) border.top = edge
      if (sides.bottom && r === rowEnd) border.bottom = edge
      if (sides.left && c === colStart) border.left = edge
      if (sides.right && c === colEnd) border.right = edge
      cell.border = border
    }
  }
}

function writeCell(
  sheet: ExcelJS.Worksheet,
  excelRow: number,
  cell: TableCell,
  arrayIndex: number,
  rowBackground: string | undefined,
  rowVerticalAlign: 'start' | 'center' | 'end' | undefined,
  totalRows: number,
  columnCount: number,
  tableMode: TableBorderMode,
  tableBorderColor: string,
  tableBorderStyle: ExcelJS.BorderStyle,
): void {
  // Mirrors table/layout.ts's prepareRowCells: `__resolvedCol` is only baked in when the table has
  // ANY colSpan/rowSpan (resolveCellSpans() in nodes.ts); an ordinary table falls back to plain
  // array position, never a constant.
  const colStart = cell.__resolvedCol ?? arrayIndex
  const colSpan = cell.colSpan ?? 1
  const rowSpan = cell.rowSpan ?? 1
  const colEnd = colStart + colSpan - 1
  const rowEnd = excelRow - 1 + rowSpan - 1

  if (colSpan > 1 || rowSpan > 1) sheet.mergeCells(excelRow, colStart + 1, rowEnd + 1, colEnd + 1)
  const target = sheet.getCell(excelRow, colStart + 1)

  if (cell.content !== undefined) applyCellContent(target, cell.content)

  const background = cell.background ?? rowBackground
  if (background !== undefined) {
    target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(background) } }
  }

  const horizontal = cell.align !== undefined ? HORIZONTAL_ALIGN[cell.align] : undefined
  const vertical = VERTICAL_ALIGN[cell.verticalAlign ?? rowVerticalAlign ?? 'start']
  target.alignment = { horizontal, vertical, wrapText: true }

  const sides = borderSides(tableMode, excelRow - 1, rowEnd, colStart, colEnd, totalRows, columnCount)
  if (sides.top || sides.bottom || sides.left || sides.right) {
    applyBorderRect(sheet, excelRow, rowEnd + 1, colStart + 1, colEnd + 1, sides, tableBorderStyle, tableBorderColor)
  }

  if (cell.border !== undefined) {
    const perCellStyle = borderStyleForThickness(cell.border.thickness ?? 1)
    const perCellColor = toArgb(cell.border.color ?? '#000000')
    applyBorderRect(sheet, excelRow, rowEnd + 1, colStart + 1, colEnd + 1, { top: true, bottom: true, left: true, right: true }, perCellStyle, perCellColor)
  }
}

function writeTableSheet(sheet: ExcelJS.Worksheet, table: TableNode, contentWidthPx: number): void {
  const columnCount = table.columns.length
  const colWidthsPx = resolveColumnWidths(table, contentWidthPx)
  sheet.columns = colWidthsPx.map(w => ({ width: pxToExcelWidth(w) }))

  const totalRows = table.rows.length
  const mode = table.border?.mode ?? (table.border !== undefined ? 'all' : 'none')
  const borderColor = toArgb(table.border?.color ?? '#000000')
  const borderStyle = borderStyleForThickness(table.border?.thickness ?? 1)

  table.rows.forEach((row: TableRow, r) => {
    const excelRow = r + 1
    if (row.kind === 'header') {
      if (row.cells !== undefined) {
        row.cells.forEach((cell, i) => writeCell(sheet, excelRow, cell, i, row.background, undefined, totalRows, columnCount, mode, borderColor, borderStyle))
        return
      }
      sheet.mergeCells(excelRow, 1, excelRow, columnCount)
      const target = sheet.getCell(excelRow, 1)
      if (row.content !== undefined) applyCellContent(target, row.content)
      target.alignment = { vertical: 'middle', indent: row.depth }
      if (row.background !== undefined) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(row.background) } }
      const sides = borderSides(mode, r, r, 0, columnCount - 1, totalRows, columnCount)
      if (sides.top || sides.bottom || sides.left || sides.right) {
        applyBorderRect(sheet, excelRow, excelRow, 1, columnCount, sides, borderStyle, borderColor)
      }
      return
    }
    row.cells.forEach((cell, i) => writeCell(sheet, excelRow, cell, i, row.background, row.verticalAlign, totalRows, columnCount, mode, borderColor, borderStyle))
  })

  if ((table.headerRows ?? 0) > 0) {
    sheet.views = [{ state: 'frozen', ySplit: table.headerRows! }]
  }
}

export async function generateXlsx(doc: PageDef, metadata?: XlsxMetadata): Promise<Uint8Array> {
  const tables = findTables(doc.body)
  if (tables.length === 0) {
    throw new Error('[paginator] generateXlsx(): no table() nodes found in this document — nothing to export.')
  }

  const workbook = new ExcelJS.Workbook()
  if (metadata?.title !== undefined) workbook.title = metadata.title
  if (metadata?.author !== undefined) workbook.creator = metadata.author
  if (metadata?.subject !== undefined) workbook.subject = metadata.subject
  if (metadata?.keywords !== undefined) workbook.keywords = metadata.keywords.join(', ')

  const pageSize = resolvePageSize(doc.size)
  const contentWidthPx = pageSize.width - doc.margins.left - doc.margins.right

  tables.forEach((table, i) => writeTableSheet(workbook.addWorksheet(`Table ${i + 1}`), table, contentWidthPx))

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}
