import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parsePluginPackage, type ParsedPluginPackage } from '@deepseek-ai/dsh-enterprise-api/plugin-package'

/** A package discovered in the user plugin workspace. */
export interface LocalPluginPackage {
  readonly path: string
  readonly fileName: string
  readonly pluginId: string
  readonly version: string
  readonly packageDigest: string
  readonly packageSize: number
  readonly parsed: ParsedPluginPackage
}

/**
 * Discover only built ZIP artifacts below `<root>/<pluginId>/dist`.
 * Source files and arbitrary paths are never returned to the installer.
 * @param root - plugin workspace, normally `~/Desktop/plugins`.
 * @returns verified package metadata sorted by plugin id and version.
 */
export async function discoverLocalPluginPackages(root: string): Promise<readonly LocalPluginPackage[]> {
  if (!isAbsolute(root)) throw new TypeError('Local plugin workspace must be an absolute path')
  const workspace = resolve(root)
  let pluginEntries: string[]
  try { pluginEntries = await readdir(workspace) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const discovered: LocalPluginPackage[] = []
  for (const pluginId of pluginEntries.sort()) {
    const pluginRoot = join(workspace, pluginId)
    if (relative(workspace, pluginRoot).startsWith('..')) continue
    if (!(await isDirectory(pluginRoot))) continue
    const dist = join(pluginRoot, 'dist')
    if (!(await isDirectory(dist))) continue
    for (const fileName of (await readdir(dist)).sort()) {
      if (!fileName.endsWith('.dsh-plugin.zip')) continue
      const path = join(dist, fileName)
      if (!(await isRegularFile(path))) continue
      const bytes = new Uint8Array(await readFile(path))
      let parsed: ParsedPluginPackage
      try { parsed = parsePluginPackage(bytes) } catch { continue }
      if (parsed.manifest.pluginId !== pluginId) continue
      discovered.push({
        path, fileName, pluginId: parsed.manifest.pluginId, version: parsed.manifest.version,
        packageDigest: parsed.packageDigest, packageSize: bytes.byteLength, parsed,
      })
    }
  }
  return discovered.sort((left, right) => left.pluginId.localeCompare(right.pluginId)
    || left.version.localeCompare(right.version, undefined, { numeric: true }))
}

/** Read a path previously returned by {@link discoverLocalPluginPackages}. */
export async function readLocalPluginPackage(root: string, path: string): Promise<Uint8Array> {
  if (!isAbsolute(root) || !isAbsolute(path)) throw new TypeError('Local plugin paths must be absolute')
  const workspace = resolve(root)
  const candidate = resolve(path)
  const rel = relative(workspace, candidate)
  const segments = rel.split(/[\\/]/u)
  if (rel.startsWith('..') || segments.length !== 3 || segments[1] !== 'dist' || segments[2] === undefined || !segments[2].endsWith('.dsh-plugin.zip')) {
    throw new Error('Local plugin path is outside the built artifact directory')
  }
  const bytes = new Uint8Array(await readFile(candidate))
  parsePluginPackage(bytes)
  return bytes
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

async function isRegularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}
