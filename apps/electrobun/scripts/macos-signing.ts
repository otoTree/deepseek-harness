/** Developer ID signing for the protected Electrobun bundle and its nested native code. */
import { execFileSync } from 'node:child_process'
import { open, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Explicit release identity and Keychain-backed Apple authentication. */
export interface MacosSigning {
  identity: string
  team: string
  profile: string
  keychain?: string
}

/** Validate release settings before expensive builds; local builds remain ad-hoc.
 * @param release - Whether the caller requested a distributable release.
 * @param env - Build operator's environment; passwords are never accepted.
 * @returns Release settings, or undefined for a local build.
 */
export function resolveMacosSigning(release: boolean, env: NodeJS.ProcessEnv): MacosSigning | undefined {
  if (!release) return undefined
  const identity = env.DSH_MACOS_SIGNING_IDENTITY?.trim()
  const team = env.DSH_MACOS_TEAM_ID?.trim()
  const profile = env.DSH_MACOS_NOTARY_PROFILE?.trim()
  if (!identity || identity === '-' || !team || !/^[A-Z0-9]{10}$/.test(team) || !profile) {
    throw new Error('Release requires DSH_MACOS_SIGNING_IDENTITY, DSH_MACOS_TEAM_ID and DSH_MACOS_NOTARY_PROFILE')
  }
  return { identity, team, profile, keychain: env.DSH_MACOS_KEYCHAIN?.trim() || undefined }
}

const magic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])

/** Identify native file headers before invoking file(1).
 * @param header - First four bytes of a regular staged file.
 * @returns Whether the header can represent Mach-O or a universal binary.
 */
export function isMachO(header: Buffer): boolean {
  return magic.has(header.toString('hex'))
}

/** Fail if a signed component lacks the selected Developer ID, timestamp or release runtime.
 * @param path - Native file, bundle or disk image.
 * @param team - Expected Apple team.
 * @param runtime - Whether hardened runtime is required.
 */
export function verifyDeveloperId(path: string, team: string, runtime = true): void {
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', path], { stdio: 'inherit' })
  // codesign writes its display metadata to stderr, including on success.
  const details = execFileSync('/bin/sh', ['-c', 'exec /usr/bin/codesign -d --verbose=4 "$1" 2>&1', 'codesign', path], { encoding: 'utf8' })
  if (!details.includes(`TeamIdentifier=${team}\n`) || !details.includes('Authority=Developer ID Application:')
    || !details.includes('Timestamp=') || (runtime && !details.includes('(runtime)'))) {
    throw new Error(`Developer ID, timestamp or hardened runtime verification failed: ${path}`)
  }
  const entitlements = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (/<key>com\.apple\.security\.get-task-allow<\/key>\s*<true\s*\/>/.test(entitlements)) {
    throw new Error(`Debug entitlement is forbidden in releases: ${path}`)
  }
}

/** Sign inside out, without following symlinks or applying --deep during signing.
 * @param bundle - Protected .app staging directory, owned by the caller.
 * @param settings - Selected Developer ID and team.
 * @param work - Private build directory for non-secret entitlements.
 * @returns Number of signed Mach-O components.
 */
export async function signMacosBundle(bundle: string, settings: MacosSigning, work: string): Promise<number> {
  const runtime = join(work, 'runtime-entitlements.plist')
  const node = join(work, 'node-entitlements.plist')
  const keys = ['allow-jit', 'allow-unsigned-executable-memory', 'disable-library-validation']
  const plist = (names: string[]): string => '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + `<plist version="1.0"><dict>${names.map(key => `<key>com.apple.security.cs.${key}</key><true/>`).join('')}</dict></plist>\n`
  await writeFile(runtime, plist(keys))
  await writeFile(node, plist([...keys, 'allow-dyld-environment-variables', 'disable-executable-page-protection']))
  const native: { path: string; entitlements?: string }[] = []
  const bundles: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(path)
        if (/\.(app|framework)$/.test(entry.name)) bundles.push(path)
      } else if (entry.isFile()) {
        const handle = await open(path, 'r')
        const header = Buffer.alloc(4)
        try { await handle.read(header, 0, 4, 0) } finally { await handle.close() }
        if (!isMachO(header)) continue
        const description = execFileSync('/usr/bin/file', ['-b', path], { encoding: 'utf8' })
        if (!description.includes('Mach-O') || /\bobject\b/.test(description)) continue
        const executable = description.includes('executable')
        const entitlements = executable && basename(path) === 'node' ? node
          : executable && (['bun', 'launcher'].includes(entry.name) || entry.name.includes(' Helper')) ? runtime : undefined
        native.push({ path, entitlements })
      }
    }
  }
  await visit(bundle)
  if (native.length === 0) throw new Error(`No native code found in ${bundle}`)
  execFileSync('/usr/bin/xattr', ['-cr', bundle])
  const sign = (path: string, entitlements?: string): void => {
    console.log(`Signing ${path.slice(bundle.length) || basename(bundle)}`)
    execFileSync('/usr/bin/codesign', ['--force', '--sign', settings.identity, '--timestamp', '--options', 'runtime',
      ...(settings.keychain ? ['--keychain', settings.keychain] : []),
      ...(entitlements ? ['--entitlements', entitlements] : []), path], { stdio: 'inherit' })
  }
  for (const component of native) sign(component.path, component.entitlements)
  for (const nested of bundles) sign(nested, nested.endsWith('.app') ? runtime : undefined)
  sign(bundle, runtime)
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' })
  for (const path of [...native.map(component => component.path), ...bundles, bundle]) verifyDeveloperId(path, settings.team)
  return native.length
}
