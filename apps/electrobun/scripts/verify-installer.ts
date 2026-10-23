/** Verify the local macOS DMG or Windows installer archive. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyProtectedResources } from './protect-build.ts'
import { runPnpm } from './run-pnpm.ts'
import desktopConfig from './desktop-config.ts'
import { verifyWindowsInstallerContents } from './windows-installer.ts'
import { desktopBrand } from '../src/brand.ts'

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const run = (command: string, args: string[]): void => { execFileSync(command, args, { stdio: 'inherit' }) }

if (process.platform === 'darwin' && process.arch === 'arm64') {
  const image = resolve(process.argv[2] ?? `artifacts/local/${desktopBrand.artifactPrefix}-${version}-macos-arm64-local.dmg`)
  const expected = (await readFile(image + '.sha256', 'utf8')).trim()
  const actual = createHash('sha256').update(await readFile(image)).digest('hex')
  if (expected !== `${actual}  ${basename(image)}`) throw new Error(`Installer SHA-256 mismatch: ${image}`)
  const root = await mkdtemp(join(tmpdir(), 'dsh-installed-'))
  const mount = join(root, 'volume')
  await mkdir(mount)
  let mounted = false
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image])
    mounted = true
    const installed = join(root, `Applications/${desktopConfig.app.name}.app`)
    run('/usr/bin/ditto', [join(mount, `${desktopConfig.app.name}.app`), installed])
    const plist = join(installed, 'Contents/Info.plist')
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      const value = execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim()
      if (value !== desktopConfig.app.name) throw new Error(`Installer ${key} does not match the product name`)
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', installed])
    await verifyProtectedResources(join(installed, 'Contents/Resources'))
    const desktop = fileURLToPath(new URL('..', import.meta.url))
    runPnpm(['exec', 'tsx', 'scripts/verify-build.ts', installed], { cwd: desktop })
    runPnpm(['exec', 'tsx', 'scripts/smoke-installer.ts', installed], { cwd: desktop })
    console.log('Verified DMG checksum, installation copy, code signature, protected resources and packaged Web profiles')
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount])
    await rm(root, { recursive: true, force: true })
  }
} else if (process.platform === 'win32' && process.arch === 'x64') {
  const archive = resolve(process.argv[2] ?? `artifacts/local/${desktopBrand.artifactPrefix}-${version}-windows-x64-local.zip`)
  const expected = (await readFile(archive + '.sha256', 'utf8')).trim()
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (expected !== `${actual}  ${basename(archive)}`) throw new Error(`Installer SHA-256 mismatch: ${archive}`)
  const extracted = await mkdtemp(join(tmpdir(), 'dsh-windows-installer-'))
  try {
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:DSH_INSTALLER_ARCHIVE -DestinationPath $env:DSH_INSTALLER_EXTRACTED -Force'], {
      stdio: 'inherit', env: { ...process.env, DSH_INSTALLER_ARCHIVE: archive, DSH_INSTALLER_EXTRACTED: extracted },
    })
    await verifyWindowsInstallerContents(extracted, desktopConfig.app.name, desktopConfig.app.identifier)
    console.log('Verified Windows installer archive checksum, x64 Setup.exe and its metadata and application payload')
  } finally {
    await rm(extracted, { recursive: true, force: true })
  }
} else {
  throw new Error('Installer verification supports Apple Silicon macOS and x64 Windows hosts')
}
