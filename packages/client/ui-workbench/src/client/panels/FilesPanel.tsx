import { useEffect, useState, type CSSProperties } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { DocumentFileReadValue, FileEntry, FileReadValue, MediaFileReadValue } from '@deepseek-ai/dsh-api-workbench-controller/types'
import type { WorkbenchKey } from '../locales.ts'
import css from './panels.module.css'
import { decodeBase64, parseDocument, serializeDocumentEdits, type DocumentEdit, type DocumentSection, type SpreadsheetBorder, type SpreadsheetCellStyle, type SpreadsheetSection } from './document-preview.ts'

type Translator = (key: WorkbenchKey) => string
interface FilesPanelProps {
  t: Translator
  remote: WorkbenchRemote
  sessionId: SessionId
  path: string
  selectedPath: string | undefined
  setPath: (path: string) => void
  setSelectedPath: (path: string | undefined) => void
}

/** Session-workspace file browser with version-checked writes. */
export function FilesPanel({ t, remote, sessionId, path, selectedPath, setPath, setSelectedPath }: FilesPanelProps) {
  const [entries, setEntries] = useState<readonly FileEntry[]>([])
  const [opened, setOpened] = useState<FileReadValue | undefined>()
  const [content, setContent] = useState('')
  const [documentEdits, setDocumentEdits] = useState<readonly DocumentEdit[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  useEffect(() => {
    const controller = new AbortController()
    void remote.fileList({ sessionId, path }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) { setError(result.error.message); return }
      setPath(result.value.path)
      setEntries(result.value.entries)
    })
    return () => { controller.abort() }
  }, [path, remote, sessionId, setPath])
  useEffect(() => {
    if (selectedPath === undefined) {
      setOpened(undefined); setContent(''); setDocumentEdits([]); setDirty(false)
      return
    }
    const controller = new AbortController()
    setOpened(undefined); setContent(''); setDocumentEdits([]); setDirty(false)
    void remote.fileRead({ sessionId, path: selectedPath }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) { setError(result.error.message); return }
      setOpened(result.value); setContent(result.value.kind === 'text' ? result.value.content : ''); setDocumentEdits([]); setDirty(false); setError(undefined)
    })
    return () => { controller.abort() }
  }, [remote, selectedPath, sessionId])
  const open = (entry: FileEntry): void => {
    const nextPath = path === '.' ? entry.name : `${path}/${entry.name}`
    if (entry.type === 'directory') {
      setSelectedPath(undefined); setPath(nextPath); setError(undefined)
      return
    }
    setSelectedPath(nextPath)
  }
  const updateDocumentEdit = (edit: DocumentEdit): void => {
    setDocumentEdits((current) => {
      const next = current.filter(candidate => !sameDocumentLocation(candidate, edit))
      next.push(edit)
      setDirty(true)
      return next
    })
  }
  const save = async (): Promise<void> => {
    if (opened === undefined || !dirty || saving) return
    setSaving(true)
    try {
      if (opened.kind === 'text') {
        const result = await remote.fileWrite({ kind: 'text', sessionId, path: opened.path, content, expectedVersion: opened.version })
        if (!result.ok) { setError(result.error.message); return }
        setOpened({ ...opened, content, version: result.value.version })
      } else if (opened.kind === 'document' && (opened.format === 'docx' || opened.format === 'xlsx')) {
        const data = serializeDocumentEdits(opened.data, opened.format, documentEdits)
        const result = await remote.fileWrite({ kind: 'binary', sessionId, path: opened.path, data, expectedVersion: opened.version })
        if (!result.ok) { setError(result.error.message); return }
        setOpened({ ...opened, data, version: result.value.version })
        setDocumentEdits([])
      } else return
      setDirty(false); setError(undefined)
    } catch {
      setError(t('filesDocumentSaveFailed'))
    } finally {
      setSaving(false)
    }
  }
  const parent = path === '.' ? undefined : path.split('/').slice(0, -1).join('/') || '.'
  return <section className={css.panel} aria-label={t('files')}>
    <div className={css.toolbar}><button type="button" disabled={parent === undefined} onClick={() => { if (parent !== undefined) { setSelectedPath(undefined); setPath(parent); setError(undefined) } }}>↑</button><span className={css.address}>{path}</span><button type="button" disabled={!dirty || saving} onClick={() => { void save() }}>{saving ? t('filesSaving') : t('filesSave')}</button></div>
    {error === undefined ? null : <div className={css.error} role="alert">{error}</div>}
    <div className={css.filesBody}>
      <div className={css.fileList}>{entries.map((entry) => {
        const entryPath = path === '.' ? entry.name : `${path}/${entry.name}`
        const kindLabel = entry.type === 'directory' ? t('filesFolder') : entry.type === 'file' ? t('filesFile') : t('filesOther')
        return <button
          key={entry.name}
          type="button"
          className={css.fileItem}
          data-kind={entry.type}
          data-active={selectedPath === entryPath}
          aria-label={entry.name}
          aria-description={kindLabel}
          title={`${kindLabel}: ${entry.name}`}
          onClick={() => { open(entry) }}
        >
          <span className={css.entryIcon} aria-hidden="true" />
          <span className={css.entryName}>{entry.name}</span>
          {entry.size === undefined || entry.type === 'directory' ? null : <span className={css.entryMeta}>{formatBytes(entry.size)} {t('filesBytes')}</span>}
          {entry.type === 'directory' ? <span className={css.entryArrow} aria-hidden="true">›</span> : null}
        </button>
      })}</div>
      <div className={css.editor}>{opened === undefined
        ? <div className={css.muted}>{t('filesEmpty')}</div>
        : opened.kind === 'text'
          ? <textarea className={css.textEditor} value={content} onChange={(event) => { setContent(event.target.value); setDirty(true) }} />
          : opened.kind === 'document'
            ? <DocumentPreview file={opened} t={t} edits={documentEdits} onEdit={updateDocumentEdit} />
            : <MediaPreview file={opened} label={t('filesPreview')} />}</div>
    </div>
  </section>
}

