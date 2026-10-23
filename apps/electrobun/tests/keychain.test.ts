/** Native Keychain checks use only a fresh test-owned account. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopKeychain } from '../src/keychain.ts'

void test('Keychain helper requires an absolute executable', () => {
  assert.throws(() => new DesktopKeychain('security'), /absolute/)
})

void test('helper startup failure is not a missing credential', async () => {
  const store = new DesktopKeychain('/nonexistent-enterprise-helper-' + randomUUID())
  await assert.rejects(store.get('account'), /operation failed/)
  await assert.rejects(store.delete('account'), /operation failed/)
})

void test('missing-item status permits reads and repeated deletion but still rejects writes', {
  skip: process.platform === 'win32' && 'Helper protocol fixture requires a POSIX shell',
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-keychain-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const helper = join(root, 'helper')
  await writeFile(helper, '#!/bin/sh\nexit 44\n')
  await chmod(helper, 0o700)
  const store = new DesktopKeychain(helper)
  assert.equal(await store.get('missing'), undefined)
  await store.delete('missing')
  await store.delete('missing')
  await assert.rejects(store.set('missing', 'value'), /operation failed/)
})

void test('native Keychain preserves credential bytes and deletes only its owned account', {
  skip: !['darwin', 'win32'].includes(process.platform) || process.env.ENTERPRISE_TEST_KEYCHAIN !== '1', timeout: 90000,
}, async (t) => {
  const helperName = process.platform === 'win32' ? 'keychain.exe' : 'keychain'
  const store = new DesktopKeychain(fileURLToPath(new URL(`../build/native/${helperName}`, import.meta.url)))
  const account = 'test-' + randomUUID()
  t.after(() => store.delete(account))
  assert.equal(await store.get(account), undefined)
  const secret = '  test-' + randomUUID() + '\n'
  await store.set(account, secret)
  assert.equal(await store.get(account), secret)
  await store.set(account, secret + 'updated')
  assert.equal(await store.get(account), secret + 'updated')
  const helper = fileURLToPath(new URL(`../build/native/${helperName}`, import.meta.url))
  const child = spawn(helper, ['set', account], { stdio: ['pipe', 'ignore', 'pipe'] })
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('Chunked Keychain write failed'))
    })
  })
  // The helper may fail before the stdin callback finishes; the awaiting path owns that error.
  void finished.catch(() => {})
  child.stdin.on('error', () => {
    // The helper exit status reports rejected stdin writes.
  })
  const chunks = ['a'.repeat(8192), 'b'.repeat(8192), secret]
  try {
    for (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(chunk, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
    child.stdin.end()
    await finished
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    // Preserve any original stdin/exit failure after observing helper shutdown.
    await finished.catch(() => {})
  }
  assert.equal(await store.get(account), chunks.join(''))
  await store.delete(account)
  await store.delete(account)
  assert.equal(await store.get(account), undefined)
})
