import ExcelJS from 'exceljs/dist/exceljs.min.js'
import type { BorderStyle, Cell, Color, Worksheet } from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate/browser'
import { format as formatSpreadsheetValue } from 'ssf'
import type { WorkbenchDocumentFormat } from '@deepseek-ai/dsh-api-workbench-controller/types'

/** Position and size within one document page or slide. */
export interface DocumentPosition { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Safe paragraph or text-box content extracted from an Office document. */
export interface DocumentParagraph {
  readonly kind: 'paragraph'
  readonly text: string
  readonly heading: boolean
  readonly sourceIndex?: number
  readonly position?: DocumentPosition
  readonly fill?: string
  readonly stroke?: string
}
/** Safe cell text extracted from a read-only document table. */
export interface DocumentTable { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }
/** Browser-safe embedded image extracted from an Office document. */
export interface DocumentImage { readonly kind: 'image'; readonly source: string; readonly alt: string; readonly position?: DocumentPosition }
/** One document, slide, or CSV section prepared for Client rendering. */
export interface TextDocumentSection {
  readonly kind: 'document' | 'slide' | 'csv'
  readonly index?: number
  readonly part?: string
  readonly width?: number
  readonly height?: number
  readonly blocks: readonly (DocumentParagraph | DocumentTable | DocumentImage)[]
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
  readonly editable: boolean
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
  /** Embedded drawing objects positioned in worksheet coordinates. */
  readonly drawings: readonly SpreadsheetDrawing[]
}
/** One embedded XLSX image or chart prepared for browser rendering. */
export interface SpreadsheetDrawing {
  readonly kind: 'image' | 'chart'
  readonly row: number
  readonly column: number
  readonly rowSpan: number
  readonly columnSpan: number
  readonly source: string
  readonly label: string
  readonly supported: boolean
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
/** One editable PPTX slide text replacement. */
export interface PptxTextEdit {
  readonly kind: 'pptx'
  readonly slide: number
  readonly part: string
  readonly block: number
  readonly value: string
}
/** One pending editable Office text or cell replacement. */
export type DocumentEdit = DocxTextEdit | XlsxCellEdit | PptxTextEdit

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
    validateArchiveEntryName(entry.name)
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
 * unrelated ZIP entry's content and archive path before recompression.
 * @param data - original Base64 OOXML payload.
 * @param format - editable Office format.
 * @param edits - pending paragraph, table-cell, or worksheet-cell edits.
 * @returns Base64 replacement payload.
 */
export function serializeDocumentEdits(
  data: string,
  format: 'docx' | 'xlsx' | 'pptx',
  edits: readonly DocumentEdit[],
): string {
  const bytes = decodeBase64(data)
  inspectArchiveBounds(bytes)
  const files = unzipSync(bytes)
  if (format === 'docx') applyDocxEdits(files, edits.filter((edit): edit is DocxTextEdit => edit.kind === 'docx'))
  else if (format === 'xlsx') applyXlsxEdits(files, edits.filter((edit): edit is XlsxCellEdit => edit.kind === 'xlsx'))
  else applyPptxEdits(files, edits.filter((edit): edit is PptxTextEdit => edit.kind === 'pptx'))
  return encodeBase64(zipSync(files))
}

function parseDocx(files: Record<string, Uint8Array>): readonly DocumentSection[] {
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('DOCX does not contain word/document.xml')
  const root = parseXml(xml)
  const blocks: Array<DocumentParagraph | DocumentTable | DocumentImage> = []
  const relationships = files['word/_rels/document.xml.rels'] === undefined
    ? new Map<string, string>()
    : relationshipTargetsFromBytes(files['word/_rels/document.xml.rels'])
  const body = descendants(root, 'body')[0]
  if (body === undefined) return [{ kind: 'document', blocks }]
  for (const child of Array.from(body.children)) {
    if (child.localName === 'p') {
      blocks.push(paragraph(child))
      blocks.push(...documentImages(child, relationships, 'word/document.xml', files))
    }
    else if (child.localName === 'tbl') blocks.push(table(child))
  }
  return [{ kind: 'document', blocks }]
}

function parsePptx(files: Record<string, Uint8Array>): readonly DocumentSection[] {
  const fallbackNames = Object.keys(files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right))
  const presentation = files['ppt/presentation.xml']
  const presentationRoot = presentation === undefined ? undefined : parseXml(presentation)
  const presentationRels = files['ppt/_rels/presentation.xml.rels']
  const presentationTargets = presentationRels === undefined ? new Map<string, string>() : relationshipTargetsFromBytes(presentationRels)
  const orderedNames = presentationRoot === undefined ? [] : descendants(presentationRoot, 'sldId').flatMap((slide) => {
    const id = slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? slide.getAttribute('r:id')
    const target = id === null ? undefined : presentationTargets.get(id)
    return target === undefined ? [] : [resolveArchiveTarget('ppt/presentation.xml', target)]
  })
  const names = orderedNames.length === 0 ? fallbackNames : orderedNames
  const slideSize = presentationRoot === undefined ? undefined : descendants(presentationRoot, 'sldSz')[0]
  const width = Number(slideSize?.getAttribute('cx') ?? 12_192_000)
  const height = Number(slideSize?.getAttribute('cy') ?? 6_858_000)
  return names.map((name, index) => {
    const bytes = files[name]
    if (bytes === undefined) throw new Error(`PPTX entry is missing: ${name}`)
    const root = parseXml(bytes)
    const relationPath = `${name.slice(0, name.lastIndexOf('/'))}/_rels/${name.slice(name.lastIndexOf('/') + 1)}.rels`
    const relationships = files[relationPath] === undefined ? new Map<string, string>() : relationshipTargetsFromBytes(files[relationPath])
    const blocks: Array<DocumentParagraph | DocumentImage> = []
    let sourceIndex = 0
    const shapeTree = descendants(root, 'spTree')[0]
    for (const shape of Array.from(shapeTree?.children ?? [])) {
      const position = drawingPosition(shape, width, height)
      const text = descendants(shape, 't').map(node => node.textContent).join('')
      if (text !== '') {
        const fill = drawingColor(shape, 'solidFill')
        const stroke = drawingStroke(shape)
        blocks.push({
          kind: 'paragraph',
          text,
          heading: false,
          sourceIndex,
          ...(position === undefined ? {} : { position }),
          ...(fill === undefined ? {} : { fill }),
          ...(stroke === undefined ? {} : { stroke }),
        })
        sourceIndex += 1
      }
      const blip = descendants(shape, 'blip')[0]
      const embed = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ?? blip?.getAttribute('r:embed')
      const target = embed === null || embed === undefined ? undefined : relationships.get(embed)
      if (target !== undefined) {
        const image = files[resolveArchiveTarget(name, target)]
        if (image !== undefined) blocks.push({
          kind: 'image',
          source: mediaDataUri(image, target),
          alt: target.split('/').pop() ?? 'Slide image',
          ...(position === undefined ? {} : { position }),
        })
      }
    }
    return { kind: 'slide', index: index + 1, part: name, width: 1000, height: height / width * 1000, blocks }
  })
}

function applyPptxEdits(files: Record<string, Uint8Array>, edits: readonly PptxTextEdit[]): void {
  for (const edit of edits) {
    const path = edit.part
    const source = files[path]
    if (source === undefined) throw new Error('PPTX edit points outside the presentation')
    const root = parseXml(source)
    const textContainers = descendants(root, 'sp').filter(shape => descendants(shape, 't').some(node => node.textContent !== ''))
    const container = textContainers[edit.block]
    if (container === undefined) throw new Error('PPTX edit points outside the slide text')
    const textNodes = descendants(container, 't')
    const first = textNodes[0]
    if (first === undefined) {
      const paragraph = descendants(container, 'p').find(node => node.localName === 'p')
      if (paragraph === undefined) throw new Error('PPTX slide does not contain editable text')
      const run = appendXmlElement(paragraph, 'r')
      appendXmlElement(run, 't').textContent = edit.value
    } else {
      first.textContent = edit.value
      for (const text of textNodes.slice(1)) text.textContent = ''
    }
    files[path] = strToU8(new XMLSerializer().serializeToString(root))
  }
}

function documentImages(
  container: Element,
  relationships: ReadonlyMap<string, string>,
  documentPath: string,
  files: Readonly<Record<string, Uint8Array>>,
): DocumentImage[] {
  const result: DocumentImage[] = []
  for (const blip of descendants(container, 'blip')) {
    const embed = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ?? blip.getAttribute('r:embed')
    const target = embed === null ? undefined : relationships.get(embed)
    if (target !== undefined) {
      const media = files[resolveArchiveTarget(documentPath, target)]
      if (media !== undefined) result.push({ kind: 'image', source: mediaDataUri(media, target), alt: target.split('/').pop() ?? 'Document image' })
    }
  }
  return result
}

function drawingPosition(element: Element, documentWidth: number, documentHeight: number): DocumentPosition | undefined {
  const transform = descendants(element, 'xfrm')[0]
  const offset = transform === undefined ? undefined : descendants(transform, 'off')[0]
  const extent = transform === undefined ? undefined : descendants(transform, 'ext')[0]
  if (offset === undefined || extent === undefined || documentWidth <= 0 || documentHeight <= 0) return undefined
  return {
    x: Number(offset.getAttribute('x') ?? 0) / documentWidth * 100,
    y: Number(offset.getAttribute('y') ?? 0) / documentHeight * 100,
    width: Number(extent.getAttribute('cx') ?? 0) / documentWidth * 100,
    height: Number(extent.getAttribute('cy') ?? 0) / documentHeight * 100,
  }
}

function drawingColor(element: Element, localName: string): string | undefined {
  const color = descendants(element, localName)[0]
  const value = color === undefined ? undefined : descendants(color, 'srgbClr')[0]?.getAttribute('val')
  return value === null || value === undefined || !/^[\dA-Fa-f]{6}$/.test(value) ? undefined : `#${value}`
}

function drawingStroke(element: Element): string | undefined {
  const line = descendants(element, 'ln')[0]
  return line === undefined ? undefined : drawingColor(line, 'solidFill')
}

function mediaDataUri(bytes: Uint8Array, target: string): string {
  const extension = target.split('.').pop()?.toLowerCase()
  const mime = extension === 'jpg' || extension === 'jpeg'
    ? 'image/jpeg'
    : extension === 'gif'
      ? 'image/gif'
      : extension === 'webp'
        ? 'image/webp'
        : extension === 'svg'
          ? 'image/svg+xml'
          : 'image/png'
  return `data:${mime};base64,${encodeBase64(bytes)}`
}

async function parseXlsx(bytes: Uint8Array): Promise<readonly SpreadsheetSection[]> {
  if (bytes.byteLength > MAX_EXTRACTED_BYTES) throw new Error('workbook exceeds the preview limit')
  inspectArchiveBounds(bytes)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch {
    // Some producers emit drawing relationship targets with an absolute OOXML
    // path. ExcelJS rejects those targets even though the workbook itself is
    // valid. Retry only the parser input; the original archive remains the
    // source used by serializeDocumentEdits and is never sanitized or written.
    const parserInput = sanitizeXlsxForParser(bytes)
    if (parserInput !== bytes) {
      try {
        await workbook.xlsx.load(parserInput as unknown as Parameters<typeof workbook.xlsx.load>[0])
      } catch {
        return parseXlsxFallback(bytes)
      }
    } else {
      return parseXlsxFallback(bytes)
    }
  }
  let drawings: ReadonlyMap<number, readonly SpreadsheetDrawing[]>
  try {
    drawings = parseXlsxDrawings(bytes)
  } catch {
    // A malformed or producer-specific drawing part must not hide the
    // worksheet grid; the original drawing entries remain preserved on save.
    drawings = new Map()
  }
  let cells = 0
  let rows = 0
  return workbook.worksheets.map((worksheet, index) => {
    cells += worksheet.rowCount * worksheet.columnCount
    rows += worksheet.rowCount
    if (cells > MAX_TABLE_CELLS || rows > MAX_TABLE_ROWS) throw new Error('workbook exceeds the preview table limit')
    return worksheetSection(worksheet, index + 1, drawings.get(index + 1) ?? [])
  })
}

/**
 * Read the worksheet XML directly when ExcelJS rejects a valid OOXML extension.
 * This path intentionally exposes only bounded display data and never rewrites
 * the source archive; the incremental serializer continues to use the original
 * entries and relationships.
 */
function parseXlsxFallback(bytes: Uint8Array): readonly SpreadsheetSection[] {
  const files = unzipSync(bytes)
  const workbookBytes = files['xl/workbook.xml']
  const relationshipBytes = files['xl/_rels/workbook.xml.rels']
  if (workbookBytes === undefined || relationshipBytes === undefined) throw new Error('XLSX workbook metadata is incomplete')
  const workbookRoot = parseXml(workbookBytes)
  const relationships = relationshipTargetsFromBytes(relationshipBytes)
  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml'])
  const styles = parseXlsxStyles(files['xl/styles.xml'])
  const drawings = parseXlsxDrawings(bytes)
  const sections: SpreadsheetSection[] = []
  let totalRows = 0
  let totalCells = 0
  for (const [index, sheet] of descendants(workbookRoot, 'sheet').entries()) {
    const relationId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? sheet.getAttribute('r:id')
    const target = relationId === null ? undefined : relationships.get(relationId)
    if (target === undefined) throw new Error('XLSX worksheet relationship is missing')
    const path = resolveArchiveTarget('xl/workbook.xml', target)
    const worksheetBytes = files[path]
    if (worksheetBytes === undefined) throw new Error(`XLSX worksheet entry is missing: ${path}`)
    const section = fallbackWorksheetSection(parseXml(worksheetBytes), index + 1, sheet.getAttribute('name') ?? `Sheet${index + 1}`, sharedStrings, styles, drawings.get(index + 1) ?? [])
    totalRows += section.rows.length
    totalCells += section.rows.reduce((sum, row) => sum + row.cells.length, 0)
    if (totalRows > MAX_TABLE_ROWS || totalCells > MAX_TABLE_CELLS) throw new Error('workbook exceeds the preview table limit')
    sections.push(section)
  }
  return sections
}

function fallbackWorksheetSection(
  root: Document,
  index: number,
  name: string,
  sharedStrings: readonly string[],
  styles: ReadonlyMap<number, SpreadsheetCellStyle>,
  drawings: readonly SpreadsheetDrawing[],
): SpreadsheetSection {
  const sheetData = descendants(root, 'sheetData')[0]
  const rowNodes = sheetData === undefined ? [] : Array.from(sheetData.children).filter(node => node.localName === 'row')
  const cellsByRow = new Map<number, SpreadsheetCell[]>()
  let maxColumn = 0
  for (const rowNode of rowNodes) {
    const rowNumber = Number(rowNode.getAttribute('r') ?? cellsByRow.size + 1)
    const cells: SpreadsheetCell[] = []
    for (const cellNode of Array.from(rowNode.children).filter(node => node.localName === 'c')) {
      const reference = cellNode.getAttribute('r') ?? ''
      const match = /^([A-Z]+)(\d+)$/.exec(reference)
      if (match === null) continue
      const column = columnNumber(match[1] ?? 'A')
      const formula = descendants(cellNode, 'f')[0]
      const styleIndex = Number(cellNode.getAttribute('s') ?? 0)
      cells.push({
        column,
        text: fallbackCellText(cellNode, sharedStrings),
        editable: formula === undefined,
        columnSpan: 1,
        rowSpan: 1,
        style: styles.get(styleIndex) ?? {},
      })
      maxColumn = Math.max(maxColumn, column)
    }
    cellsByRow.set(rowNumber, cells)
  }
  const mergeMap = new Map<string, { readonly rowSpan: number; readonly columnSpan: number }>()
  const covered = new Set<string>()
  for (const merge of descendants(root, 'mergeCell')) {
    const range = parseRange(merge.getAttribute('ref') ?? '')
    if (range === undefined) continue
    mergeMap.set(cellKey(range.top, range.left), { rowSpan: range.bottom - range.top + 1, columnSpan: range.right - range.left + 1 })
    maxColumn = Math.max(maxColumn, range.right)
    for (let row = range.top; row <= range.bottom; row += 1) for (let column = range.left; column <= range.right; column += 1) {
      if (row !== range.top || column !== range.left) covered.add(cellKey(row, column))
    }
  }
  const maxRow = Math.max(0, ...cellsByRow.keys(), ...Array.from(mergeMap.keys(), key => Number(key.split(':')[0])))
  const columns = Array.from({ length: maxColumn }, (_, offset) => {
    const node = descendants(root, 'col').find(candidate => Number(candidate.getAttribute('min') ?? 0) <= offset + 1 && Number(candidate.getAttribute('max') ?? 0) >= offset + 1)
    const width = node?.getAttribute('width')
    return { index: offset + 1, label: columnLabel(offset + 1), width: node?.getAttribute('hidden') === '1' ? 0 : columnWidth(width === null || width === undefined ? undefined : Number(width)) }
  })
  const rows: SpreadsheetRow[] = []
  for (let row = 1; row <= maxRow; row += 1) {
    const rowNode = rowNodes.find(candidate => Number(candidate.getAttribute('r') ?? 0) === row)
    const height = rowNode?.getAttribute('ht')
    const sourceCells = cellsByRow.get(row) ?? []
    const cells = sourceCells
      .filter(cell => !covered.has(cellKey(row, cell.column)))
      .map(cell => ({ ...cell, ...(mergeMap.has(cellKey(row, cell.column)) ? mergeMap.get(cellKey(row, cell.column)) : {}) }))
    rows.push({ index: row, height: rowNode?.getAttribute('hidden') === '1' ? 0 : rowHeight(height === null || height === undefined ? undefined : Number(height)), cells })
  }
  const pane = descendants(root, 'pane')[0]
  const frozenRows = pane?.getAttribute('state') === 'frozen' ? Number(pane.getAttribute('ySplit') ?? 0) : 0
  const frozenColumns = pane?.getAttribute('state') === 'frozen' ? Number(pane.getAttribute('xSplit') ?? 0) : 0
  return { kind: 'sheet', index, name, rows, columns, frozenRows: Math.max(0, frozenRows), frozenColumns: Math.max(0, frozenColumns), drawings }
}

function parseSharedStrings(bytes: Uint8Array | undefined): readonly string[] {
  if (bytes === undefined) return []
  return descendants(parseXml(bytes), 'si').map(item => descendants(item, 't').map(text => text.textContent).join(''))
}

function fallbackCellText(cell: Element, sharedStrings: readonly string[]): string {
  const value = descendants(cell, 'v')[0]?.textContent ?? ''
  if (cell.getAttribute('t') === 's') return sharedStrings[Number(value)] ?? value
  if (cell.getAttribute('t') === 'inlineStr') return descendants(cell, 't')[0]?.textContent ?? ''
  if (cell.getAttribute('t') === 'b') return value === '1' ? 'TRUE' : 'FALSE'
  return value
}

function parseXlsxStyles(bytes: Uint8Array | undefined): ReadonlyMap<number, SpreadsheetCellStyle> {
  if (bytes === undefined) return new Map()
  const root = parseXml(bytes)
  const fonts = descendants(root, 'font').map(font => ({
    bold: descendants(font, 'b').length > 0 || undefined,
    italic: descendants(font, 'i').length > 0 || undefined,
    underline: descendants(font, 'u').length > 0 || undefined,
    strike: descendants(font, 'strike').length > 0 || undefined,
    fontSize: Number(descendants(font, 'sz')[0]?.getAttribute('val') ?? 0) || undefined,
    color: xlsxXmlColor(descendants(font, 'color')[0]),
  }))
  const fills = descendants(root, 'fill').map(fill => xlsxXmlColor(descendants(fill, 'fgColor')[0]))
  const cellXfs = descendants(root, 'cellXfs')[0]
  const result = new Map<number, SpreadsheetCellStyle>()
  for (const [index, xf] of Array.from(cellXfs?.children ?? []).entries()) {
    const font = fonts[Number(xf.getAttribute('fontId') ?? 0)]
    const fill = fills[Number(xf.getAttribute('fillId') ?? 0)]
    result.set(index, { ...font, background: fill })
  }
  return result
}

function xlsxXmlColor(element: Element | undefined): string | undefined {
  const value = element?.getAttribute('rgb') ?? element?.getAttribute('fgColor')
  return value !== null && value !== undefined && /^[A-Fa-f0-9]{8}$/.test(value) ? `#${value.slice(2)}` : undefined
}

function sanitizeXlsxForParser(bytes: Uint8Array): Uint8Array {
  inspectArchiveBounds(bytes)
  const sourceFiles: Record<string, Uint8Array> = unzipSync(bytes)
  const files: Record<string, Uint8Array> = {}
  let changed = false
  for (const name of Object.keys(sourceFiles)) {
    const source = sourceFiles[name]
    if (source === undefined) continue
    let next = source
    if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) {
      const result = normalizeXlsxRelationshipTargets(source)
      if (result !== undefined) { next = result; changed = true }
    }
    files[name] = next
  }
  return changed ? zipSync(files) : bytes
}

