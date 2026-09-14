/** POSIX lifecycle checks allocate independent homes and wait for owned process exits. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, copyFile, chmod, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { LocalRuntime, validateLocalWebUrl } from '../src/runtime.ts'
import { developmentEnterpriseProfile } from '../src/enterprise-profile.ts'

const enterprise = developmentEnterpriseProfile(fileURLToPath(new URL('..', import.meta.url)))

void test('local Web URLs require a fresh authenticated loopback URL', () => {
  assert.equal(validateLocalWebUrl('http://127.0.0.1:4567/?token=token-1234'), 'http://127.0.0.1:4567/?token=token-1234')
  for (const value of [
    'http://localhost:4567/?token=token-1234',
    'http://127.0.0.1:4567/',
    'http://127.0.0.1:4567/?token=short',
    'http://127.0.0.1:4567/?token=token-1234&token=other',
    'https://127.0.0.1:4567/?token=token-1234',
  ]) assert.throws(() => validateLocalWebUrl(value), /authenticated loopback/)
})

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15000
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Owned process did not reach the expected state')
    await delay(20)
  }
}

void test('stopping twice kills a TERM-resistant process group and permits a clean restart', {
  skip: process.platform === 'win32', timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const binary = join(root, 'fixture')
  await copyFile(new URL('./fixtures/runtime.sh', import.meta.url), binary)
  await chmod(binary, 0o700)
  const runtime = new LocalRuntime({ binary, dataRoot: root, organizationId: randomUUID(), shutdownTimeoutMs: 100, enterprise })
  t.after(() => runtime.stop())
  await runtime.start()
  await assert.rejects(runtime.start(), /already running/)
  const readPid = async (name: string) => {
    try { return Number(await readFile(join(runtime.home, name), 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }
  await eventually(async () => Boolean(await readPid('child.pid')))
  const parent = await readPid('parent.pid')
  const child = await readPid('child.pid')
  assert.equal(await readFile(join(runtime.home, 'home.txt'), 'utf8'), runtime.home)
  assert.ok((await readFile(join(runtime.home, 'argv.txt'), 'utf8')).includes('enterprise-desktop'))
  const profile = await readFile(join(runtime.home, 'profiles', 'enterprise-desktop', 'cordis.patch.yml'), 'utf8')
  assert.match(profile, /id: enterprise-gateway/)
  assert.match(profile, /id: enterprise-session-persistence/)
  assert.match(profile, /id: llm-deepseek\n  disabled: true/)
  assert.match(profile, /id: session-persistence-jsonl\n  disabled: true/)
  assert.ok(!(await readFile(join(runtime.home, 'env.txt'), 'utf8')).split('\n').some(line => /^(?:.*KEY.*|.*SECRET.*|.*TOKEN.*|.*PASSWORD.*|NODE_OPTIONS)=/i.test(line)))
  await Promise.all([runtime.stop(), runtime.stop()])
  for (const pid of [parent, child]) await eventually(async () => {
    try { process.kill(pid, 0); return false } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
      throw error
    }
  })
  await runtime.start()
  await runtime.stop()
})

void test('failed spawn rejects and stop observes close', { skip: process.platform === 'win32' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new LocalRuntime({ binary: join(root, 'absent'), dataRoot: root, organizationId: randomUUID(), shutdownTimeoutMs: 100, enterprise })
  await assert.rejects(runtime.start(), /could not start/)
  await runtime.stop()
})

void test('only one runtime can own an organization home', { skip: process.platform === 'win32' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const binary = join(root, 'fixture')
  await copyFile(new URL('./fixtures/runtime.sh', import.meta.url), binary)
  await chmod(binary, 0o700)
  const organizationId = randomUUID()
  const first = new LocalRuntime({ binary, dataRoot: root, organizationId, shutdownTimeoutMs: 100, enterprise })
  const second = new LocalRuntime({ binary, dataRoot: root, organizationId, shutdownTimeoutMs: 100, enterprise })
  await first.start()
  await assert.rejects(second.start(), /already running/)
  await first.stop()
})
