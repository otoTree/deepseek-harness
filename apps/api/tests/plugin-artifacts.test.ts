import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseEnv } from 'node:util'
import { MinioPluginArtifactStore } from '../src/plugin-artifacts.ts'

const env = parseEnv(readFileSync(new URL('../../../.env.enterprise', import.meta.url), 'utf8'))
const configured = env.ENTERPRISE_MINIO_ENDPOINT && env.ENTERPRISE_MINIO_ACCESS_KEY
  && env.ENTERPRISE_MINIO_APP_PASSWORD && env.ENTERPRISE_MINIO_BUCKET

void test('plugin MinIO stores, reads, and deletes private bytes', { skip: !configured }, async () => {
  const store = new MinioPluginArtifactStore(
    env.ENTERPRISE_MINIO_ENDPOINT!, env.ENTERPRISE_MINIO_ACCESS_KEY!,
    env.ENTERPRISE_MINIO_APP_PASSWORD!, env.ENTERPRISE_MINIO_BUCKET!,
  )
  const key = `integration/${randomUUID()}/probe.bin`
  const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255])
  try {
    await store.putBytes(key, bytes)
    assert.deepEqual([...await store.getBytes(key) ?? []], [...bytes])
  } finally {
    await store.delete(key)
  }
  assert.equal(await store.getBytes(key), null)
})