/** Render one bounded browser-native media payload without executing workspace content. */
function MediaPreview({ file, label }: { file: MediaFileReadValue; label: string }) {
  const source = `data:${file.mediaType};base64,${file.data}`
  if (file.mediaType.startsWith('image/')) return <img className={css.mediaImage} src={source} alt={label} />
  if (file.mediaType.startsWith('audio/')) return <audio className={css.mediaAudio} src={source} controls aria-label={label} />
  if (file.mediaType.startsWith('video/')) return <video className={css.mediaVideo} src={source} controls aria-label={label} />
  return <PdfPreview file={file} label={label} />
}

function PdfPreview({ file, label }: { file: MediaFileReadValue; label: string }) {
  const [source, setSource] = useState<string>()
  useEffect(() => {
    const bytes = decodeBase64(file.data)
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const url = URL.createObjectURL(new Blob([payload], { type: file.mediaType }))
    setSource(url)
    return () => { URL.revokeObjectURL(url) }
  }, [file.data, file.mediaType])
  return source === undefined
    ? <div className={css.muted}>{label}</div>
    : <iframe className={css.mediaDocument} src={source} title={label} />
}

function DocumentPreview({ file, t, edits, onEdit }: {
  file: DocumentFileReadValue
  t: Translator
  edits: readonly DocumentEdit[]
  onEdit: (edit: DocumentEdit) => void
}) {
  const [state, setState] = useState<{ sections?: readonly DocumentSection[]; error?: true }>({})
  const [activeSheet, setActiveSheet] = useState(0)
  useEffect(() => {
    let active = true
    setState({})
    setActiveSheet(0)
    const timer = window.setTimeout(() => {
      void parseDocument(file.data, file.format).then(
        (sections) => { if (active) setState({ sections }) },
        () => { if (active) setState({ error: true }) },
      )
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [file])
  if (state.error === true) return <div className={css.muted} role="alert">{t('filesDocumentFailed')}</div>
  if (state.sections === undefined) return <div className={css.muted}>{t('filesDocumentLoading')}</div>
  const sheets = state.sections.filter((section): section is SpreadsheetSection => section.kind === 'sheet')
  if (sheets.length > 0) {
    return <SpreadsheetPreview
      file={file}
      sheets={sheets}
      activeSheet={activeSheet}
      setActiveSheet={setActiveSheet}
      t={t}
      edits={edits}
      onEdit={onEdit}
    />
  }
  return <div className={css.documentPreview}>
    {state.sections.map((section, sectionIndex) => <section key={`${section.kind}-${sectionIndex}`} className={css.documentSection} data-kind={section.kind}>
      <h2>{sectionTitle(section, file, t)}</h2>
      {section.kind === 'sheet' ? null : section.blocks.map((block, blockIndex) => block.kind === 'paragraph'
        ? file.format === 'docx'
          ? <textarea
            key={blockIndex}
            className={block.heading ? css.documentHeadingEditor : css.documentParagraphEditor}
            aria-label={`${t('filesParagraph')} ${blockIndex + 1}`}
            value={docxEditValue(edits, blockIndex, undefined, undefined) ?? block.text}
            onChange={(event) => { onEdit({ kind: 'docx', block: blockIndex, value: event.target.value }) }}
          />
          : block.heading ? <h3 key={blockIndex}>{block.text}</h3> : <p key={blockIndex}>{block.text}</p>
        : <table key={blockIndex}><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{file.format === 'docx'
          ? <textarea
            className={css.documentCellEditor}
            aria-label={`${t('filesTableCell')} ${rowIndex + 1}:${cellIndex + 1}`}
            value={docxEditValue(edits, blockIndex, rowIndex, cellIndex) ?? cell}
            onChange={(event) => { onEdit({ kind: 'docx', block: blockIndex, row: rowIndex, column: cellIndex, value: event.target.value }) }}
          />
          : cell}</td>)}</tr>)}</tbody></table>)}
    </section>)}
  </div>
}

