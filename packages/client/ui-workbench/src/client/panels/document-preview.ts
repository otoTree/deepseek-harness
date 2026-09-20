import ExcelJS from 'exceljs/dist/exceljs.min.js'
import type { BorderStyle, Cell, Color, Worksheet } from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate/browser'
import { format as formatSpreadsheetValue } from 'ssf'
import type { WorkbenchDocumentFormat } from '@deepseek-ai/dsh-api-workbench-controller/types'

/** Safe paragraph text extracted from a read-only document. */
export interface DocumentParagraph { readonly kind: 'paragraph'; readonly text: string; readonly heading: boolean }
/** Safe cell text extracted from a read-only document table. */
export interface DocumentTable { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }
/** One document, slide, or CSV section prepared for Client rendering. */
export interface TextDocumentSection {
  readonly kind: 'document' | 'slide' | 'csv'
  readonly index?: number
  readonly blocks: readonly (DocumentParagraph | DocumentTable)[]
}
/** One visible border from an XLSX cell style. */
export interface SpreadsheetBorder { readonly style: BorderStyle; readonly color?: string | undefined }
/** Browser-safe presentation fields preserved from an XLSX cell. */
export interface SpreadsheetCellStyle {
  readonly bold?: boolean | undefined
  readonly italic?: boolean | undefined
  readonly underline?: boolean | undefined
  readonly strike?: boolean | undefined
  readonly fontSize?: number | undefined
  readonly color?: string | undefined
  readonly background?: string | undefined
  readonly horizontal?: 'left' | 'center' | 'right' | 'justify' | undefined
  readonly vertical?: 'top' | 'middle' | 'bottom' | undefined
  readonly wrap?: boolean | undefined
  readonly top?: SpreadsheetBorder | undefined
  readonly right?: SpreadsheetBorder | undefined
  readonly bottom?: SpreadsheetBorder | undefined
  readonly left?: SpreadsheetBorder | undefined
}
/** One display cell in an XLSX worksheet editor. */
export interface SpreadsheetCell {
  readonly column: number
  readonly text: string
  readonly columnSpan: number
  readonly rowSpan: number
  readonly style: SpreadsheetCellStyle
}
/** One bounded row in an XLSX worksheet editor. */
export interface SpreadsheetRow { readonly index: number; readonly height: number; readonly cells: readonly SpreadsheetCell[] }
/** One bounded column in an XLSX worksheet editor. */
export interface SpreadsheetColumn { readonly index: number; readonly label: string; readonly width: number }
/** One XLSX worksheet prepared for workbook-style Client rendering. */
export interface SpreadsheetSection {
  readonly kind: 'sheet'
  readonly index: number
  readonly name: string
  readonly rows: readonly SpreadsheetRow[]
  readonly columns: readonly SpreadsheetColumn[]
  readonly frozenRows: number
  readonly frozenColumns: number
}
/** One document, slide, CSV table, or worksheet prepared for Client rendering. */
export type DocumentSection = TextDocumentSection | SpreadsheetSection

/** One editable DOCX text location. Omitted row/column fields address a paragraph block. */
export interface DocxTextEdit {
  readonly kind: 'docx'
  readonly block: number
  readonly row?: number
  readonly column?: number
  readonly value: string
}
/** One editable XLSX cell location in workbook order. */
export interface XlsxCellEdit {
  readonly kind: 'xlsx'
  readonly sheet: number
  readonly row: number
  readonly column: number
  readonly value: string
}
/** One pending editable Office text or cell replacement. */
export type DocumentEdit = DocxTextEdit | XlsxCellEdit

const MAX_EXTRACTED_BYTES = 64_000_000
const MAX_ARCHIVE_ENTRIES = 512
const MAX_TABLE_ROWS = 10_000
const MAX_TABLE_CELLS = 200_000
const DEFAULT_COLUMN_WIDTH = 72
const DEFAULT_ROW_HEIGHT = 24

