import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const encoder = new TextEncoder()

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function packageVersion(manifestName: string): Promise<void> {
  const manifestPath = resolve(packageRoot, manifestName)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    version: string
    build: { lockfileDigest: string }
    targets: readonly { kind: 'host' | 'client'; entry: string }[]
  }
  manifest.build.lockfileDigest = digest(await readFile(resolve(repositoryRoot, 'pnpm-lock.yaml')))
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(manifestPath, manifestText)

  const entries: Record<string, Uint8Array> = { 'manifest.json': encoder.encode(manifestText) }
  for (const target of manifest.targets) {
    entries[target.entry] = new Uint8Array(await readFile(resolve(packageRoot, `lib/${target.kind}.js`)))
  }
  const integrity = Object.fromEntries(Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => [path, digest(bytes)]))
  entries['integrity.json'] = strToU8(`${JSON.stringify(integrity, null, 2)}\n`)
  const output = resolve(packageRoot, 'dist', `enterprise-acceptance-${manifest.version}.dsh-plugin.zip`)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, zipSync(entries, { level: 9 }))
}

await packageVersion('manifest-v1.json')
await packageVersion('manifest-v2.json')
