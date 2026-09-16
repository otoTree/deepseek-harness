import { describe, expect, it } from 'vitest'
import { FileMediaInspector, inspectFileMediaType } from '../src/media.ts'

const bytes = (...values: Array<number | string>): Uint8Array => Uint8Array.from(values.flatMap(value => (
  typeof value === 'number' ? [value] : [...Buffer.from(value, 'binary')]
)))

describe('inspectFileMediaType', () => {
  it.each([
    ['application/pdf', 'report.pdf', bytes('%PDF-1.7\n')],
    ['audio/wav', 'voice.wav', bytes('RIFF', 0, 0, 0, 0, 'WAVE')],
    ['audio/mpeg', 'voice.mp3', bytes('ID3', 4, 0, 0)],
    ['audio/aac', 'voice.aac', bytes(0xff, 0xf1, 0x50, 0x80)],
    ['audio/ogg', 'voice.ogg', bytes('OggS', 0, 2)],
    ['audio/flac', 'voice.flac', bytes('fLaC', 0, 0)],
    ['video/webm', 'clip.webm', bytes(0x1a, 0x45, 0xdf, 0xa3)],
    ['video/mp4', 'clip.mp4', bytes(0, 0, 0, 24, 'ftyp', 'isom')],
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
    expect(() => inspectFileMediaType(bytes('not a pdf'), 'application/pdf', 'report.pdf'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
    expect(() => inspectFileMediaType(bytes(0, 1, 2, 3), 'audio/mpeg', 'voice.mp3'))
      .toThrow(expect.objectContaining({ code: 'FILE_TYPE_MISMATCH' }))
  })

  it('does not assign a native MIME type to unsupported binary data', () => {
    expect(inspectFileMediaType(bytes(0, 1, 2, 3), 'application/octet-stream', 'data.bin')).toBeUndefined()
  })

  it('allows exactly one completion and no observations afterward', () => {
    const inspector = new FileMediaInspector()
    inspector.observe(bytes('text'))
    expect(inspector.finish('text/plain', 'notes.txt')).toBe('text/plain')
    expect(() => inspector.finish('text/plain', 'notes.txt')).toThrow(/already complete/u)
    expect(() => { inspector.observe(bytes('more')) }).toThrow(/already complete/u)
  })
})