function normalizeXlsxRelationshipTargets(bytes: Uint8Array): Uint8Array | undefined {
  const root = parseXml(bytes)
  let changed = false
  for (const relationship of descendants(root, 'Relationship')) {
    const target = relationship.getAttribute('Target')
    if (target !== null && target.startsWith('/')) {
      relationship.setAttribute('Target', target.startsWith('/xl/') ? `../${target.slice('/xl/'.length)}` : target.slice(1))
      changed = true
    }
  }
  return changed ? strToU8(new XMLSerializer().serializeToString(root)) : undefined
}

function inspectArchiveBounds(bytes: Uint8Array): void {
  let extractedBytes = 0
  let entries = 0
  unzipSync(bytes, { filter: (entry) => {
    validateArchiveEntryName(entry.name)
    entries += 1
    extractedBytes += entry.originalSize
    if (entries > MAX_ARCHIVE_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('workbook expands beyond the preview limit')
    return false
  } })
}

function validateArchiveEntryName(name: string): void {
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
    throw new Error('document archive contains an unsafe path')
  }
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

function worksheetSection(worksheet: Worksheet, index: number, drawings: readonly SpreadsheetDrawing[]): SpreadsheetSection {
  const rowCount = worksheet.rowCount
  const columnCount = worksheet.columnCount
  if (rowCount > MAX_TABLE_ROWS || rowCount * columnCount > MAX_TABLE_CELLS) throw new Error('worksheet exceeds the preview cell limit')
  const merged = new Map<string, { readonly rowSpan: number; readonly columnSpan: number }>()
  const covered = new Set<string>()
  for (const range of worksheet.model.merges ?? []) {
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
      cells.push({
        column,
        text: cellText(cell),
        editable: !isFormulaCell(cell),
        columnSpan: span?.columnSpan ?? 1,
        rowSpan: span?.rowSpan ?? 1,
        style: cellStyle(cell),
      })
    }
    return { index, height: source.hidden ? 0 : rowHeight(source.height), cells }
  })
  const frozen = (worksheet.views ?? []).find(view => view.state === 'frozen')
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
    drawings,
  }
}

