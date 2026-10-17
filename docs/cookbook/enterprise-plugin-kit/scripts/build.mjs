import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')

await mkdir(resolve(root, 'packages/standard/host'), { recursive: true })
await mkdir(resolve(root, 'packages/standard/client'), { recursive: true })

for (const [entry, outfile, platform] of [
  ['src/host.ts', 'packages/standard/host/index.js', 'node'],
  ['src/client.ts', 'packages/standard/client/index.js', 'browser'],
]) {
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform,
    sourcemap: false,
    packages: 'external',
    logLevel: 'info',
  })
}
