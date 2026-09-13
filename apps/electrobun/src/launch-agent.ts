/** User LaunchAgent registration refuses configuration collisions and preserves failed removals. */
import { mkdir, writeFile, readFile, unlink, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const label = 'ai.deepseek.harness.enterprise.runtime'

/** LaunchAgent label used for the local DSH background runtime. */
export const launchAgentLabel = label

/** Serialize a non-secret background executable; failed jobs restart with launchd throttling.
 * @param program - absolute executable path in the managed installation.
 * @param args - non-secret arguments for the background host.
 * @param environment - non-secret environment variables for the background host.
 * @param options - whether to bootstrap the declaration immediately.
 * @returns A user-level launchd property list.
 */
export function launchAgentPlist(program: string, args: readonly string[], environment: Readonly<Record<string, string>> = {}): string {
  const values = [program, ...args, ...Object.keys(environment), ...Object.values(environment)]
  if (!isAbsolute(program) || values.some(value => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))) {
    throw new Error('LaunchAgent requires an absolute executable and XML-safe arguments')
  }
  const argumentsXml = [program, ...args].map(value => `<string>${escapeXml(value)}</string>`).join('')
  const environmentXml = Object.entries(environment).map(([key, value]) => `<key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`).join('')
  const environmentBlock = environmentXml ? `<key>EnvironmentVariables</key><dict>${environmentXml}</dict>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${argumentsXml}</array>${environmentBlock}<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string></dict></plist>\n`
}

function domain(): string {
  if (process.platform !== 'darwin' || !process.getuid) throw new Error('LaunchAgent requires a macOS login session')
  const uid = process.getuid()
  if (uid === 0) throw new Error('Desktop LaunchAgent cannot be installed as root')
  return `gui/${uid}`
}

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
}

/** Install the user-level runtime agent without requiring administrator access. */
export async function installLaunchAgent(
  program: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  options: { load?: boolean } = {},
): Promise<string> {
  const target = domain()
  const path = plistPath()
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  const plist = launchAgentPlist(program, args, environment)
  let existing: string | undefined
  try { existing = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (existing !== undefined) {
    if (!existing.includes(`<key>Label</key><string>${label}</string>`)) throw new Error('LaunchAgent file is not owned by this application')
    await execFileAsync('/bin/launchctl', ['bootout', target + '/' + label])
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, plist, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  // A running desktop host already owns the foreground runtime.  Callers can
  // install the login-start declaration without bootstrapping a second copy;
  // launchd loads the declaration at the next user login.
  if (options.load ?? true) await execFileAsync('/bin/launchctl', ['bootstrap', target, path])
  return path
}

/** Stop and remove the user-level runtime agent. */
export async function uninstallLaunchAgent(): Promise<void> {
  const target = domain()
  const path = plistPath()
  let plist: string
  try { plist = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!plist.includes(`<key>Label</key><string>${label}</string>`)) throw new Error('LaunchAgent file is not owned by this application')
  await execFileAsync('/bin/launchctl', ['bootout', target + '/' + label])
  await unlink(path)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