/**
 * Read worksheet drawing relationships without asking ExcelJS to rewrite them.
 * The result is deliberately presentation-only; the original drawing XML and
 * media entries remain in the source archive for the incremental serializer.
 */
function parseXlsxDrawings(bytes: Uint8Array): ReadonlyMap<number, readonly SpreadsheetDrawing[]> {
  const files = unzipSync(bytes)
  const workbook = files['xl/workbook.xml']
  const workbookRels = files['xl/_rels/workbook.xml.rels']
  if (workbook === undefined || workbookRels === undefined) return new Map()
  const workbookRoot = parseXml(workbook)
  const relationTargets = relationshipTargets(parseXml(workbookRels))
  const result = new Map<number, SpreadsheetDrawing[]>()
  const sheets = descendants(workbookRoot, 'sheet')
  sheets.forEach((sheet, sheetIndex) => {
    const relationId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? sheet.getAttribute('r:id')
    const target = relationId === null ? undefined : relationTargets.get(relationId)
    if (target === undefined) return
    const sheetPath = resolveArchiveTarget('xl/workbook.xml', target)
    const sheetXml = files[sheetPath]
    if (sheetXml === undefined) return
    const sheetRoot = parseXml(sheetXml)
    const drawingNode = descendants(sheetRoot, 'drawing')[0]
    const drawingRelationId = drawingNode?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? drawingNode?.getAttribute('r:id')
    if (drawingRelationId === null || drawingRelationId === undefined) return
    const sheetDirectory = sheetPath.slice(0, sheetPath.lastIndexOf('/'))
    const sheetName = sheetPath.slice(sheetPath.lastIndexOf('/') + 1)
    const sheetRels = files[`${sheetDirectory}/_rels/${sheetName}.rels`]
    if (sheetRels === undefined) return
    const drawingTarget = relationshipTargetsFromBytes(sheetRels).get(drawingRelationId)
    if (drawingTarget === undefined) return
    const drawingPath = resolveArchiveTarget(sheetPath, drawingTarget)
    const drawingXml = files[drawingPath]
    if (drawingXml === undefined) return
    const drawingRelsPath = `${drawingPath.slice(0, drawingPath.lastIndexOf('/'))}/_rels/${drawingPath.slice(drawingPath.lastIndexOf('/') + 1)}.rels`
    const drawingRels = files[drawingRelsPath] === undefined
      ? new Map<string, string>()
      : relationshipTargetsFromBytes(files[drawingRelsPath] as Uint8Array)
    const drawings = parseDrawingXml(drawingXml, drawingRels, drawingPath, files)
    if (drawings.length > 0) result.set(sheetIndex + 1, drawings)
  })
  return result
}

