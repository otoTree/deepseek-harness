/** Built provider smoke through the supported dsh launcher and a disposable named profile. */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'

/** Execute a built native plugin through a disposable named profile.
 * @param t - Owner of the temporary profile and child-process teardown.
 * @param input - Trusted fixture plugin rows and driver source; contains no credentials.
 * @returns The driver's non-secret JSON result.
 */
export async function nativeProfile(t: TestContext, input: { rows: Record<string, unknown>[]; driver: string }): Promise<string> {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const home = await mkdtemp(join(tmpdir(), 'enterprise-native-profile-'))
  const profile = join(home, 'profiles', 'enterprise-native-test')
  const bundle = join(home, 'bundle')
  const resources: { link?: string; stop?: () => Promise<void> } = {}
  t.after(async () => {
    await resources.stop?.()
    if (resources.link) await unlink(resources.link)
    await rm(home, { recursive: true })
  })
  await mkdir(bundle)
  await mkdir(join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })
  const packageName = '@deepseek-ai/dsh-enterprise-native-test'
  const link = join(profile, 'node_modules', packageName)
  await symlink(bundle, link, 'junction')
  resources.link = link
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: packageName, type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'enterprise-native-test', private: true, type: 'module',
    dependencies: { [packageName]: 'file:' + bundle }, dsh: { profile: { bundles: [packageName], patchReload: 'startup' } } }))
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  const driver = join(bundle, 'driver.mjs')
  await writeFile(driver, input.driver)
  const lifetime = join(bundle, 'lifetime.mjs')
  // The profile stays alive until its supervisor stops it; natural process exit must not race SIGTERM.
  await writeFile(lifetime, `export function apply(ctx) {
    ctx.effect(() => { const timer = setInterval(() => {}, 60000); return () => clearInterval(timer); });
  }`)
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [...input.rows, { id: 'lifetime', name: lifetime }, { id: 'driver', name: driver }] }]))
  const child = spawn(process.execPath, [join(root, 'apps/cli/lib/bin.js'), '--profile', 'enterprise-native-test'], {
    cwd: home, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let ended = false
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { ended = true; resolve({ code, signal }) })
  })
  const stop = async () => {
    if (!ended) child.kill('SIGTERM')
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
    try { await done } finally { clearTimeout(timer) }
  }
  resources.stop = stop
  let output = ''
  const result = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('Provider profile did not finish: ' + output)) }, 20000)
    const read = (bytes: Buffer) => {
      output += bytes.toString()
      const match = output.match(/ENTERPRISE_NATIVE_PROFILE (.+)\n/)
      if (match?.[1]) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    void done.then(() => { clearTimeout(timer); reject(new Error('Provider profile exited before result: ' + output)) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error('Provider process failed')) })
  })
  await stop()
  const exit = await done
  assert.equal(exit.signal, null)
  assert.equal(exit.code, 0)
  return result
}
