import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'
import { verifyPluginRelease } from '../src/plugin-verifier.ts'

void test('plugin verifier accepts the exact approved artifact and rejects tampering', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const manifest = { permissions: ['storage.read'], targets: ['desktop'] }
  const artifact = 'export default 1'
  const digest = (value: unknown) => {
    return createHash('sha256').update(canonicalJson(value)).digest('hex')
  }
  const organizationId = randomUUID()
  const release = { organizationId, pluginId: 'demo-plugin', version: '1.0.0',
    manifest, artifact, digest: digest(artifact), manifestDigest: digest(manifest), permissionsDigest: digest(manifest.permissions),
    status: 'published' as const, policyRevision: 1 }
  const payload = canonicalJson({ organizationId: release.organizationId, pluginId: release.pluginId, version: release.version,
    digest: release.digest, manifestDigest: release.manifestDigest, permissionsDigest: release.permissionsDigest })
  const signed = { ...release, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') }
  assert.equal(verifyPluginRelease(signed, organizationId, publicKey.export({ type: 'spki', format: 'pem' }).toString()).digest, release.digest)
  assert.throws(() => verifyPluginRelease({ ...signed, artifact: 'tampered' }, organizationId, publicKey.export({ type: 'spki', format: 'pem' }).toString()), /digest/)
  assert.throws(() => verifyPluginRelease(signed, randomUUID(), publicKey.export({ type: 'spki', format: 'pem' }).toString()), /another organization/)
})