function relationshipTargets(root: Document): Map<string, string> {
  return new Map(descendants(root, 'Relationship').flatMap((relationship) => {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    return id === null || target === null ? [] : [[id, target] as const]
  }))
}

function relationshipTargetsFromBytes(bytes: Uint8Array): Map<string, string> {
  return relationshipTargets(parseXml(bytes))
}

function parseDrawingXml(
  bytes: Uint8Array,
  relationships: ReadonlyMap<string, string>,
  drawingPath: string,
  files: Readonly<Record<string, Uint8Array>>,
): SpreadsheetDrawing[] {
  const root = parseXml(bytes)
  const result: SpreadsheetDrawing[] = []
  for (const anchor of Array.from(root.getElementsByTagName('*')).filter(node => /Anchor$/.test(node.localName))) {
    const from = descendants(anchor, 'from')[0]
    const to = descendants(anchor, 'to')[0]
    const row = Number(descendants(from ?? anchor, 'row')[0]?.textContent ?? 0) + 1
    const column = Number(descendants(from ?? anchor, 'col')[0]?.textContent ?? 0) + 1
    const endRow = Number(descendants(to ?? anchor, 'row')[0]?.textContent ?? row - 1) + 1
    const endColumn = Number(descendants(to ?? anchor, 'col')[0]?.textContent ?? column - 1) + 1
    const picture = descendants(anchor, 'pic')[0]
    const chart = descendants(anchor, 'graphicFrame')[0]
    if (picture !== undefined) {
      const embed = descendants(picture, 'blip')[0]?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ?? descendants(picture, 'blip')[0]?.getAttribute('r:embed')
      const target = embed === null || embed === undefined ? undefined : relationships.get(embed)
      const media = target === undefined ? undefined : files[resolveArchiveTarget(drawingPath, target)]
      if (media !== undefined) {
        const extension = target?.split('.').pop()?.toLowerCase() ?? 'png'
        const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : 'image/png'
        result.push({ kind: 'image', row, column, rowSpan: Math.max(1, endRow - row + 1), columnSpan: Math.max(1, endColumn - column + 1), source: `data:${mime};base64,${encodeBase64(media)}`, label: target?.split('/').pop() ?? 'Embedded image', supported: true })
      }
    } else if (chart !== undefined) {
      const chartId = descendants(chart, 'chart')[0]?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? descendants(chart, 'chart')[0]?.getAttribute('r:id')
      const target = chartId === null || chartId === undefined ? undefined : relationships.get(chartId)
      const chartBytes = target === undefined ? undefined : files[resolveArchiveTarget(drawingPath, target)]
      if (chartBytes !== undefined) {
        const preview = chartPreview(chartBytes)
        result.push({ kind: 'chart', row, column, rowSpan: Math.max(1, endRow - row + 1), columnSpan: Math.max(1, endColumn - column + 1), source: preview.source, label: preview.label, supported: preview.supported })
      }
    }
  }
  return result
}

