import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const root = resolve(import.meta.dirname, '..')
const encoder = new TextEncoder()
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

const manifestPath = resolve(root, 'manifest.json')
const manifest = await readJson(manifestPath)
const lockPath = resolve(root, 'pnpm-lock.yaml')
if (!existsSync(lockPath)) throw new Error('Run pnpm install in the extracted kit before packaging so pnpm-lock.yaml exists.')
manifest.build.lockfileDigest = digest(await readFile(lockPath))
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const entries = new Map()
const addText = async path => entries.set(path, encoder.encode(await readFile(resolve(root, path), 'utf8')))
const addBytes = async path => entries.set(path, new Uint8Array(await readFile(resolve(root, path))))
await addText('manifest.json')
await addText('packages/standard/package.json')
await addText('packages/standard/presets/default/agent.cordis.yml')
await addBytes('packages/standard/host/index.js')
await addBytes('packages/standard/client/index.js')

const integrity = Object.fromEntries([...entries.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, bytes]) => [path, digest(bytes)]))
entries.set('integrity.json', strToU8(`${JSON.stringify(integrity, null, 2)}\n`))

await mkdir(resolve(root, 'dist'), { recursive: true })
const output = resolve(root, 'dist', `${manifest.pluginId}-${manifest.version}.dsh-plugin.zip`)
await writeFile(output, zipSync(Object.fromEntries(entries), { level: 9 }))
console.log(output)
