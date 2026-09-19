/** Validate the immutable ZIP package exchanged by the enterprise plugin market. */
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { z } from 'zod'

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_HEADER = 0x06054b50
const DEFAULT_MAX_FILES = 256
const DEFAULT_MAX_PACKAGE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024

/** Deployment limits applied while parsing a package. */
export interface PluginPackageLimits {
  maxFiles?: number
  maxPackageBytes?: number
  maxEntryBytes?: number
}

/** Manifest accepted by the first desktop marketplace release. */
export const pluginManifest = z.object({
  schemaVersion: z.literal(1),
  pluginId: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
  targets: z.array(z.object({
    kind: z.enum(['client', 'host']),
    entry: z.string().regex(/^(?:client|host)\/[A-Za-z0-9._/-]+\.js$/),
    compatibility: z.string().trim().min(1).max(120),
    contributions: z.array(z.string().trim().min(1).max(160)).default([]),
  }).strict()).min(1).max(2),
  contributions: z.union([
    z.array(z.string().trim().min(1).max(160)),
    z.record(z.string(), z.json()),
  ]).default([]),
  permissions: z.array(z.string().trim().min(1).max(120)).max(128).default([]),
  dependencies: z.record(z.string(), z.string().trim().min(1).max(200)).default({}),
  build: z.object({ runtime: z.string().trim().min(1).max(80), lockfileDigest: z.string().length(64) }).strict(),
}).strict().superRefine((manifest, ctx) => {
  const kinds = new Set(manifest.targets.map(target => target.kind))
  if (kinds.size !== manifest.targets.length) ctx.addIssue({ code: 'custom', message: 'manifest declares a target more than once', path: ['targets'] })
  for (const target of manifest.targets) {
    if (!target.entry.startsWith(`${target.kind}/`)) ctx.addIssue({ code: 'custom', message: 'target entry must be inside its target directory', path: ['targets'] })
  }
})

/** SHA-256 digest rendered as lowercase hexadecimal. */
export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]),
    )
    return item
  }
  return JSON.stringify(canonical(value))
}

type ZipEntry = { path: string; data: Uint8Array; mode: number }

function readByte(bytes: Uint8Array, offset: number): number {
  const value = bytes.at(offset)
  if (value === undefined) fail('truncated integer')
  return value
}

function readU16(bytes: Uint8Array, offset: number): number {
  return readByte(bytes, offset) | (readByte(bytes, offset + 1) << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (readByte(bytes, offset)
    | (readByte(bytes, offset + 1) << 8)
    | (readByte(bytes, offset + 2) << 16)
    | (readByte(bytes, offset + 3) << 24)) >>> 0
}

function fail(message: string): never { throw new Error(`Invalid plugin package: ${message}`) }

function decodeEntry(bytes: Uint8Array, offset: number, compressed: number, method: number, expected: number): Uint8Array {
  if (offset + compressed > bytes.length) fail('entry exceeds package')
  if (method === 0) return bytes.slice(offset, offset + compressed)
  if (method === 8) return new Uint8Array(inflateRawSync(bytes.slice(offset, offset + compressed), { maxOutputLength: expected }))
  fail(`unsupported compression method ${method}`)
}

function parseZip(bytes: Uint8Array, limits: Required<PluginPackageLimits>): ZipEntry[] {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxPackageBytes) fail('package size is outside the configured limit')
  const endStart = Math.max(0, bytes.length - 65_557)
  let end = -1
  for (let offset = bytes.length - 22; offset >= endStart; offset -= 1) {
    if (readU32(bytes, offset) === END_HEADER) { end = offset; break }
  }
  if (end < 0) fail('end-of-central-directory record is missing')
  const count = readU16(bytes, end + 10)
  const directoryBytes = readU32(bytes, end + 12)
  const directoryOffset = readU32(bytes, end + 16)
  if (count === 0 || count > limits.maxFiles || directoryOffset + directoryBytes > end) fail('central directory is invalid')
  const entries: ZipEntry[] = []
  let cursor = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (readU32(bytes, cursor) !== CENTRAL_HEADER) fail('central directory entry is invalid')
    const method = readU16(bytes, cursor + 10)
    const compressed = readU32(bytes, cursor + 20)
    const uncompressed = readU32(bytes, cursor + 24)
    const nameLength = readU16(bytes, cursor + 28)
    const extraLength = readU16(bytes, cursor + 30)
    const commentLength = readU16(bytes, cursor + 32)
    const mode = readU32(bytes, cursor + 38) >>> 16
    const localOffset = readU32(bytes, cursor + 42)
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))
    if (!name || name.endsWith('/') || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '')) fail(`unsafe entry path ${JSON.stringify(name)}`)
    if (uncompressed > limits.maxEntryBytes || localOffset + 30 > bytes.length) fail('entry size is outside the configured limit')
    if ((mode & 0xf000) === 0xa000) fail('symbolic links are not allowed')
    if (readU32(bytes, localOffset) !== LOCAL_HEADER) fail('local entry is invalid')
    const localNameLength = readU16(bytes, localOffset + 26)
    const localExtraLength = readU16(bytes, localOffset + 28)
    const localName = new TextDecoder().decode(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength))
    if (localName !== name) fail(`local and central entry names differ for ${name}`)
    const data = decodeEntry(bytes, localOffset + 30 + localNameLength + localExtraLength, compressed, method, uncompressed)
    if (data.byteLength !== uncompressed) fail(`entry size mismatch for ${name}`)
    if (entries.some(entry => entry.path === name)) fail(`duplicate entry ${name}`)
    entries.push({ path: name, data, mode })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Parsed, verified package contents used by publication and download paths. */
