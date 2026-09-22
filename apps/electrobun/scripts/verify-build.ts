/** Verify runtime imports from the completed Electrobun application bundle. */
import { execFile } from 'node:child_process'
import { access, copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The enterprise desktop build verification requires Apple Silicon macOS')
}

const packagedEntry = resolve(
  process.cwd(),
  'build/dev-macos-arm64/deepseek-harness-enterprise-dev.app',
  'Contents/Resources/app/plugins/enterprise-client/lib/index.js',
)
await access(packagedEntry)

const isolatedDirectory = await mkdtemp(join(tmpdir(), 'dsh-enterprise-client-'))
try {
  const isolatedEntry = join(isolatedDirectory, 'index.mjs')
  await copyFile(packagedEntry, isolatedEntry)
  await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    "const { pathToFileURL } = await import('node:url'); const plugin = await import(pathToFileURL(process.argv[1]).href); if (plugin.name !== 'enterprise-client' || typeof plugin.apply !== 'function') throw new Error('invalid enterprise client exports')",
    isolatedEntry,
  ], {
    cwd: isolatedDirectory,
    env: { PATH: process.env.PATH ?? '' },
    timeout: 30_000,
  })
  console.log('Verified the packaged enterprise client Host entry with isolated Node resolution')
} catch (cause) {
  throw new Error(
    `The packaged enterprise client Host entry is not self-contained: ${packagedEntry}`,
    { cause },
  )
} finally {
  await rm(isolatedDirectory, { recursive: true, force: true })
}
