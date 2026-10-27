/** Private DSH homes preserve the anonymous directory and reject redirected account storage. */
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { arivoAgentHome } from '../src/distribution/arivo-account-scope.ts'

void test('anonymous and two account homes are distinct and stable, with no path input accepted', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arivo-agent-home-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const a = 'a'.repeat(64); const b = 'b'.repeat(64)
  assert.equal(await arivoAgentHome(root, 'device'), root)
  assert.equal(await arivoAgentHome(root, a), join(root, 'accounts', a, 'agent'))
  assert.notEqual(await arivoAgentHome(root, a), await arivoAgentHome(root, b))
  for (const value of ['../other', '/other', 'a'.repeat(63), 'A'.repeat(64), 'device/../other']) {
    await assert.rejects(arivoAgentHome(root, value))
  }
})

void test('account homes reject a symlink and permissive directory without following its storage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arivo-agent-link-'))
  const foreign = await mkdtemp(join(tmpdir(), 'arivo-agent-foreign-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(foreign, { recursive: true, force: true }) })
  await symlink(foreign, join(root, 'accounts'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(arivoAgentHome(root, 'a'.repeat(64)), /private, owned/u)
  if (process.platform !== 'win32') {
    await chmod(root, 0o755)
    await assert.rejects(arivoAgentHome(root, 'device'), /private, owned/u)
  }
})
