import { describe, expect, it } from 'vitest'
import { FileMediaInspector, inspectFileMediaType } from '../src/media.ts'

const bytes = (...values: Array<number | string>): Uint8Array => Uint8Array.from(values.flatMap(value => (
  typeof value === 'number' ? [value] : [...Buffer.from(value, 'binary')]
)))

describe('inspectFileMediaType', () => {
  it.each([
    ['image/png', 'image.png', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)],
    ['image/jpeg', 'image.jpg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['image/gif', 'image.gif', bytes('GIF87a')],
    ['image/gif', 'image.gif', bytes('GIF89a')],
    ['image/webp', 'image.webp', bytes('RIFF', 0, 0, 0, 0, 'WEBP')],
    ['application/pdf', 'report.pdf', bytes('%PDF-1.7\n')],
    ['audio/wav', 'voice.wav', bytes('RIFF', 0, 0, 0, 0, 'WAVE')],
    ['audio/mpeg', 'voice.mp3', bytes('ID3', 4, 0, 0)],
    ['audio/aac', 'voice.aac', bytes(0xff, 0xf1, 0x50, 0x80)],
    ['audio/ogg', 'voice.ogg', bytes('OggS', 0, 2)],
    ['audio/flac', 'voice.flac', bytes('fLaC', 0, 0)],
    ['audio/mpeg', 'voice.mp3', bytes(0xff, 0xe0)],
    ['video/webm', 'clip.webm', bytes(0x1a, 0x45, 0xdf, 0xa3)],
    ['video/mp4', 'clip.mp4', bytes(0, 0, 0, 24, 'ftyp', 'isom')],
    ['video/x-msvideo', 'clip.avi', bytes('RIFF', 0, 0, 0, 0, 'AVI ')],
    ['video/mpeg', 'clip.mpeg', bytes(0, 0, 1, 0xba)],
    ['video/mpeg', 'clip.mpeg', bytes(0, 0, 1, 0xb3)],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx', bytes('PK', 3, 4)],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'report.xlsx', bytes('PK', 3, 4)],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'report.pptx', bytes('PK', 3, 4)],
    ['application/msword', 'report.doc', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    ['application/vnd.ms-excel', 'report.xls', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    ['application/vnd.ms-powerpoint', 'report.ppt', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
  ])('verifies %s from file bytes', (mediaType, name, data) => {
    expect(inspectFileMediaType(data, mediaType, name)).toBe(mediaType)
  })

  it.each(['text/plain', 'text/csv', 'text/markdown', 'text/xml', 'application/json', 'application/xml'])(
    'accepts valid UTF-8 for %s',
    (mediaType) => {
      expect(inspectFileMediaType(Buffer.from('中文,text\n'), `${mediaType}; charset=UTF-8`, 'notes.txt')).toBe(mediaType)
    },
  )

  it('detects a signature split across chunks', () => {
    const inspector = new FileMediaInspector()
    inspector.observe(bytes('%P'))
    inspector.observe(bytes('DF-'))
    expect(inspector.finish(undefined, 'report.pdf')).toBe('application/pdf')
  })

  it('fails closed when a supported declaration conflicts with bytes', () => {
    expect(() => inspectFileMediaType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a), 'image/jpeg', 'image.jpg'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
    expect(() => inspectFileMediaType(bytes('not a pdf'), 'application/pdf', 'report.pdf'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
    expect(() => inspectFileMediaType(bytes(0, 1, 2, 3), 'audio/mpeg', 'voice.mp3'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
    expect(() => inspectFileMediaType(bytes(0, 1, 2, 3), 'video/mp4', 'clip.mp4'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
    expect(() => inspectFileMediaType(bytes(0, 1, 2, 3),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
    expect(() => inspectFileMediaType(bytes(0, 1, 2, 3), 'application/vnd.ms-excel', 'report.xls'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
  })

  it('does not assign a native MIME type to unsupported binary data', () => {
    expect(inspectFileMediaType(bytes(0, 1, 2, 3), 'application/octet-stream', 'data.bin')).toBeUndefined()
    expect(inspectFileMediaType(bytes('PK', 3, 4), undefined, 'archive')).toBeUndefined()
    expect(inspectFileMediaType(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), undefined, 'archive'))
      .toBeUndefined()
    expect(inspectFileMediaType(bytes(0xff), undefined, 'data.bin')).toBeUndefined()
    expect(inspectFileMediaType(bytes('text'), 'invalid', 'notes.txt')).toBeUndefined()
  })

  it('bounds incremental signature buffering and rejects incomplete UTF-8 text', () => {
    const binary = new FileMediaInspector()
    binary.observe(new Uint8Array(8193))
    binary.observe(bytes(1))
    expect(binary.finish(undefined, 'data.bin')).toBeUndefined()

    const text = new FileMediaInspector()
    text.observe(bytes(0xc3))
    expect(() => text.finish('text/plain', 'notes.txt'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
  })

  it('allows exactly one completion and no observations afterward', () => {
    const inspector = new FileMediaInspector()
    inspector.observe(bytes('text'))
    expect(inspector.finish('text/plain', 'notes.txt')).toBe('text/plain')
    expect(() => inspector.finish('text/plain', 'notes.txt')).toThrow(/already complete/u)
    expect(() => { inspector.observe(bytes('more')) }).toThrow(/already complete/u)
  })
})
