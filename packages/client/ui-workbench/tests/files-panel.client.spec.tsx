// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { FileReadValue } from '@deepseek-ai/dsh-api-workbench-controller/types'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import ExcelJS from 'exceljs'
import { FilesPanel } from '../src/client/panels/FilesPanel.tsx'

const sessionId = 'session' as SessionId

afterEach(cleanup)

function successful<T>(value: T) { return Promise.resolve({ ok: true as const, value }) }

function panel(value: FileReadValue) {
  const fileWrite = vi.fn((_request: Parameters<WorkbenchRemote['fileWrite']>[0]) => successful({ path: value.path, version: 'version-2' }))
  const remote = {
    fileList: vi.fn(() => successful({ path: '.', entries: [{ name: value.path, type: 'file' as const, version: value.version }] })),
    fileRead: vi.fn(() => successful(value)),
    fileWrite,
  } as unknown as WorkbenchRemote
  render(<ControlledFilesPanel remote={remote} />)
  return { fileWrite }
}

describe('FilesPanel', () => {
  it('opens a file selected before the panel mounts', async () => {
    const fileRead = vi.fn(() => successful({
      kind: 'text' as const,
      path: 'reports/result.md',
      content: 'selected result',
      version: 'version-1',
      mediaType: 'text/plain' as const,
    }))
    const remote = {
      fileList: vi.fn(() => successful({ path: 'reports', entries: [{ name: 'result.md', type: 'file' as const }] })),
      fileRead,
      fileWrite: vi.fn(),
    } as unknown as WorkbenchRemote
    render(<ControlledFilesPanel remote={remote} initialPath="reports" initialSelection="reports/result.md" />)

    expect(await screen.findByRole('textbox')).toHaveProperty('value', 'selected result')
    expect(fileRead).toHaveBeenCalledWith({ sessionId, path: 'reports/result.md' }, expect.any(AbortSignal))
  })

  it('keeps an edited text file open after a version-checked save', async () => {
    const { fileWrite } = panel({ kind: 'text', path: 'notes.md', content: 'first', version: 'version-1', mediaType: 'text/plain' })
    fireEvent.click(await screen.findByRole('button', { name: 'notes.md' }))
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: 'filesSave' }))

    await waitFor(() => {
      expect(fileWrite).toHaveBeenCalledWith({ kind: 'text', sessionId, path: 'notes.md', content: 'second', expectedVersion: 'version-1' })
    })
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'second')
  })

  it.each([
    ['image', { kind: 'media', path: 'image.png', data: 'iVBORw==', version: '1', mediaType: 'image/png' }, 'img'],
    ['audio', { kind: 'media', path: 'sound.ogg', data: 'T2dnUw==', version: '1', mediaType: 'audio/ogg' }, 'audio'],
    ['video', { kind: 'media', path: 'movie.webm', data: 'GkXfoA==', version: '1', mediaType: 'video/webm' }, 'video'],
  ] as const)('opens a browser-native %s preview', async (_label, value, selector) => {
    const { container } = renderMedia(value)
    fireEvent.click(await screen.findByRole('button', { name: value.path }))
    await waitFor(() => {
      const media = container.querySelector(selector)
      expect(media).not.toBeNull()
      expect(media?.getAttribute('src')).toBe(`data:${value.mediaType};base64,${value.data}`)
    })
    expect(screen.getByRole('button', { name: 'filesSave' })).toHaveProperty('disabled', true)
  })

  it('opens PDF through a browser-native Blob URL and releases it on close', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:workbench-pdf')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const value = { kind: 'media', path: 'document.pdf', data: 'JVBERg==', version: '1', mediaType: 'application/pdf' } as const
    const { container, unmount } = renderMedia(value)
    fireEvent.click(await screen.findByRole('button', { name: value.path }))
    const frame = await waitFor(() => {
      const result = container.querySelector('iframe')
      expect(result?.getAttribute('src')).toBe('blob:workbench-pdf')
      return result
    })
    expect(frame?.hasAttribute('sandbox')).toBe(false)
    expect(createObjectURL).toHaveBeenCalledOnce()
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:workbench-pdf')
  })

  it('renders CSV rows and editable DOCX body content', async () => {
    const csv = btoa('Name,Score\nAda,10\nGrace,9')
    const { container } = renderMedia({ kind: 'document', path: 'scores.csv', data: csv, version: '1', format: 'csv' })
    fireEvent.click(await screen.findByRole('button', { name: 'scores.csv' }))
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(container.querySelector('textarea')).toBeNull()

    cleanup()
    const documentXml = '<w:document xmlns:w="urn:schemas-microsoft-com:office:word"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>'
    const docxBytes = zipSync({ 'word/document.xml': strToU8(documentXml) })
    const docx = btoa(String.fromCharCode(...docxBytes))
    renderMedia({ kind: 'document', path: 'report.docx', data: docx, version: '1', format: 'docx' })
    fireEvent.click(await screen.findByRole('button', { name: 'report.docx' }))
    expect(await screen.findByRole('textbox', { name: 'filesParagraph 1' })).toHaveProperty('value', 'Report')
    expect(screen.getByRole('textbox', { name: 'filesParagraph 2' })).toHaveProperty('value', 'Hello')

    cleanup()
    const slideXml = '<p:sld xmlns:p="urn:schemas-microsoft-com:office:presentationml"><p:cSld><p:spTree><p:sp><p:txBody><p:p><p:r><p:t>Quarter results</p:t></p:r></p:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    const pptxBytes = zipSync({ 'ppt/slides/slide1.xml': strToU8(slideXml) })
    renderMedia({ kind: 'document', path: 'deck.pptx', data: btoa(String.fromCharCode(...pptxBytes)), version: '1', format: 'pptx' })
    fireEvent.click(await screen.findByRole('button', { name: 'deck.pptx' }))
    expect(await screen.findByRole('heading', { name: 'filesSlide 1' })).toBeTruthy()
    expect(screen.getByText('Quarter results')).toBeTruthy()

  })

  it('edits DOCX text and preserves unrelated archive entries on save', async () => {
    const documentXml = '<w:document xmlns:w="urn:schemas-microsoft-com:office:word"><w:body><w:p><w:r><w:t>Hello</w:t><w:t> world</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
    const media = Uint8Array.of(1, 2, 3, 4)
    const docxBytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/media/image1.png': media })
    const value = { kind: 'document', path: 'report.docx', data: bytesToBase64(docxBytes), version: 'version-1', format: 'docx' } as const
    const { fileWrite } = panel(value)
    fireEvent.click(await screen.findByRole('button', { name: 'report.docx' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'filesParagraph 1' }), { target: { value: 'Updated report' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'filesTableCell 1:1' }), { target: { value: 'Grace' } })
    fireEvent.click(screen.getByRole('button', { name: 'filesSave' }))

    await waitFor(() => { expect(fileWrite).toHaveBeenCalledOnce() })
    const request = fileWrite.mock.calls[0]?.[0]
    expect(request).toMatchObject({ kind: 'binary', path: 'report.docx', expectedVersion: 'version-1' })
    const archive = unzipSync(base64ToBytes((request as { data: string }).data))
    expect(archive['word/media/image1.png']).toEqual(media)
    expect(strFromU8(archive['word/document.xml'] ?? new Uint8Array())).toContain('Updated report')
    expect(strFromU8(archive['word/document.xml'] ?? new Uint8Array())).toContain('Grace')
  })

  it('edits positioned PPTX text and preserves slide media on save', async () => {
    const presentationXml = '<p:presentation xmlns:p="urn:schemas-microsoft-com:office:presentationml"><p:sldSz cx="1000" cy="600"/></p:presentation>'
    const slideXml = '<p:sld xmlns:p="urn:schemas-microsoft-com:office:presentationml" xmlns:a="urn:schemas-microsoft-com:office:drawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="100" y="100"/><a:ext cx="500" cy="120"/></a:xfrm><a:solidFill><a:srgbClr val="FFF4CC"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:t>Quarter results</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:spPr><a:xfrm><a:off x="200" y="260"/><a:ext cx="300" cy="200"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>'
    const slideRels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'
    const media = Uint8Array.of(137, 80, 78, 71)
    const bytes = zipSync({
      'ppt/presentation.xml': strToU8(presentationXml),
      'ppt/slides/slide1.xml': strToU8(slideXml),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(slideRels),
      'ppt/media/image1.png': media,
    })
    const value = { kind: 'document', path: 'deck.pptx', data: bytesToBase64(bytes), version: 'version-1', format: 'pptx' } as const
    const { fileWrite } = panel(value)
    fireEvent.click(await screen.findByRole('button', { name: 'deck.pptx' }))
    expect(await screen.findByRole('img', { name: 'image1.png' })).toBeTruthy()
    const editor = screen.getByRole('textbox', { name: 'filesParagraph 1' })
    expect(editor.getAttribute('style')).toContain('left: 10%')
    fireEvent.change(editor, { target: { value: 'Updated quarter' } })
    fireEvent.click(screen.getByRole('button', { name: 'filesSave' }))

    await waitFor(() => { expect(fileWrite).toHaveBeenCalledOnce() })
    const request = fileWrite.mock.calls[0]?.[0] as { data: string }
    const archive = unzipSync(base64ToBytes(request.data))
    expect(archive['ppt/media/image1.png']).toEqual(media)
    expect(strFromU8(archive['ppt/slides/_rels/slide1.xml.rels'] ?? new Uint8Array())).toBe(slideRels)
    expect(strFromU8(archive['ppt/slides/slide1.xml'] ?? new Uint8Array())).toContain('Updated quarter')
  })

  it('edits the selected XLSX worksheet and saves an OOXML replacement', async () => {
    const workbook = new ExcelJS.Workbook()
    const first = workbook.addWorksheet('First')
    first.getCell('A1').value = 'old'
    const second = workbook.addWorksheet('Second')
    second.getCell('B2').value = 12
    const value = { kind: 'document', path: 'book.xlsx', data: bytesToBase64(new Uint8Array(await workbook.xlsx.writeBuffer())), version: 'version-1', format: 'xlsx' } as const
    const { fileWrite } = panel(value)
    fireEvent.click(await screen.findByRole('button', { name: 'book.xlsx' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Second' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'B2' }), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'filesSave' }))

    await waitFor(() => { expect(fileWrite).toHaveBeenCalledOnce() })
    const request = fileWrite.mock.calls[0]?.[0] as { kind: string; data: string }
    expect(request.kind).toBe('binary')
    const saved = new ExcelJS.Workbook()
    await saved.xlsx.load(base64ToBytes(request.data) as unknown as Parameters<typeof saved.xlsx.load>[0])
    expect(saved.getWorksheet('First')?.getCell('A1').value).toBe('old')
    expect(saved.getWorksheet('Second')?.getCell('B2').value).toBe(42)
  })

  it('renders XLSX as a styled workbook grid with switchable worksheets', async () => {
    const workbook = new ExcelJS.Workbook()
    const summary = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
    summary.columns = [{ width: 18 }, { width: 12 }, { width: 12 }]
    summary.getRow(1).height = 27
    summary.mergeCells('A1:C1')
    summary.getCell('A1').value = 'Quarterly report'
    summary.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' } }
    summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
    summary.getCell('A2').value = 'Revenue'
    summary.getCell('B2').value = 42
    summary.getCell('B2').numFmt = '0.00'
    const details = workbook.addWorksheet('Details')
    details.addRow(['Owner', 'Value'])
    details.addRow(['Ada', 10])
    const data = bytesToBase64(new Uint8Array(await workbook.xlsx.writeBuffer()))
    const { container } = renderMedia({ kind: 'document', path: 'report.xlsx', data, version: '1', format: 'xlsx' })
    fireEvent.click(await screen.findByRole('button', { name: 'report.xlsx' }))

    const summaryTab = await screen.findByRole('tab', { name: 'Summary' })
    expect(summaryTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: '1' })).toBeTruthy()
    const merged = screen.getByRole('textbox', { name: 'A1' }).closest('td')
    expect(merged?.getAttribute('colspan')).toBe('3')
    expect(merged?.getAttribute('style')).toContain('font-weight: 700')
    expect(container.querySelector('col[style="width: 138px;"]')).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveProperty('value', '42.00')
    expect(screen.queryByDisplayValue('Ada')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(await screen.findByDisplayValue('Ada')).toBeTruthy()
    expect(screen.queryByDisplayValue('Quarterly report')).toBeNull()
  })

  it('renders workbook cells when unsupported drawings use absolute relationship targets', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Storyboard')
    worksheet.getCell('A1').value = { text: 'Scene one', hyperlink: 'https://example.com/scene-one' }
    worksheet.getCell('B2').value = 'Keep this cell'
    worksheet.getCell('E2').value = { formula: '1+1', result: 2 }
    const image = workbook.addImage({
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X6X7WQAAAABJRU5ErkJggg==',
      extension: 'png',
    })
    worksheet.addImage(image, 'C1:D3')
    const files = unzipSync(new Uint8Array(await workbook.xlsx.writeBuffer()))
    const relationshipsName = 'xl/worksheets/_rels/sheet1.xml.rels'
    const relationships = files[relationshipsName]
    if (relationships === undefined) throw new Error('fixture does not contain worksheet relationships')
    files[relationshipsName] = strToU8(strFromU8(relationships).replace('Target="../drawings/', 'Target="/xl/drawings/'))
    const data = bytesToBase64(zipSync(files))
    const value = { kind: 'document', path: 'storyboard.xlsx', data, version: '1', format: 'xlsx' } as const
    const { fileWrite } = panel(value)
    fireEvent.click(await screen.findByRole('button', { name: 'storyboard.xlsx' }))

    expect(await screen.findByRole('tab', { name: 'Storyboard' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveProperty('value', 'Scene one')
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveProperty('value', 'Keep this cell')
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveProperty('readOnly', true)
    expect(screen.getByRole('img', { name: 'image1.png' })).toBeTruthy()
    expect(screen.queryByText('filesPreviewUnavailable')).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'B2' }), { target: { value: 'Updated cell' } })
    fireEvent.click(screen.getByRole('button', { name: 'filesSave' }))
    await waitFor(() => { expect(fileWrite).toHaveBeenCalledOnce() })
    const request = fileWrite.mock.calls[0]?.[0] as { data: string }
    const saved = unzipSync(base64ToBytes(request.data))
    expect(saved['xl/media/image1.png']).toEqual(files['xl/media/image1.png'])
    expect(saved['xl/drawings/drawing1.xml']).toEqual(files['xl/drawings/drawing1.xml'])
    expect(strFromU8(saved[relationshipsName] ?? new Uint8Array())).toBe(strFromU8(files[relationshipsName] ?? new Uint8Array()))
    expect(strFromU8(saved['xl/worksheets/sheet1.xml'] ?? new Uint8Array())).toContain('<f>1+1</f>')
  })

  it('exposes distinct directory, file, and other entry kinds', async () => {
    const remote = {
      fileList: vi.fn(() => successful({ path: '.', entries: [
        { name: 'folder', type: 'directory' as const },
        { name: 'note.txt', type: 'file' as const, size: 12 },
        { name: 'socket', type: 'other' as const },
      ] })),
      fileRead: vi.fn(),
      fileWrite: vi.fn(),
    } as unknown as WorkbenchRemote
    render(<ControlledFilesPanel remote={remote} />)
    expect((await screen.findByRole('button', { name: 'folder' })).getAttribute('data-kind')).toBe('directory')
    expect(screen.getByRole('button', { name: 'note.txt' }).getAttribute('data-kind')).toBe('file')
    expect(screen.getByRole('button', { name: 'socket' }).getAttribute('data-kind')).toBe('other')
  })
})

function renderMedia(value: FileReadValue) {
  const fileWrite = vi.fn((_request: Parameters<WorkbenchRemote['fileWrite']>[0]) => successful({ path: value.path, version: 'version-2' }))
  const remote = {
    fileList: vi.fn(() => successful({ path: '.', entries: [{ name: value.path, type: 'file' as const, version: value.version }] })),
    fileRead: vi.fn(() => successful(value)),
    fileWrite,
  } as unknown as WorkbenchRemote
  return render(<ControlledFilesPanel remote={remote} />)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function ControlledFilesPanel({ remote, initialPath = '.', initialSelection }: {
  remote: WorkbenchRemote
  initialPath?: string
  initialSelection?: string
}) {
  const [path, setPath] = useState(initialPath)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialSelection)
  return <FilesPanel
    t={key => key}
    remote={remote}
    sessionId={sessionId}
    path={path}
    selectedPath={selectedPath}
    setPath={setPath}
    setSelectedPath={setSelectedPath}
  />
}
