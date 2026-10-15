/** Verify runtime imports from the completed Electrobun application bundle. */
import { execFile } from 'node:child_process'
import { access, copyFile, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The enterprise desktop build verification requires Apple Silicon macOS')
}

const packagedRoot = resolve(process.cwd(), 'build/dev-macos-arm64/deepseek-harness-enterprise-dev.app', 'Contents/Resources/app/plugins')
const packagedEntry = join(packagedRoot, 'enterprise-client/lib/index.js')
const driveToolsEntry = join(packagedRoot, 'drive-tools.js')
await access(packagedEntry)
await access(driveToolsEntry)
const appRoot = resolve(packagedRoot, '..')
const runtimeModules = join(appRoot, 'node_modules')
const runtimeRequire = createRequire(join(appRoot, 'runtime/package.json'))
for (const dependency of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
  const resolved = await realpath(runtimeRequire.resolve(`${dependency}/package.json`))
  if (relative(appRoot, resolved).startsWith('..')) throw new Error(`Packaged runtime dependency escapes the application: ${dependency}`)
}

const isolatedDirectory = await mkdtemp(join(tmpdir(), 'dsh-enterprise-client-'))
try {
  const isolatedEntry = join(isolatedDirectory, 'index.mjs')
  await copyFile(packagedEntry, isolatedEntry)
  await symlink(runtimeModules, join(isolatedDirectory, 'node_modules'), 'dir')
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
  console.log('Verified the packaged enterprise client Host entry against the packaged runtime dependencies')
} catch (cause) {
  throw new Error(
    `The packaged enterprise client Host entry cannot resolve its runtime dependencies: ${packagedEntry}`,
    { cause },
  )
} finally {
  await rm(isolatedDirectory, { recursive: true, force: true })
}
