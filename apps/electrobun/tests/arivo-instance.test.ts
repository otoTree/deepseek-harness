/** Real kernel locks reject overlap and recover without unlinking persistent lock files. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

void test('Arivo native home lock excludes duplicates and releases after pipe closure or process death', {
  skip: !process.env.ARIVO_TEST_INSTANCE_HELPER && 'Set ARIVO_TEST_INSTANCE_HELPER to a built native helper', timeout: 10000,
}, async (t) => {
  const helper = process.env.ARIVO_TEST_INSTANCE_HELPER
  assert.ok(helper)
  const home = await mkdtemp(join(tmpdir(), 'arivo-instance-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const lock = join(home, 'arivo.instance')
  const launch = () => {
    const child = spawn(helper, [lock], { stdio: ['pipe', 'pipe', 'ignore'] })
    const done = new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject) })
    t.after(async () => { child.stdin.end(); child.kill(); await done })
    return { child, done }
  }
  const ready = async (child: ReturnType<typeof launch>['child']) => {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', () => { reject(new Error('Native helper exited before acquiring the lock')) })
      child.stdout.once('data', (data: Buffer) => {
        try { assert.equal(data.toString('utf8'), 'arivo-instance-ready\n'); resolve() }
        catch (error) { reject(new Error('Native lock readiness was invalid', { cause: error })) }
      })
    })
  }
  const first = launch()
  await ready(first.child)
  const duplicate = launch()
  assert.equal(await duplicate.done, 73)
  first.child.stdin.end()
  assert.equal(await first.done, 0)
  const second = launch()
  await ready(second.child)
  second.child.kill('SIGKILL')
  await second.done
  assert.equal((await stat(lock)).isFile(), true)
  const recovered = launch()
  await ready(recovered.child)
  recovered.child.stdin.end()
  assert.equal(await recovered.done, 0)
})