/**
 * Decode one bounded Workbench document payload into safe display data.
 * @param data - Base64 payload returned by the Workbench Remote.
 * @param format - Allowlisted document format selected from the filename.
 * @returns safe display data with no executable document content.
 */
export async function parseDocument(data: string, format: WorkbenchDocumentFormat): Promise<readonly DocumentSection[]> {
  const bytes = decodeBase64(data)
  if (format === 'csv') return [{ kind: 'csv', blocks: [{ kind: 'table', rows: parseCsv(new TextDecoder().decode(bytes)) }] }]
  if (format === 'xlsx') return parseXlsx(bytes)
  let extractedBytes = 0
  let entries = 0
  const files = unzipSync(bytes, { filter: (entry) => {
    if (!wantedEntry(format, entry.name)) return false
    entries += 1
    extractedBytes += entry.originalSize
    if (entries > MAX_ARCHIVE_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('document expands beyond the preview limit')
    return true
  } })
  if (format === 'docx') return parseDocx(files)
  return parsePptx(files)
}

/** Decode one Base64 payload without introducing a Node Buffer into the Client bundle. */
export function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Encode browser bytes for a Workbench binary replacement request. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}

/**
 * Apply text edits to the original OOXML archive while retaining every
 * unrelated ZIP entry byte-for-byte before recompression.
 * @param data - original Base64 OOXML payload.
 * @param format - editable Office format.
 * @param edits - pending paragraph, table-cell, or worksheet-cell edits.
 * @returns Base64 replacement payload.
 */
export function serializeDocumentEdits(
  data: string,
  format: 'docx' | 'xlsx',
  edits: readonly DocumentEdit[],
): string {
  const bytes = decodeBase64(data)
  inspectArchiveBounds(bytes)
  const files = unzipSync(bytes)
  if (format === 'docx') applyDocxEdits(files, edits.filter((edit): edit is DocxTextEdit => edit.kind === 'docx'))
  else applyXlsxEdits(files, edits.filter((edit): edit is XlsxCellEdit => edit.kind === 'xlsx'))
  return encodeBase64(zipSync(files))
}

function parseDocx(files: Record<string, Uint8Array>): readonly DocumentSection[] {
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('DOCX does not contain word/document.xml')
  const root = parseXml(xml)
  const blocks: Array<DocumentParagraph | DocumentTable> = []
  const body = descendants(root, 'body')[0]
  if (body === undefined) return [{ kind: 'document', blocks }]
  for (const child of Array.from(body.children)) {
    if (child.localName === 'p') blocks.push(paragraph(child))
    else if (child.localName === 'tbl') blocks.push(table(child))
  }
  return [{ kind: 'document', blocks }]
}

function parsePptx(files: Record<string, Uint8Array>): readonly DocumentSection[] {
  const names = Object.keys(files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right))
  return names.map((name, index) => {
    const bytes = files[name]
    if (bytes === undefined) throw new Error(`PPTX entry is missing: ${name}`)
    const root = parseXml(bytes)
    const texts = descendants(root, 't').map(node => node.textContent).filter(Boolean)
    return { kind: 'slide', index: index + 1, blocks: [{ kind: 'paragraph', text: texts.join(' '), heading: false }] }
  })
}

async function parseXlsx(bytes: Uint8Array): Promise<readonly SpreadsheetSection[]> {
  if (bytes.byteLength > MAX_EXTRACTED_BYTES) throw new Error('workbook exceeds the preview limit')
  const sanitized = sanitizeXlsxArchive(bytes)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(sanitized as unknown as Parameters<typeof workbook.xlsx.load>[0])
  let cells = 0
  let rows = 0
  return workbook.worksheets.map((worksheet, index) => {
    cells += worksheet.rowCount * worksheet.columnCount
    rows += worksheet.rowCount
    if (cells > MAX_TABLE_CELLS || rows > MAX_TABLE_ROWS) throw new Error('workbook exceeds the preview table limit')
    return worksheetSection(worksheet, index + 1)
  })
}

