import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { EnterpriseRuntimeController } from '../src/runtime-controller.ts'
import { developmentEnterpriseProfile } from '../src/enterprise-profile.ts'

const enterprise = developmentEnterpriseProfile(fileURLToPath(new URL('..', import.meta.url)))

void test('runtime controller starts an organization-scoped process and stops its group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-runtime-controller-'))
  try {
    const fixture = join(root, 'runtime.sh')
    await copyFile(new URL('./fixtures/runtime.sh', import.meta.url), fixture)
    await chmod(fixture, 0o700)
    const organizationId = randomUUID()
    const controller = new EnterpriseRuntimeController({
      binary: fixture, dataRoot: root, organizationId, installAtLogin: false, enterprise,
    })
    await controller.start()
    assert.equal(controller.running, true)
    const homeFile = join(root, 'organizations', organizationId, 'home.txt')
    for (let attempt = 0; attempt < 100; attempt++) {
      try { assert.match(await readFile(homeFile, 'utf8'), /organizations\//); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || attempt === 99) throw error
        await delay(10)
      }
    }
    await controller.start()
    await controller.stopRuntime()
    assert.equal(controller.running, false)
    await controller.stop()
  } finally { await rm(root, { recursive: true, force: true }) }
})

void test('runtime controller rejects a failed executable without retaining state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-runtime-controller-fail-'))
  try {
    const controller = new EnterpriseRuntimeController({ binary: join(root, 'missing'), dataRoot: root, organizationId: randomUUID(), installAtLogin: false, enterprise })
    await assert.rejects(controller.start(), /could not start/)
    assert.equal(controller.running, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
