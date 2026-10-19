/** Verify runtime imports from the completed Electrobun application bundle. */
import { execFile } from 'node:child_process'
import { access, copyFile, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import desktopConfig from './desktop-config.ts'

const execFileAsync = promisify(execFile)

if (!((process.platform === 'darwin' && process.arch === 'arm64')
  || (process.platform === 'win32' && process.arch === 'x64'))) {
  throw new Error('The enterprise desktop build verification supports Apple Silicon macOS and x64 Windows')
}

const platformBuild = process.platform === 'win32' ? 'dev-win-x64' : 'dev-macos-arm64'
const bundleName = desktopConfig.app.name + '-dev' + (process.platform === 'darwin' ? '.app' : '')
const bundle = process.argv[2] ?? join('build', platformBuild, bundleName)
const resources = process.platform === 'win32' ? resolve(bundle, 'Resources') : resolve(bundle, 'Contents/Resources')
const packagedRoot = join(resources, 'app/plugins')
const packagedEntry = join(packagedRoot, 'enterprise-client/lib/index.js')
const driveToolsEntry = join(packagedRoot, 'drive-tools.js')
await access(packagedEntry)
await access(driveToolsEntry)
const appRoot = await realpath(resolve(packagedRoot, '..'))
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
  await symlink(runtimeModules, join(isolatedDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    "const { pathToFileURL } = await import('node:url'); const plugin = await import(pathToFileURL(process.argv[1]).href); if (plugin.name !== 'enterprise-client' || typeof plugin.apply !== 'function') throw new Error('invalid enterprise client exports')",
    isolatedEntry,
  ], {
    cwd: isolatedDirectory,
    env: process.platform === 'win32' ? {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
      WINDIR: process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows',
      ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {}),
      ...(process.env.LOCALAPPDATA ? { LOCALAPPDATA: process.env.LOCALAPPDATA } : {}),
      ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
      ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
    } : { PATH: process.env.PATH ?? '' },
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
