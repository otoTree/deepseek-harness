import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeNotification, validateNativeExternalUrl, windowCapabilities } from '../src/native-bridge-policy.ts'

void test('native bridge policy accepts bounded notifications and HTTP(S) links', () => {
  assert.deepEqual(nativeNotification.parse({ title: 'Build', body: 'Done' }), { title: 'Build', body: 'Done' })
  assert.equal(validateNativeExternalUrl({ url: 'https://example.test/docs?a=1' }), 'https://example.test/docs?a=1')
  assert.equal(validateNativeExternalUrl({ url: 'http://127.0.0.1:3000/' }), 'http://127.0.0.1:3000/')
})

void test('native bridge policy rejects custom schemes, credentials, and malformed input', () => {
  assert.throws(() => validateNativeExternalUrl({ url: 'file:///etc/passwd' }), /HTTP\(S\)/)
  assert.throws(() => validateNativeExternalUrl({ url: 'https://user:pass@example.test/' }), /credential-free/)
  assert.throws(() => validateNativeExternalUrl({ url: 'javascript:alert(1)' }))
  assert.throws(() => nativeNotification.parse({ title: '', body: 'x' }))
  assert.throws(() => nativeNotification.parse({ title: 'ok', body: 'x', extra: true }))
})

void test('remote authentication windows never receive native RPC', () => {
  assert.deepEqual(windowCapabilities(false), { sandbox: true, exposeNativeRpc: false })
  assert.deepEqual(windowCapabilities(true), { sandbox: false, exposeNativeRpc: true })
})