function SpreadsheetPreview({ file, sheets, activeSheet, setActiveSheet, t, edits, onEdit }: {
  file: DocumentFileReadValue
  sheets: readonly SpreadsheetSection[]
  activeSheet: number
  setActiveSheet: (index: number) => void
  t: Translator
  edits: readonly DocumentEdit[]
  onEdit: (edit: DocumentEdit) => void
}) {
  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)]
  if (sheet === undefined) return <div className={css.muted}>{t('filesDocumentFailed')}</div>
  const columnOffsets = cumulativeOffsets(sheet.columns.map(column => column.width))
  const rowOffsets = cumulativeOffsets(sheet.rows.map(row => row.height))
  return <div className={css.spreadsheetPreview}>
    <div className={css.spreadsheetTitle}>{file.path.slice(file.path.lastIndexOf('/') + 1)}</div>
    <div className={css.spreadsheetViewport}>
      <table className={css.spreadsheetGrid} aria-label={`${t('filesSheet')}: ${sheet.name}`}>
        <colgroup>
          <col className={css.rowNumberColumn} />
          {sheet.columns.map(column => <col key={column.index} style={{ width: column.width }} />)}
        </colgroup>
        <thead><tr><th className={css.sheetCorner} aria-hidden="true" />{sheet.columns.map(column => <th key={column.index} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{sheet.rows.map(row => <tr key={row.index} style={{ height: row.height }}>
          <th className={css.rowNumber} scope="row">{row.index}</th>
          {row.cells.map(cell => <td
            key={cell.column}
            colSpan={cell.columnSpan}
            rowSpan={cell.rowSpan}
            style={spreadsheetCellStyle(cell.style, row.index, cell.column, sheet, rowOffsets, columnOffsets)}
          ><input
              className={css.spreadsheetCellEditor}
              aria-label={`${sheet.columns[cell.column - 1]?.label ?? ''}${row.index}`}
              value={xlsxEditValue(edits, sheet.index, row.index, cell.column) ?? cell.text}
              onChange={(event) => { onEdit({ kind: 'xlsx', sheet: sheet.index, row: row.index, column: cell.column, value: event.target.value }) }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            /></td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className={css.sheetTabs} role="tablist" aria-label={t('filesWorksheets')}>
      {sheets.map((candidate, index) => <button
        key={`${candidate.index}-${candidate.name}`}
        type="button"
        role="tab"
        aria-selected={index === activeSheet}
        data-active={index === activeSheet}
        onClick={() => { setActiveSheet(index) }}
      >{candidate.name}</button>)}
    </div>
  </div>
}

function sameDocumentLocation(left: DocumentEdit, right: DocumentEdit): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'xlsx' && right.kind === 'xlsx') {
    return left.sheet === right.sheet && left.row === right.row && left.column === right.column
  }
  return left.kind === 'docx' && right.kind === 'docx'
    && left.block === right.block && left.row === right.row && left.column === right.column
}

function docxEditValue(
  edits: readonly DocumentEdit[],
  block: number,
  row: number | undefined,
  column: number | undefined,
): string | undefined {
  const edit = edits.find(candidate => candidate.kind === 'docx' && candidate.block === block && candidate.row === row && candidate.column === column)
  return edit?.value
}

function xlsxEditValue(edits: readonly DocumentEdit[], sheet: number, row: number, column: number): string | undefined {
  const edit = edits.find(candidate => candidate.kind === 'xlsx' && candidate.sheet === sheet && candidate.row === row && candidate.column === column)
  return edit?.value
}

function spreadsheetCellStyle(
  style: SpreadsheetCellStyle,
  row: number,
  column: number,
  sheet: SpreadsheetSection,
  rowOffsets: readonly number[],
  columnOffsets: readonly number[],
): CSSProperties {
  const frozenRow = row <= sheet.frozenRows
  const frozenColumn = column <= sheet.frozenColumns
  return {
    fontWeight: style.bold === true ? 700 : undefined,
    fontStyle: style.italic === true ? 'italic' : undefined,
    textDecoration: [style.underline === true ? 'underline' : '', style.strike === true ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
    fontSize: style.fontSize,
    color: style.color,
    backgroundColor: style.background ?? (frozenRow || frozenColumn ? 'var(--dsw-specific-input-major, #fff)' : undefined),
    textAlign: style.horizontal,
    verticalAlign: style.vertical,
    whiteSpace: style.wrap === true ? 'pre-wrap' : 'nowrap',
    borderTop: borderCss(style.top),
    borderRight: borderCss(style.right),
    borderBottom: borderCss(style.bottom),
    borderLeft: borderCss(style.left),
    position: frozenRow || frozenColumn ? 'sticky' : undefined,
    top: frozenRow ? 25 + (rowOffsets[row - 1] ?? 0) : undefined,
    left: frozenColumn ? 40 + (columnOffsets[column - 1] ?? 0) : undefined,
    zIndex: frozenRow && frozenColumn ? 3 : frozenRow || frozenColumn ? 2 : undefined,
  }
}

function borderCss(border: SpreadsheetBorder | undefined): string | undefined {
  if (border === undefined) return undefined
  const width = border.style === 'thick' ? 3 : border.style.startsWith('medium') ? 2 : 1
  const line = border.style === 'double' ? 'double' : border.style.includes('dash') ? 'dashed' : border.style === 'dotted' || border.style === 'hair' ? 'dotted' : 'solid'
  return `${width}px ${line} ${border.color ?? '#808080'}`
}

function cumulativeOffsets(sizes: readonly number[]): readonly number[] {
  const offsets: number[] = []
  let offset = 0
  for (const size of sizes) { offsets.push(offset); offset += size }
  return offsets
}

function sectionTitle(section: DocumentSection, file: DocumentFileReadValue, t: Translator): string {
  if (section.kind === 'slide') return `${t('filesSlide')} ${section.index ?? ''}`.trim()
  if (section.kind === 'sheet') return section.name
  return file.path.slice(file.path.lastIndexOf('/') + 1)
}

function formatBytes(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}
