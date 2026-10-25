/** Bounded ZIP and integrity verification shared by publishers and installed targets. */
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { satisfies } from 'semver'
import { z } from 'zod'
import { pluginManifest, resolvePluginTargets } from './index.ts'

/** Limits apply before decompression and to every expanded entry. */
export interface PluginPackageLimits {
  maxFiles: number
  maxPackageBytes: number
  maxEntryBytes: number
  maxExpandedBytes: number
}
/** Publisher and runtime defaults for a single plugin ZIP. */
export const defaultPluginPackageLimits: PluginPackageLimits = {
  maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024, maxExpandedBytes: 32 * 1024 * 1024,
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
/** Validate immutable archive identity, paths, declared targets and every entry digest before executing code.
 * @param bytes - Complete bounded ZIP.
 * @param release - Catalog identity and optional full archive digest.
 * @param limits - Compressed and decompressed budgets.
 * @returns Parsed manifest, verified entries and archive digest.
 */
export function verifyPluginPackage(
  bytes: Uint8Array,
  release?: { pluginId: string; version: string; digest?: string | undefined },
  limits: PluginPackageLimits = defaultPluginPackageLimits,
): { manifest: ReturnType<typeof pluginManifest.parse>; entries: Map<string, Uint8Array>; digest: string } {
  if (release?.digest !== undefined && digest(bytes) !== release.digest) throw new Error('Downloaded plugin package digest does not match the catalog')
  if (bytes.byteLength > limits.maxPackageBytes) throw new Error('Plugin ZIP exceeds the configured archive size limit')
  const names = new Set<string>()
  let expandedBytes = 0
  const files = unzipSync(bytes, { filter(entry) {
    if (!/^[A-Za-z0-9._/-]+$/u.test(entry.name) || entry.name.split('/').some(part => part === '..' || part === '.' || part === '')) {
      throw new Error(`Plugin ZIP contains unsafe entry ${entry.name}`)
    }
    if (names.has(entry.name)) throw new Error(`Plugin ZIP contains duplicate entry ${entry.name}`)
    names.add(entry.name)
    expandedBytes += entry.originalSize
    if (names.size > limits.maxFiles || entry.originalSize > limits.maxEntryBytes || expandedBytes > limits.maxExpandedBytes) {
      throw new Error('Plugin ZIP exceeds the configured extraction limits')
    }
    return true
  } })
  const manifestBytes = files['manifest.json']
  const integrityBytes = files['integrity.json']
  if (manifestBytes === undefined || integrityBytes === undefined) throw new Error('Plugin package omits manifest.json or integrity.json')
  const manifest = pluginManifest.parse(JSON.parse(strFromU8(manifestBytes)))
  if (release && (manifest.pluginId !== release.pluginId || manifest.version !== release.version)) throw new Error('Plugin package identity does not match the selected release')
  const integrity = JSON.parse(strFromU8(integrityBytes)) as unknown
  if (integrity === null || typeof integrity !== 'object' || Array.isArray(integrity)) throw new Error('Plugin package integrity.json must be an object')
  const records = integrity as Record<string, unknown>
  for (const [path, entry] of Object.entries(files)) {
    if (path === 'integrity.json') continue
    const insidePackage = manifest.packages?.some(item => path.startsWith(`packages/${item.id}/`)) ?? false
    if (!/^[A-Za-z0-9._/-]+$/u.test(path) || path.split('/').some(part => part === '..' || part === '.' || part === '')
      || (!insidePackage && path !== 'manifest.json' && !/^(?:host|client|assets)\//u.test(path))) throw new Error(`Plugin package contains unsafe entry ${path}`)
    if (records[path] !== digest(entry)) throw new Error(`Plugin package integrity check failed for ${path}`)
  }
  for (const path of Object.keys(records)) {
    if (path === 'integrity.json' || files[path] === undefined) throw new Error(`Plugin package integrity.json references missing entry ${path}`)
  }
  for (const { target } of resolvePluginTargets(manifest)) {
    const compatibility = /^dsh-(host|client)(.+)$/u.exec(target.compatibility)
    if (compatibility?.[1] !== target.kind || !satisfies('1.0.0', compatibility[2] ?? '')) throw new Error(`Unsupported plugin target compatibility ${target.compatibility}`)
    if (files[target.entry] === undefined) throw new Error(`Plugin package omits ${target.entry}`)
  }
  for (const item of manifest.packages ?? []) {
    const path = `packages/${item.id}/package.json`
    const packageBytes = files[path]
    if (packageBytes === undefined) throw new Error(`Plugin package omits ${path}`)
    const embedded = z.looseObject({ name: z.string(), version: z.string(), type: z.literal('module'), dependencies: z.record(z.string(), z.string()).default({}) }).parse(JSON.parse(strFromU8(packageBytes)))
    if (embedded.name !== item.name || embedded.version !== item.version
      || Object.keys(embedded.dependencies).length !== Object.keys(item.dependencies).length
      || Object.entries(embedded.dependencies).some(([name, range]) => item.dependencies[name] !== range)) {
      throw new Error(`Cordis package metadata does not match ${path}`)
    }
  }
  return { manifest, entries: new Map(Object.entries(files)), digest: digest(bytes) }
}
