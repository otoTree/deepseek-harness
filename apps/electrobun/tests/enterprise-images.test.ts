/** Opt-in production-image regression owns all containers, network and database state. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const execute = promisify(execFile)
const apiImage = process.env.DSH_ENTERPRISE_TEST_API_IMAGE
const adminImage = process.env.DSH_ENTERPRISE_TEST_ADMIN_IMAGE

void test('production enterprise images preserve database initialization, login and Admin startup', {
  skip: !apiImage || !adminImage ? 'Set both DSH_ENTERPRISE_TEST_API_IMAGE and DSH_ENTERPRISE_TEST_ADMIN_IMAGE' : false,
  timeout: 180_000,
}, async (t) => {
  assert.ok(apiImage)
  assert.ok(adminImage)
  const prefix = `dsh-image-test-${randomUUID()}`
  const network = `${prefix}-network`
  const postgres = `${prefix}-postgres`
  const api = `${prefix}-api`
  const admin = `${prefix}-admin`
  const objects = `${prefix}-objects`
  const objectSetup = `${prefix}-object-setup`
  const password = randomBytes(32).toString('hex')
  const bootstrapPassword = randomBytes(32).toString('hex')
  const authSecret = randomBytes(32).toString('hex')
  const encryptionKey = randomBytes(32).toString('hex')
  const email = 'image-fixture@example.test'
  const docker = async (...args: string[]) => {
    try {
      return (await execute('docker', args, { timeout: 40_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim()
    } catch {
      // execFile errors include argv, which contains this fixture's database/bootstrap credentials.
      throw new Error(`Enterprise image fixture Docker ${args[0]} failed`)
    }
  }
  const remove = async (args: string[], missing: RegExp) => {
    try { await execute('docker', args, { timeout: 15_000 }) }
    catch (error) {
      const stderr = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
      if (!missing.test(stderr)) throw new Error('Enterprise image fixture resource cleanup failed')
    }
  }
  t.after(async () => {
    const results = await Promise.allSettled([api, admin, postgres, objects, objectSetup]
      .map(name => remove(['rm', '-fv', name], /No such container/u)))
    const removal = await Promise.allSettled([remove(['network', 'rm', network], /not found|No such network/u)])
    if (results.some(result => result.status === 'rejected') || removal.some(result => result.status === 'rejected')) {
      throw new Error('Enterprise image fixture could not remove all owned resources')
    }
  })
  const until = async (ready: () => Promise<boolean>, container: string) => {
    const deadline = Date.now() + 30_000
    while (!await ready()) {
      if (Date.now() >= deadline) {
        const output = await execute('docker', ['logs', '--tail', '50', container], { timeout: 5000 })
        let logs = output.stdout + output.stderr
        for (const secret of [password, bootstrapPassword, authSecret, encryptionKey]) logs = logs.replaceAll(secret, '[REDACTED]')
        throw new Error(`Enterprise image readiness deadline exceeded for ${container}:\n${logs}`)
      }
      await delay(100)
    }
  }
  await docker('network', 'create', network)
  await docker('run', '-d', '--name', postgres, '--network', network, '--network-alias', 'database',
    '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:16-alpine')
  await until(async () => {
    try { await docker('exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); return true }
    catch { return false /* This private database is still initializing. */ }
  }, postgres)
  await docker('run', '-d', '--name', objects, '--network', network, '--network-alias', 'objects',
    '-p', '127.0.0.1::9000', '-e', 'MINIO_ROOT_USER=imagefixture', '-e', `MINIO_ROOT_PASSWORD=${password}`,
    'minio/minio:RELEASE.2025-09-07T16-13-09Z', 'server', '/data')
  const objectPort = (await docker('port', objects, '9000/tcp')).split(':').at(-1)
  await until(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${objectPort}/minio/health/ready`, { signal: AbortSignal.timeout(1500) })).ok
    } catch { return false /* The private object store is still starting. */ }
  }, objects)
  await docker('run', '--rm', '--name', objectSetup, '--network', network,
    '-e', `MC_HOST_fixture=http://imagefixture:${password}@objects:9000`,
    'minio/mc:RELEASE.2025-08-13T08-35-41Z', 'mb', 'fixture/dsh-enterprise')
  await docker('run', '-d', '--platform', 'linux/amd64', '--name', api, '--network', network,
    '--network-alias', 'backend', '-p', '127.0.0.1::8787',
    '-e', `ENTERPRISE_DATABASE_URL=postgres://postgres:${password}@database:5432/postgres`,
    '-e', `ENTERPRISE_AUTH_SECRET=${authSecret}`,
    '-e', `ENTERPRISE_ENCRYPTION_KEY=${encryptionKey}`,
    '-e', 'ENTERPRISE_API_URL=http://backend:8787',
    '-e', 'ENTERPRISE_ADMIN_ORIGIN=http://admin:3000', '-e', 'ENTERPRISE_PORTAL_ORIGIN=http://portal:4000',
    '-e', 'ENTERPRISE_MINIO_ENDPOINT=http://objects:9000', '-e', 'ENTERPRISE_MINIO_ACCESS_KEY=imagefixture',
    '-e', `ENTERPRISE_MINIO_APP_PASSWORD=${password}`, '-e', 'ENTERPRISE_MINIO_BUCKET=dsh-enterprise',
    '-e', `ENTERPRISE_BOOTSTRAP_EMAIL=${email}`, '-e', `ENTERPRISE_BOOTSTRAP_PASSWORD=${bootstrapPassword}`,
    apiImage)
  const apiOrigin = async () => `http://127.0.0.1:${(await docker('port', api, '8787/tcp')).split(':').at(-1)}`
  let origin = await apiOrigin()
  const health = async () => {
    try { return (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) })).ok }
    catch { return false /* The production entrypoint has not opened its listener yet. */ }
  }
  await until(health, api)
  assert.deepEqual(await (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5000) })).json(), {
    service: 'enterprise-api', status: 'ok',
  })
  const login = async () => {
    const response = await fetch(`${origin}/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://backend:8787' },
      body: JSON.stringify({ email, password: bootstrapPassword }), signal: AbortSignal.timeout(10_000),
    })
    assert.equal(response.status, 200, 'The initialized platform administrator must be able to log in')
    assert.ok(response.headers.get('set-cookie'), 'Login must create a session')
    await response.body?.cancel()
  }
  await login()
  const userCount = () => docker('exec', postgres, 'psql', '-U', 'postgres', '-Atc', 'select count(*) from enterprise_auth."user"')
  assert.equal(await userCount(), '1')
  await docker('restart', api)
  // Docker can reassign an ephemeral published port when a container restarts.
  origin = await apiOrigin()
  await until(health, api)
  await login()
  assert.equal(await userCount(), '1', 'Restart must preserve the account instead of provisioning duplicates')

  await docker('run', '-d', '--platform', 'linux/amd64', '--name', admin, '--network', network,
    '-p', '127.0.0.1::3000', '-e', `ADMIN_API_URL=${origin}`, adminImage)
  const adminPort = (await docker('port', admin, '3000/tcp')).split(':').at(-1)
  const adminUrl = `http://127.0.0.1:${adminPort}`
  await until(async () => {
    try { return (await fetch(adminUrl, { signal: AbortSignal.timeout(1500) })).ok }
    catch { return false /* Next standalone is still starting. */ }
  }, admin)
  const response = await fetch(adminUrl, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /<html/u)
  assert.ok(html.includes(origin), 'Admin must embed its configured enterprise API origin')
  assert.equal(html.includes('https://invalid.arivo.example'), false)
})