export interface ParsedPluginPackage {
  bytes: Uint8Array
  manifest: z.infer<typeof pluginManifest>
  manifestDigest: string
  packageDigest: string
  permissionsDigest: string
  entries: ReadonlyMap<string, Uint8Array>
}

/** Parse and validate one standard `.dsh-plugin.zip` package. */
export function parsePluginPackage(input: Uint8Array, configured: PluginPackageLimits = {}): ParsedPluginPackage {
  const limits = {
    maxFiles: configured.maxFiles ?? DEFAULT_MAX_FILES,
    maxPackageBytes: configured.maxPackageBytes ?? DEFAULT_MAX_PACKAGE_BYTES,
    maxEntryBytes: configured.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
  }
  const entries = parseZip(input, limits)
  const byPath = new Map(entries.map(entry => [entry.path, entry.data]))
  const manifestBytes = byPath.get('manifest.json')
  const integrityBytes = byPath.get('integrity.json')
  if (!manifestBytes || !integrityBytes) fail('manifest.json and integrity.json are required')
  let manifest: z.infer<typeof pluginManifest>
  let integrity: Record<string, unknown>
  try {
    manifest = pluginManifest.parse(JSON.parse(new TextDecoder().decode(manifestBytes)))
    integrity = z.record(z.string(), z.string().length(64)).parse(JSON.parse(new TextDecoder().decode(integrityBytes)))
  } catch (error) {
    fail(error instanceof Error ? error.message : 'manifest or integrity JSON is invalid')
  }
  const expectedPaths = new Set(['manifest.json', 'integrity.json', ...manifest.targets.map(target => target.entry)])
  for (const path of byPath.keys()) if (!expectedPaths.has(path) && !path.startsWith('assets/')) fail(`unexpected entry ${path}`)
  for (const target of manifest.targets) if (!byPath.has(target.entry)) fail(`missing target entry ${target.entry}`)
  for (const [path, expected] of Object.entries(integrity)) {
    const value = byPath.get(path)
    if (!value || sha256(value) !== expected) fail(`integrity mismatch for ${path}`)
  }
  for (const path of byPath.keys()) {
    if (path !== 'integrity.json' && integrity[path] === undefined) fail(`integrity entry is missing for ${path}`)
  }
  const canonical = canonicalJson(manifest)
  const permissions = canonicalJson([...manifest.permissions].sort())
  return {
    bytes: input,
    manifest,
    manifestDigest: sha256(new TextEncoder().encode(canonical)),
    packageDigest: sha256(input),
    permissionsDigest: sha256(new TextEncoder().encode(permissions)),
    entries: byPath,
  }
}
