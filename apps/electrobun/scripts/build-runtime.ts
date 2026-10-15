/** Compile the built dsh CLI into the desktop application's bundled runtime. */
import { execFileSync } from 'node:child_process'
import { access, cp, glob, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The enterprise desktop runtime is built for Apple Silicon macOS')
const source = resolve(process.cwd(), '../cli/lib/bin.js')
const output = resolve(process.cwd(), 'build/dsh')
await access(source, constants.R_OK)
await mkdir(dirname(output), { recursive: true })
const runtimeTree = resolve(process.cwd(), 'build/runtime-tree')
await rm(runtimeTree, { recursive: true, force: true })
execFileSync('pnpm', [
  '--filter', '@deepseek-ai/dsh', 'deploy', '--legacy', '--prod',
  '--config.node-linker=hoisted', '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true', runtimeTree,
], { stdio: 'inherit' })
// Legacy deploy records its production dependency selection in workspace state.
// Restore the development selection before subsequent desktop build commands.
execFileSync('pnpm', ['install', '--ignore-scripts'], { stdio: 'inherit' })
async function materialize(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name === '.bin') {
      await rm(path, { recursive: true, force: true })
    } else if (entry.isSymbolicLink()) {
      const source = await realpath(path)
      const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { files?: string[] }
      if (!manifest.files?.length) throw new Error(`Linked runtime package ${source} must declare published files`)
      await rm(path)
      await mkdir(path, { recursive: true })
      // Workspace links must include only published files, never local builds,
      // nested checkouts, or development dependencies from the source package.
      for await (const file of glob(['package.json', 'README*', 'LICENSE*', ...manifest.files], { cwd: source })) {
        const destination = join(path, file)
        await mkdir(dirname(destination), { recursive: true })
        await cp(join(source, file), destination, {
          recursive: true, dereference: true,
          filter: candidate => !candidate.split(sep).includes('node_modules'),
        })
      }
      await materialize(path)
    } else if (entry.isDirectory()) await materialize(path)
  }
}
// The executable runtime does not publish repository documentation links.
for (const file of await readdir(runtimeTree)) {
  if (/^README(?:\..*)?$/i.test(file)) await rm(join(runtimeTree, file))
}
await materialize(join(runtimeTree, 'node_modules'))
execFileSync('bun', ['build', '--compile', source, '--outfile', output], { stdio: 'inherit' })
await access(output, constants.X_OK)
