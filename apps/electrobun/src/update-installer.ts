/** Prepare a verified full installer without modifying the running application. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { verifyWindowsInstallerContents } from '../scripts/windows-installer.ts'
import type { DesktopRelease } from './update-manifest.ts'
import { desktopBrand } from './brand.ts'

/** Expand the complete Windows payload, or return the verified macOS DMG.
 * @param artifact - Verified downloaded file in a private operation directory.
 * @param release - Authenticated metadata for this platform.
 * @param signal - Cancellation; extraction settles before rejection.
 * @returns Path to open after the owned Runtime stops.
 */
export async function prepareDesktopInstaller(artifact: string, release: DesktopRelease, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (release.target === 'darwin-arm64') return artifact
  const destination = join(dirname(artifact), 'setup')
  const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"
  const script = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(artifact)} -DestinationPath ${quote(destination)}`
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(name)))
  await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { signal, env: environment, windowsHide: true })
  signal.throwIfAborted()
  const setup = await verifyWindowsInstallerContents(destination,
    [desktopBrand.name, desktopBrand.legacyInstallerName], release.identifier)
  signal.throwIfAborted()
  return setup
}
