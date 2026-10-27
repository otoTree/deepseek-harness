/** Offline package verification for immutable resources inside an Arivo installation. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'
import type { DesktopDistribution } from './config.ts'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const relativeFile = z.string().min(1).max(512).refine((value) => {
  if (!/^[A-Za-z0-9@_./+-]+$/u.test(value)) return false
  return value.split('/').every(part => part !== '' && part !== '.' && part !== '..'
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part) && !part.endsWith('.'))
})
const manifestSchema = z.object({
  format: z.literal(1),
  product: z.literal('com.arivo.studio'),
  plugin: z.literal('arivo.studio.core'),
  version: z.string().refine(value => semver.valid(value) === value),
  apiVersion: z.literal(1),
  target: z.enum(['darwin-arm64', 'win32-x64']),
  entrypoints: z.object({ host: relativeFile, client: relativeFile, agent: relativeFile }).strict(),
  files: z.array(z.object({ path: relativeFile, bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), sha256 }).strict())
    .min(1).max(8192),
}).strict()

/** Verified absolute entrypoints; the owning installation must remain immutable while loaded. */
export interface VerifiedBundledPlugin {
  readonly plugin: 'arivo.studio.core'
  readonly version: string
  readonly host: string
  readonly client: string
  readonly agent: string
}

/** Verify the complete packaged closure without a marketplace lease or network request.
 * @param options - Signed application-owned manifest digest, expected release and resource limits.
 * @returns Absolute entrypoints only after every file passes verification.
 */
export async function verifyBundledPlugin(options: {
  distribution: DesktopDistribution
  directory: string
  manifestSha256: string
  version: string
  target: 'darwin-arm64' | 'win32-x64'
  maxBytes: number
  signal?: AbortSignal
}): Promise<VerifiedBundledPlugin> {
  options.signal?.throwIfAborted()
  if (options.distribution.id !== 'arivo') throw new Error('Bundled Arivo plugins require the Arivo composition')
  sha256.parse(options.manifestSha256)
  if (!isAbsolute(options.directory)) throw new Error('Bundled plugin directory must be absolute')
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error('Invalid bundled plugin byte budget')
  const rootInfo = await lstat(options.directory)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Bundled plugin root must be a real directory')
  const root = await realpath(options.directory)
  const manifestPath = join(root, 'manifest.json')
  const manifestInfo = await lstat(manifestPath)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 1024 * 1024) {
    throw new Error('Bundled plugin manifest must be a bounded regular file')
  }
  const bytes = await readFile(manifestPath, { signal: options.signal })
  if (bytes.length > 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== options.manifestSha256) {
    throw new Error('Bundled plugin manifest digest mismatch')
  }
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (manifest.version !== options.version || manifest.target !== options.target) {
    throw new Error('Bundled plugin release or platform mismatch')
  }
  const files = new Map(manifest.files.map(file => [file.path, file]))
  const folded = new Set(manifest.files.map(file => file.path.toLowerCase()))
  if (files.size !== manifest.files.length || folded.size !== files.size || folded.has('manifest.json')) {
    throw new Error('Bundled plugin contains ambiguous file names')
  }
  const total = manifest.files.reduce((sum, file) => sum + file.bytes, bytes.length)
  if (!Number.isSafeInteger(total) || total > options.maxBytes) throw new Error('Bundled plugin exceeds its byte budget')
  for (const entry of Object.values(manifest.entrypoints)) {
    if (!files.has(entry) || !/\.m?js$/u.test(entry)) throw new Error('Bundled plugin entrypoint is not a listed ESM file')
  }
  const seen = new Set<string>()
  const directories = new Set<string>()
  for (const file of files.keys()) {
    const parts = file.split('/')
    for (let depth = 1; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join('/'))
  }
  const pending = ['']
  while (pending.length) {
    const directory = pending.pop()
    if (directory === undefined) break
    options.signal?.throwIfAborted()
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error('Bundled plugin links are forbidden')
      if (entry.isDirectory()) {
        if (!directories.has(relative)) throw new Error('Bundled plugin contains an unlisted directory')
        pending.push(relative)
        continue
      }
      if (!entry.isFile()) throw new Error('Bundled plugin contains a non-regular file')
      if (relative === 'manifest.json') continue
      const file = files.get(relative)
      if (!file) throw new Error('Bundled plugin contains an unlisted file')
      const path = join(root, ...relative.split('/'))
      const before = await lstat(path)
      if (!before.isFile() || before.isSymbolicLink() || before.size !== file.bytes) {
        throw new Error('Bundled plugin file size or type mismatch')
      }
      const hash = createHash('sha256')
      let readBytes = 0
      for await (const chunk of createReadStream(path, { signal: options.signal })) {
        const data = chunk as Buffer
        readBytes += data.length
        if (readBytes > file.bytes) throw new Error('Bundled plugin file grew during verification')
        hash.update(data)
      }
      const after = await lstat(path)
      if (readBytes !== file.bytes || hash.digest('hex') !== file.sha256 || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) {
        throw new Error('Bundled plugin file digest mismatch')
      }
      seen.add(relative)
    }
  }
  if (seen.size !== files.size) throw new Error('Bundled plugin is missing required files')
  return Object.freeze({
    plugin: manifest.plugin, version: manifest.version,
    host: join(root, ...manifest.entrypoints.host.split('/')),
    client: join(root, ...manifest.entrypoints.client.split('/')),
    agent: join(root, ...manifest.entrypoints.agent.split('/')),
  })
}

/** Activate a complete verified release and share one asynchronous disposal across callers.
 * @param options - Immutable installed resources and build-pinned manifest identity.
 * @param activate - Cancellable composition-owned registration; it must unwind effects if registration fails.
 * @returns Idempotent disposer that awaits all registered plugin shutdown work.
 */
export async function loadBundledPlugin(
  options: Parameters<typeof verifyBundledPlugin>[0],
  activate: (plugin: VerifiedBundledPlugin, signal?: AbortSignal) => Promise<() => void | Promise<void>>,
): Promise<() => Promise<void>> {
  const verified = await verifyBundledPlugin(options)
  options.signal?.throwIfAborted()
  const dispose = await activate(verified, options.signal)
  if (options.signal?.aborted) {
    await dispose()
    options.signal.throwIfAborted()
  }
  let closing: Promise<void> | undefined
  return () => { closing ??= Promise.resolve().then(dispose); return closing }
}
