/** Durable Apple submission tracking; queries never upload and final checks precede release checksums. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { verifyDeveloperId, type MacosSigning } from './macos-signing.ts'
import { desktopBrand } from '../src/brand.ts'

const submissionSchema = z.object({
  format: z.literal(1), team: z.string().regex(/^[A-Z0-9]{10}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  id: z.uuid().optional(), finalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: z.enum(['submitting', 'In Progress', 'Accepted', 'Invalid', 'Rejected', 'verified']),
}).strict()
type Submission = z.infer<typeof submissionSchema>

/** External Apple command executor; credentials stay in Keychain.
 * @param args - notarytool operation and non-secret options.
 * @returns Apple's JSON response.
 */
export type NotaryRunner = (args: string[]) => string
const apple: NotaryRunner = args => execFileSync('/usr/bin/xcrun', ['notarytool', ...args], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
})

function authentication(settings: MacosSigning): string[] {
  return ['--keychain-profile', settings.profile, ...(settings.keychain ? ['--keychain', settings.keychain] : []), '--output-format', 'json']
}

/** Hash the current artifact without buffering the installer in memory.
 * @param image - Installer path.
 * @returns Lowercase SHA-256 of its exact bytes.
 */
export async function installerHash(image: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(image)) hash.update(bytes)
  return hash.digest('hex')
}

async function save(image: string, submission: Submission): Promise<void> {
  const staging = await mkdtemp(join(dirname(image), '.notary-state-'))
  try {
    const file = join(staging, 'state.json')
    await writeFile(file, JSON.stringify(submission, null, 2) + '\n')
    await rename(file, image + '.notary.json')
  } finally { await rm(staging, { recursive: true, force: true }) }
}

/** Validate credentials without uploading any artifact.
 * @param settings - Apple Keychain profile and selected team.
 */
export function checkNotaryCredentials(settings: MacosSigning): void {
  apple(['history', ...authentication(settings)])
}

/** Upload once and persist Apple's ID before any status query. Ambiguous failures require manual history recovery.
 * @param image - Signed, immutable DMG path; an existing tracking file forbids re-upload.
 * @param settings - Selected Apple team and Keychain profile.
 * @param run - Apple command executor, replaceable at the external service in tests.
 * @returns Persisted submission ID.
 */
export async function submitMacosInstaller(image: string, settings: MacosSigning, run: NotaryRunner = apple): Promise<string> {
  const state: Submission = { format: 1, team: settings.team, sha256: await installerHash(image), status: 'submitting' }
  await writeFile(image + '.notary.json', JSON.stringify(state, null, 2) + '\n', { flag: 'wx' })
  const reply = z.object({ id: z.uuid() }).parse(JSON.parse(run(['submit', image, ...authentication(settings)])))
  state.id = reply.id
  state.status = 'In Progress'
  await save(image, state)
  console.log(`Apple submission: ${reply.id}\nTracking: ${image}.notary.json`)
  return reply.id
}

/** Query an existing submission; rejection logs survive, and Accepted alone is not reported as verified.
 * @param image - Original signed artifact with its .notary.json tracking file.
 * @param settings - Same team and a usable Keychain profile.
 * @param run - Apple command executor.
 * @returns Pending state, or verified after stapling and Gatekeeper checks.
 */
export async function resumeMacosNotarization(image: string, settings: MacosSigning, run: NotaryRunner = apple): Promise<'pending' | 'verified'> {
  // A directory lock serializes finalization across manual queries and scheduled watchers.
  const lock = image + '.notary-lock'
  await mkdir(lock)
  try {
    const state = submissionSchema.parse(JSON.parse(await readFile(image + '.notary.json', 'utf8')))
    if (state.team !== settings.team) throw new Error('Notarization team differs from the recorded submission')
    const hash = await installerHash(image)
    if (hash !== state.sha256 && hash !== state.finalSha256) throw new Error('Installer changed after submission; refusing to staple or upload')
    if (!state.id) throw new Error('Upload outcome is uncertain. Recover the submission ID from notarytool history; do not re-upload')
    if (state.status === 'verified') {
      if (hash !== state.finalSha256) throw new Error('Verified installer does not match the final SHA-256')
      console.log(`Already notarized and verified: ${image}`)
      return 'verified'
    }
    if (state.status === 'Invalid' || state.status === 'Rejected') {
      throw new Error(`Apple ${state.status} submission ${state.id}; see ${image}.notary-log.json`)
    }
    const reply = z.object({ id: z.uuid(), status: z.enum(['In Progress', 'Accepted', 'Invalid', 'Rejected']) })
      .parse(JSON.parse(run(['info', state.id, ...authentication(settings)])))
    if (reply.id !== state.id) throw new Error('Apple returned a different submission ID')
    if (reply.status === 'In Progress') {
      console.log(`Apple submission ${state.id}: In Progress; query again with notarize:installer`)
      return 'pending'
    }
    state.status = reply.status
    const log = run(['log', state.id, ...authentication(settings)])
    await writeFile(image + '.notary-log.json', log + '\n')
    await save(image, state)
    if (reply.status !== 'Accepted') throw new Error(`Apple ${reply.status} submission ${state.id}; see ${image}.notary-log.json`)
    await finalize(image, state)
    return 'verified'
  } finally { await rm(lock, { recursive: true, force: true }) }
}

async function finalize(image: string, state: Submission): Promise<void> {
  const work = await mkdtemp(join(dirname(image), '.notary-finalize-'))
  const staged = join(work, basename(image))
  const mount = join(work, 'volume')
  const run = (command: string, args: string[]): void => { execFileSync(command, args, { stdio: 'inherit' }) }
  let mounted = false
  try {
    await copyFile(image, staged)
    run('/usr/bin/xcrun', ['stapler', 'staple', staged])
    run('/usr/bin/xcrun', ['stapler', 'validate', staged])
    verifyDeveloperId(staged, state.team, false)
    run('/usr/bin/hdiutil', ['verify', staged])
    run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', staged])
    await mkdir(mount)
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, staged])
    mounted = true
    const installed = join(work, `${desktopBrand.name}.app`)
    run('/usr/bin/ditto', [join(mount, `${desktopBrand.name}.app`), installed])
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed])
    verifyDeveloperId(installed, state.team)
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', installed])
    run('/usr/bin/hdiutil', ['detach', mount])
    mounted = false
    state.finalSha256 = await installerHash(staged)
    // Persist both allowed hashes before replacing the DMG, so an interrupted rename remains resumable.
    await save(image, state)
    await rename(staged, image)
    await writeFile(image + '.sha256', `${state.finalSha256}  ${basename(image)}\n`)
    state.status = 'verified'
    await save(image, state)
    console.log(`Notarized and Gatekeeper verified: ${image}\nSHA-256: ${state.finalSha256}\nSign update metadata from this final DMG.`)
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount])
    await rm(work, { recursive: true, force: true })
  }
}
