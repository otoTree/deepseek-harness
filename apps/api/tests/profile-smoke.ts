/** Built enterprise bundle smoke through the supported dsh profile launcher. */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { Config } from '../src/config.ts'

/**
 * Boot a per-test profile on an OS-assigned port and await its exit during cleanup.
 * @param t - Owner of temporary files and the launched process.
 * @param config - Test database and authentication settings; no production deployment is provisioned.
 * @returns Completion after a real HTTP authentication rejection and listener teardown.
 */
export async function profileSmoke(t: TestContext, config: Config): Promise<void> {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const home = await mkdtemp(join(tmpdir(), 'enterprise-profile-'))
  const profile = join(home, 'profiles', 'enterprise-api')
  const resources: { link?: string; stop?: () => Promise<void> } = {}
  t.after(async () => {
    await resources.stop?.()
    if (resources.link) await unlink(resources.link)
    await rm(home, { recursive: true })
  })
  await mkdir(join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })
  const link = join(profile, 'node_modules', '@deepseek-ai', 'dsh-enterprise-api')
  await symlink(join(root, 'apps/api'), link, 'junction')
  resources.link = link
  await writeFile(
    join(profile, 'package.json'),
    JSON.stringify({
      name: 'enterprise-profile-smoke',
      private: true,
      type: 'module',
      dependencies: { '@deepseek-ai/dsh-enterprise-api': 'file:' + join(root, 'apps/api') },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-enterprise-api'], patchReload: 'startup' } },
    }),
  )
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'enterprise-api'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DSH_HOME: home,
      NO_COLOR: '1',
      ENTERPRISE_DATABASE_URL: config.databaseUrl,
      ENTERPRISE_AUTH_SECRET: config.authSecret,
      ENTERPRISE_ENCRYPTION_KEY: config.encryptionKey,
      ENTERPRISE_API_URL: config.apiUrl,
      ENTERPRISE_ADMIN_ORIGIN: config.adminOrigin,
      ENTERPRISE_PORTAL_ORIGIN: config.portalOrigin,
      ENTERPRISE_API_PORT: '0',
      ENTERPRISE_MODE: config.mode,
      ENTERPRISE_MINIO_ENDPOINT: 'http://127.0.0.1:59010',
      ENTERPRISE_MINIO_ACCESS_KEY: 'enterprise_app',
      ENTERPRISE_MINIO_APP_PASSWORD: 'enterprise_app_password',
      ENTERPRISE_MINIO_BUCKET: 'dsh-enterprise',
    },
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('close', (code, signal) =>{  resolve({ code, signal }) })
    child.once('error', reject)
  })
  let closed = false
  child.once('close', () => {
    closed = true
  })
  resources.stop = async () => {
    if (!closed) child.kill('SIGTERM')
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, 10000)
    try {
      await exited
    } finally {
      clearTimeout(timeout)
    }
  }
  const port = await new Promise<number>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() =>{  reject(new Error('Enterprise profile did not announce readiness: ' + output)) }, 30000)
    const inspect = (bytes: Buffer) => {
      output += bytes.toString()
      const match = output.match(/Enterprise API listening on 127\.0\.0\.1:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    void exited.then(
      () => {
        clearTimeout(timer)
        reject(new Error('Enterprise profile exited before readiness: ' + output))
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error('Enterprise profile failed', { cause: error }))
      },
    )
  })
  assert.ok(port > 0)
  const response = await fetch(`http://127.0.0.1:${port}/v1/me`, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 401)
  await response.arrayBuffer()
  child.kill('SIGTERM')
  const result = await exited
  assert.equal(result.signal, null)
  assert.equal(result.code, 0)
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) }))
}