function sanitizeXlsxArchive(bytes: Uint8Array): Uint8Array {
  inspectArchiveBounds(bytes)
  const sourceFiles: Record<string, Uint8Array> = unzipSync(bytes)
  const files: Record<string, Uint8Array> = {}
  let changed = false
  for (const name of Object.keys(sourceFiles)) {
    const source = sourceFiles[name]
    if (source === undefined) continue
    if (name.startsWith('xl/drawings/') || name.startsWith('xl/media/')) {
      changed = true
      continue
    }
    let next = source
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const result = removeXlsxElements(source, new Set(['drawing', 'legacyDrawing']))
      if (result !== undefined) {
        next = result
        changed = true
      }
    } else if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) {
      const result = removeXlsxDrawingRelationships(source)
      if (result !== undefined) {
        next = result
        changed = true
      }
    }
    files[name] = next
  }
  return changed ? zipSync(files) : bytes
}

function inspectArchiveBounds(bytes: Uint8Array): void {
  let extractedBytes = 0
  let entries = 0
  unzipSync(bytes, { filter: (entry) => {
    entries += 1
    extractedBytes += entry.originalSize
    if (entries > MAX_ARCHIVE_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('workbook expands beyond the preview limit')
    return false
  } })
}

function applyDocxEdits(files: Record<string, Uint8Array>, edits: readonly DocxTextEdit[]): void {
  const source = files['word/document.xml']
  if (source === undefined) throw new Error('DOCX does not contain word/document.xml')
  const root = parseXml(source)
  const body = descendants(root, 'body')[0]
  if (body === undefined) throw new Error('DOCX does not contain a document body')
  const blocks = Array.from(body.children).filter(child => child.localName === 'p' || child.localName === 'tbl')
  for (const edit of edits) {
    const block = blocks[edit.block]
    if (block === undefined) throw new Error('DOCX edit points outside the document body')
    if (edit.row === undefined || edit.column === undefined) {
      if (block.localName !== 'p') throw new Error('DOCX paragraph edit points to a table')
      replaceWordText(block, edit.value)
      continue
    }
    if (block.localName !== 'tbl') throw new Error('DOCX table edit points to a paragraph')
    const row = descendants(block, 'tr')[edit.row]
    const cell = row === undefined ? undefined : descendants(row, 'tc')[edit.column]
    if (cell === undefined) throw new Error('DOCX table edit points outside the table')
    replaceWordText(cell, edit.value)
  }
  files['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(root))
}

function replaceWordText(container: Element, value: string): void {
  const texts = descendants(container, 't')
  let first = texts[0]
  if (first === undefined) {
    const paragraph = container.localName === 'p'
      ? container
      : descendants(container, 'p')[0] ?? appendXmlElement(container, 'p')
    const run = appendXmlElement(paragraph, 'r')
    first = appendXmlElement(run, 't')
  }
  first.textContent = value
  if (/^\s|\s$/.test(value)) first.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
  else first.removeAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')
  for (const text of texts.slice(1)) text.textContent = ''
}

function applyXlsxEdits(files: Record<string, Uint8Array>, edits: readonly XlsxCellEdit[]): void {
  const workbookBytes = files['xl/workbook.xml']
  const relationshipBytes = files['xl/_rels/workbook.xml.rels']
  if (workbookBytes === undefined || relationshipBytes === undefined) throw new Error('XLSX workbook metadata is incomplete')
  const workbook = parseXml(workbookBytes)
  const relationships = parseXml(relationshipBytes)
  const targets = new Map(descendants(relationships, 'Relationship').map(relationship => [
    relationship.getAttribute('Id') ?? '',
    relationship.getAttribute('Target') ?? '',
  ]))
  const sheets = descendants(workbook, 'sheet')
  const bySheet = new Map<number, XlsxCellEdit[]>()
  for (const edit of edits) bySheet.set(edit.sheet, [...(bySheet.get(edit.sheet) ?? []), edit])
  for (const [sheetIndex, sheetEdits] of bySheet) {
    const sheet = sheets[sheetIndex - 1]
    if (sheet === undefined) throw new Error('XLSX edit points outside the workbook')
    const relationshipId = Array.from(sheet.attributes).find(attribute => attribute.localName === 'id' && (attribute.prefix === 'r' || attribute.name === 'r:id'))?.value
    const target = relationshipId === undefined ? undefined : targets.get(relationshipId)
    if (!target) throw new Error('XLSX worksheet relationship is missing')
    const path = resolveArchiveTarget('xl/workbook.xml', target)
    const source = files[path]
    if (source === undefined) throw new Error(`XLSX worksheet entry is missing: ${path}`)
    const document = parseXml(source)
    const sheetData = descendants(document, 'sheetData')[0]
    if (sheetData === undefined) throw new Error('XLSX worksheet does not contain sheetData')
    for (const edit of sheetEdits) replaceSpreadsheetCell(sheetData, edit)
    files[path] = strToU8(new XMLSerializer().serializeToString(document))
  }
}

function replaceSpreadsheetCell(sheetData: Element, edit: XlsxCellEdit): void {
  const reference = `${columnLabel(edit.column)}${edit.row}`
  let row = Array.from(sheetData.children).find(candidate => candidate.localName === 'row' && Number(candidate.getAttribute('r')) === edit.row)
  if (row === undefined) {
    row = createXmlElement(sheetData, 'row')
    row.setAttribute('r', String(edit.row))
    const next = Array.from(sheetData.children).find(candidate => candidate.localName === 'row' && Number(candidate.getAttribute('r')) > edit.row)
    sheetData.insertBefore(row, next ?? null)
  }
  let cell = Array.from(row.children).find(candidate => candidate.localName === 'c' && candidate.getAttribute('r') === reference)
  if (cell === undefined) {
    cell = createXmlElement(row, 'c')
    cell.setAttribute('r', reference)
    const next = Array.from(row.children).find(candidate => candidate.localName === 'c' && cellColumn(candidate.getAttribute('r')) > edit.column)
    row.insertBefore(cell, next ?? null)
  }
  while (cell.firstChild !== null) cell.removeChild(cell.firstChild)
  const numeric = isSpreadsheetNumber(edit.value)
  if (numeric) {
    cell.removeAttribute('t')
    appendXmlElement(cell, 'v').textContent = edit.value
  } else {
    cell.setAttribute('t', 'inlineStr')
    const text = appendXmlElement(appendXmlElement(cell, 'is'), 't')
    text.textContent = edit.value
    if (/^\s|\s$/.test(edit.value)) text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
  }
}

function isSpreadsheetNumber(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))
}