function chartPreview(bytes: Uint8Array): { readonly source: string; readonly label: string; readonly supported: boolean } {
  const root = parseXml(bytes)
  const type = Array.from(root.getElementsByTagName('*')).find(node => ['barChart', 'lineChart', 'pieChart', 'areaChart', 'scatterChart'].includes(node.localName))?.localName
    ?? Array.from(root.getElementsByTagName('*')).find(node => node.localName.endsWith('Chart'))?.localName
    ?? 'chart'
  const supported = ['barChart', 'lineChart', 'pieChart', 'areaChart', 'scatterChart'].includes(type)
  const label = supported ? type.replace('Chart', '') : `Unsupported ${type}`
  const title = descendants(root, 't').map(node => node.textContent).find(Boolean) ?? label
  const escaped = escapeXml(title)
  const bars = type === 'pieChart' ? '<circle cx="90" cy="70" r="46" fill="#4d6bfe"/><path d="M90 70L90 24A46 46 0 0 1 132 97Z" fill="#79a7ff"/>' : '<rect x="30" y="70" width="18" height="36" fill="#4d6bfe"/><rect x="60" y="50" width="18" height="56" fill="#79a7ff"/><rect x="90" y="34" width="18" height="72" fill="#9ec5ff"/><path d="M20 106H170" stroke="#6b7280"/><path d="M20 20V106" stroke="#6b7280"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 130" role="img"><rect width="180" height="130" fill="white"/><text x="90" y="15" text-anchor="middle" font-family="sans-serif" font-size="10">${escaped}</text>${bars}</svg>`
  return { source: `data:image/svg+xml;base64,${encodeBase64(strToU8(svg))}`, label, supported }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character)
}

