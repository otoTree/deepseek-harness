import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemoryDriveObjectStore, driveObjectKey } from '../src/drive-storage.ts'

void test('memory drive storage preserves metadata and server-owned keys', async () => {
  const store = new MemoryDriveObjectStore()
  const key = driveObjectKey('space-1', 'node-1', 'version-1')
  assert.equal(key, 'drive/space-1/node-1/version-1')
  store.seed(key, new TextEncoder().encode('hello'), 'text/plain')
  assert.deepEqual(await store.inspect(key), {
    size: 5,
    contentType: 'text/plain',
    checksum: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  })
  assert.match(await store.createDownloadUrl(key, 60), /^memory:\/\/download\//u)
  await store.delete(key)
  await assert.rejects(() => store.createDownloadUrl(key, 60), /does not exist/u)
})