function cellColumn(reference: string | null): number {
  return reference === null ? Number.MAX_SAFE_INTEGER : columnNumber(reference.match(/^[A-Z]+/)?.[0] ?? 'ZZZZ')
}

function resolveArchiveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/')
  parts.pop()
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function createXmlElement(parent: Element, localName: string): Element {
  const prefix = parent.prefix
  return parent.ownerDocument.createElementNS(parent.namespaceURI, prefix === null ? localName : `${prefix}:${localName}`)
}

function appendXmlElement(parent: Element, localName: string): Element {
  const child = createXmlElement(parent, localName)
  parent.appendChild(child)
  return child
}

function removeXlsxElements(bytes: Uint8Array, localNames: ReadonlySet<string>): Uint8Array | undefined {
  const root = parseXml(bytes)
  const elements = Array.from(root.getElementsByTagName('*')).filter(element => localNames.has(element.localName))
  if (elements.length === 0) return undefined
  for (const element of elements) element.remove()
  return strToU8(new XMLSerializer().serializeToString(root))
}

function removeXlsxDrawingRelationships(bytes: Uint8Array): Uint8Array | undefined {
  const root = parseXml(bytes)
  const relationships = Array.from(root.getElementsByTagName('*')).filter((element) => {
    if (element.localName !== 'Relationship') return false
    const type = element.getAttribute('Type')
    return type !== null && /\/(?:drawing|vmlDrawing|image)$/.test(type)
  })
  if (relationships.length === 0) return undefined
  for (const relationship of relationships) relationship.remove()
  return strToU8(new XMLSerializer().serializeToString(root))
}