function cellText(cell: Cell): string {
  if (cell.numFmt === 'General') return cell.text
  const value = cell.value
  const result = typeof value === 'object' && value !== null && 'result' in value ? value.result : value
  const displayValue = result instanceof Date ? excelDateNumber(result) : result
  if (typeof displayValue !== 'number') return cell.text
  try { return formatSpreadsheetValue(cell.numFmt, displayValue) } catch { return cell.text }
}

function isFormulaCell(cell: Cell): boolean {
  return typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value
}

function excelDateNumber(value: Date): number {
  return (value.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000
}

function cellStyle(cell: Cell): SpreadsheetCellStyle {
  const font = cell.font ?? {}
  const alignment = cell.alignment ?? {}
  const fill = cell.fill?.type === 'pattern' && cell.fill.pattern !== 'none' ? colorValue(cell.fill.fgColor) : undefined
  const borders = cell.border ?? {}
  return {
    bold: font.bold || undefined,
    italic: font.italic || undefined,
    underline: Boolean(font.underline && font.underline !== 'none') || undefined,
    strike: font.strike || undefined,
    fontSize: font.size,
    color: colorValue(font.color),
    background: fill,
    horizontal: displayHorizontal(alignment.horizontal),
    vertical: displayVertical(alignment.vertical),
    wrap: alignment.wrapText || undefined,
    top: borderValue(borders.top),
    right: borderValue(borders.right),
    bottom: borderValue(borders.bottom),
    left: borderValue(borders.left),
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
  if (format === 'docx') return name === 'word/document.xml' || name === 'word/_rels/document.xml.rels' || name.startsWith('word/media/')
  return name === 'ppt/presentation.xml'
    || name === 'ppt/_rels/presentation.xml.rels'
    || /^ppt\/slides\/slide\d+\.xml$/.test(name)
    || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name)
    || name.startsWith('ppt/media/')
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
