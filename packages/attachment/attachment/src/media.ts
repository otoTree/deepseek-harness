/** Provider-neutral MIME verification for verbatim file attachments. */

import { AttachmentError } from './error.ts'

const INSPECTION_PREFIX_BYTES = 8192
const TEXT_MEDIA_TYPES = new Set([
  'application/json',
  'application/xml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/xml',
])

function startsWith(data: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte)
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length))
}

function normalizedMediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const type = value.split(';', 1)[0]?.trim().toLowerCase()
  return type !== undefined && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(type)
    ? type
    : undefined
}

function detectedBinaryTypes(data: Uint8Array, name: string): ReadonlySet<string> {
  const types = new Set<string>()
  if (ascii(data, 0, 5) === '%PDF-') types.add('application/pdf')
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WAVE') types.add('audio/wav')
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'AVI ') types.add('video/x-msvideo')
  if (ascii(data, 0, 4) === 'OggS') {
    types.add('audio/ogg')
    types.add('video/ogg')
  }
  if (ascii(data, 0, 4) === 'fLaC') types.add('audio/flac')
  if (ascii(data, 0, 3) === 'ID3' || (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0)) types.add('audio/mpeg')
  if (data[0] === 0xff && ((data[1] ?? 0) & 0xf6) === 0xf0) types.add('audio/aac')
  if (startsWith(data, [0x1a, 0x45, 0xdf, 0xa3])) {
    types.add('video/webm')
    types.add('audio/webm')
  }
  if (ascii(data, 4, 4) === 'ftyp') {
    types.add('video/mp4')
    types.add('audio/mp4')
    types.add('video/quicktime')
  }
  if (startsWith(data, [0x00, 0x00, 0x01, 0xba]) || startsWith(data, [0x00, 0x00, 0x01, 0xb3])) {
    types.add('video/mpeg')
  }
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) {
    const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1]
    if (extension === 'docx') types.add('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    if (extension === 'xlsx') types.add('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    if (extension === 'pptx') types.add('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  }
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1]
    if (extension === 'doc') types.add('application/msword')
    if (extension === 'xls') types.add('application/vnd.ms-excel')
    if (extension === 'ppt') types.add('application/vnd.ms-powerpoint')
  }
  return types
}

/** Incremental verifier used by streaming attachment stores and network upload boundaries. */
export class FileMediaInspector {
  private readonly prefix: number[] = []
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private validText = true
  private finished = false

  /**
   * Observe one exact file chunk in order.
   * @param chunk - Next contiguous file bytes.
   */
  observe(chunk: Uint8Array): void {
    if (this.finished) throw new Error('File media inspection is already complete.')
    const remaining = INSPECTION_PREFIX_BYTES - this.prefix.length
    if (remaining > 0) this.prefix.push(...chunk.subarray(0, remaining))
    if (!this.validText) return
    try {
      this.decoder.decode(chunk, { stream: true })
      if (chunk.includes(0)) this.validText = false
    } catch {
      this.validText = false
    }
  }

  /**
   * Resolve a verified MIME type after the complete file has been observed.
   * Unsupported generic files return `undefined`; a supported declared type that conflicts with the bytes fails closed.
   * @param declared - caller-declared MIME type.
   * @param name - sanitized display filename used only to disambiguate container formats.
   * @returns the verified type when the file is eligible for native model input.
   */
  finish(declared: string | undefined, name: string): string | undefined {
    if (this.finished) throw new Error('File media inspection is already complete.')
    this.finished = true
    if (this.validText) {
      try { this.decoder.decode() } catch { this.validText = false }
    }
    const normalized = normalizedMediaType(declared)
    const binary = detectedBinaryTypes(Uint8Array.from(this.prefix), name)
    if (normalized !== undefined
      && ((TEXT_MEDIA_TYPES.has(normalized) && this.validText) || binary.has(normalized))) return normalized
    if (normalized !== undefined && (TEXT_MEDIA_TYPES.has(normalized) || normalized.startsWith('audio/')
      || normalized.startsWith('video/') || normalized === 'application/pdf'
      || normalized.includes('officedocument') || normalized.startsWith('application/vnd.ms-'))) {
      throw new AttachmentError('Declared file type does not match its bytes.', 'FILE_TYPE_MISMATCH')
    }
    if (binary.size === 1) return [...binary][0]
    return undefined
  }
}

/**
 * Verify one complete in-memory file and return its native-model MIME type when supported.
 * @param data - Complete file bytes.
 * @param declared - Caller-declared MIME type.
 * @param name - Sanitized display filename used to disambiguate container formats.
 * @returns Verified native-model MIME type, or `undefined` for an unsupported generic file.
 */
export function inspectFileMediaType(data: Uint8Array, declared: string | undefined, name: string): string | undefined {
  const inspection = new FileMediaInspector()
  inspection.observe(data)
  return inspection.finish(declared, name)
}