function worksheetSection(worksheet: Worksheet, index: number): SpreadsheetSection {
  const rowCount = worksheet.rowCount
  const columnCount = worksheet.columnCount
  if (rowCount > MAX_TABLE_ROWS || rowCount * columnCount > MAX_TABLE_CELLS) throw new Error('worksheet exceeds the preview cell limit')
  const merged = new Map<string, { readonly rowSpan: number; readonly columnSpan: number }>()
  const covered = new Set<string>()
  for (const range of worksheet.model.merges) {
    const parsed = parseRange(range)
    if (parsed === undefined) continue
    if (parsed.bottom > rowCount || parsed.right > columnCount) throw new Error('worksheet merge exceeds its dimensions')
    merged.set(cellKey(parsed.top, parsed.left), { rowSpan: parsed.bottom - parsed.top + 1, columnSpan: parsed.right - parsed.left + 1 })
    for (let row = parsed.top; row <= parsed.bottom; row += 1) {
      for (let column = parsed.left; column <= parsed.right; column += 1) {
        if (row !== parsed.top || column !== parsed.left) covered.add(cellKey(row, column))
      }
    }
  }
  const columns = Array.from({ length: columnCount }, (_, offset) => {
    const column = worksheet.getColumn(offset + 1)
    return { index: offset + 1, label: columnLabel(offset + 1), width: column.hidden ? 0 : columnWidth(column.width) }
  })
  const rows = Array.from({ length: rowCount }, (_, offset) => {
    const index = offset + 1
    const source = worksheet.getRow(index)
    const cells: SpreadsheetCell[] = []
    for (let column = 1; column <= columnCount; column += 1) {
      if (covered.has(cellKey(index, column))) continue
      const cell = source.getCell(column)
      const span = merged.get(cellKey(index, column))
      cells.push({ column, text: cellText(cell), columnSpan: span?.columnSpan ?? 1, rowSpan: span?.rowSpan ?? 1, style: cellStyle(cell) })
    }
    return { index, height: source.hidden ? 0 : rowHeight(source.height), cells }
  })
  const frozen = worksheet.views.find(view => view.state === 'frozen')
  const frozenRows = frozen !== undefined && 'ySplit' in frozen && typeof frozen.ySplit === 'number' ? frozen.ySplit : 0
  const frozenColumns = frozen !== undefined && 'xSplit' in frozen && typeof frozen.xSplit === 'number' ? frozen.xSplit : 0
  return {
    kind: 'sheet',
    index,
    name: worksheet.name,
    rows,
    columns,
    frozenRows: Math.max(0, frozenRows),
    frozenColumns: Math.max(0, frozenColumns),
  }
}

function cellText(cell: Cell): string {
  if (cell.numFmt === 'General') return cell.text
  const value = cell.value
  const result = typeof value === 'object' && value !== null && 'result' in value ? value.result : value
  const displayValue = result instanceof Date ? excelDateNumber(result) : result
  if (typeof displayValue !== 'number') return cell.text
  try { return formatSpreadsheetValue(cell.numFmt, displayValue) } catch { return cell.text }
}

