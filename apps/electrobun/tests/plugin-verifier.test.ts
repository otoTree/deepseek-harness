import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'
import { verifyPluginRelease } from '../src/plugin-verifier.ts'

void test('plugin verifier accepts the exact approved artifact and rejects tampering', () => {
  const manifest = { permissions: ['storage.read'], targets: ['desktop'] }
  const artifact = 'export default 1'
  const digest = (value: unknown) => {
    return createHash('sha256').update(canonicalJson(value)).digest('hex')
  }
  const organizationId = randomUUID()
  const release = { organizationId, pluginId: 'demo-plugin', version: '1.0.0',
    manifest, artifact, digest: digest(artifact), manifestDigest: digest(manifest), permissionsDigest: digest(manifest.permissions),
    status: 'published' as const, policyRevision: 1 }
  assert.equal(verifyPluginRelease(release, organizationId).digest, release.digest)
  assert.throws(() => verifyPluginRelease({ ...release, artifact: 'tampered' }, organizationId), /digest/)
  assert.throws(() => verifyPluginRelease(release, randomUUID()), /another organization/)
})
