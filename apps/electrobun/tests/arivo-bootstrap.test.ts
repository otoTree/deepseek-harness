/** Arivo prepares only its own install root before delegating the native process. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const run = promisify(execFile)
void test('macOS Arivo bootstrap prepares a fresh home and rejects redirected install roots', {
  skip: !process.env.ARIVO_TEST_BOOTSTRAP && 'Set ARIVO_TEST_BOOTSTRAP to the compiled macOS bootstrap', timeout: 10000,
}, async (t) => {
  const binary = process.env.ARIVO_TEST_BOOTSTRAP
  assert.ok(binary)
  const root = await mkdtemp(join(tmpdir(), 'arivo-bootstrap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const launcher = join(root, 'launcher')
  await cp(binary, launcher)
  await writeFile(join(root, 'electrobun-launcher'), '#!/bin/sh\nprintf "%s\\n" "$1"\nexit 23\n', { mode: 0o700 })
  const home = join(root, 'home')
  await mkdir(home)
  const env = { HOME: home, PATH: '/usr/bin:/bin' }
  const installed = join(home, 'Library/Application Support/com.arivo.studio/stable')
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(run(launcher, ['preserved argument'], { env }), (error: unknown) => {
      const result = error as { code: number; stdout: string }
      assert.equal(result.code, 23)
      assert.equal(result.stdout, 'preserved argument\n')
      return true
    })
    assert.equal((await stat(installed)).mode & 0o777, 0o700)
  }
  const product = join(home, 'Library/Application Support/com.arivo.studio')
  await rm(product, { recursive: true })
  const other = join(root, 'enterprise-data')
  await mkdir(other)
  await writeFile(join(other, 'sentinel'), 'preserved')
  await symlink(other, product)
  await assert.rejects(run(launcher, [], { env }), (error: unknown) => (error as { code: number }).code === 74)
  assert.equal(await readFile(join(other, 'sentinel'), 'utf8'), 'preserved')
  await assert.rejects(stat(join(other, 'stable')), { code: 'ENOENT' })
  await unlink(product)
  await mkdir(product)
  await chmod(product, 0o777)
  await assert.rejects(run(launcher, [], { env }), (error: unknown) => (error as { code: number }).code === 74)
  await assert.rejects(stat(installed), { code: 'ENOENT' })
  await assert.rejects(run(launcher, [], { env: { ...env, HOME: 'relative' } }),
    (error: unknown) => (error as { code: number }).code === 78)
})