function excelDateNumber(value: Date): number {
  return (value.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000
}

function cellStyle(cell: Cell): SpreadsheetCellStyle {
  const fill = cell.fill.type === 'pattern' && cell.fill.pattern !== 'none' ? colorValue(cell.fill.fgColor) : undefined
  return {
    bold: cell.font.bold || undefined,
    italic: cell.font.italic || undefined,
    underline: Boolean(cell.font.underline && cell.font.underline !== 'none') || undefined,
    strike: cell.font.strike || undefined,
    fontSize: cell.font.size,
    color: colorValue(cell.font.color),
    background: fill,
    horizontal: displayHorizontal(cell.alignment.horizontal),
    vertical: displayVertical(cell.alignment.vertical),
    wrap: cell.alignment.wrapText || undefined,
    top: borderValue(cell.border.top),
    right: borderValue(cell.border.right),
    bottom: borderValue(cell.border.bottom),
    left: borderValue(cell.border.left),
  }
}

function colorValue(color: Partial<Color> | undefined): string | undefined {
  const argb = color?.argb
  if (argb === undefined || !/^[\dA-Fa-f]{8}$/.test(argb)) return undefined
  return `#${argb.slice(2)}`
}

function borderValue(border: { readonly style?: BorderStyle; readonly color?: Partial<Color> } | undefined): SpreadsheetBorder | undefined {
  return border?.style === undefined ? undefined : { style: border.style, color: colorValue(border.color) }
}

function displayHorizontal(value: string | undefined): SpreadsheetCellStyle['horizontal'] {
  return value === 'center' || value === 'right' || value === 'justify' ? value : value === 'left' ? 'left' : undefined
}

function displayVertical(value: string | undefined): SpreadsheetCellStyle['vertical'] {
  return value === 'top' || value === 'middle' || value === 'bottom' ? value : undefined
}

function parseRange(value: string): {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
} | undefined {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(value)
  if (match === null) return undefined
  return { top: Number(match[2]), left: columnNumber(match[1] ?? 'A'), bottom: Number(match[4]), right: columnNumber(match[3] ?? 'A') }
}

function parseCsv(value: string): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let cells = 0
  const input = value.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? ''
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === ',') { row.push(field); field = ''; cells += 1 }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      row.push(field); rows.push(row); row = []; field = ''; cells += 1
      if (rows.length > MAX_TABLE_ROWS || cells > MAX_TABLE_CELLS) throw new Error('CSV exceeds the preview table limit')
    } else field += character
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function wantedEntry(format: Exclude<WorkbenchDocumentFormat, 'csv' | 'xlsx'>, name: string): boolean {
  if (format === 'docx') return name === 'word/document.xml'
  return /^ppt\/slides\/slide\d+\.xml$/.test(name)
}

function paragraph(node: Element): DocumentParagraph {
  const text = descendants(node, 't').map(child => child.textContent).join('')
  const style = descendants(node, 'pStyle')[0]?.getAttribute('val') ?? ''
  const headingMarkup = /<(?:[^:>\s]+:)?pStyle\b[^>]*(?:val|w:val)=(?:"|')Heading/i
  const heading = /^Heading/i.test(style) || headingMarkup.test(node.innerHTML)
  return { kind: 'paragraph', text, heading }
}

function table(node: Element): DocumentTable {
  return {
    kind: 'table',
    rows: descendants(node, 'tr').map(row => descendants(row, 'tc').map(cell => descendants(cell, 't').map(text => text.textContent).join(''))),
  }
}

function parseXml(bytes: Uint8Array): Document {
  const result = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  if (result.querySelector('parsererror') !== null) throw new Error('document XML is invalid')
  return result
}

function descendants(root: Element | Document, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(element => element.localName === localName || element.tagName === localName || element.tagName.endsWith(`:${localName}`))
}

function slideNumber(path: string): number { return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0) }
function cellKey(row: number, column: number): string { return `${row}:${column}` }
function columnWidth(value: number | undefined): number {
  return value === undefined ? DEFAULT_COLUMN_WIDTH : Math.min(600, Math.max(32, Math.round(value * 7 + 12)))
}
function rowHeight(value: number | undefined): number {
  return value === undefined ? DEFAULT_ROW_HEIGHT : Math.min(240, Math.max(18, Math.round(value * 4 / 3)))
}
function columnLabel(index: number): string {
  let value = index
  let result = ''
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26) }
  return result
}
function columnNumber(letters: string): number {
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  return value
}
