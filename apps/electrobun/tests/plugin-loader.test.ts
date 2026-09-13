import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, it } from 'node:test'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'
import { loadVerifiedPlugin } from '../src/plugin-loader.ts'

const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex')
void describe('verified plugin loader', () => {
  void it('gates loading and makes disposal idempotent', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const organizationId = '00000000-0000-4000-8000-000000000001'
    const manifest = { permissions: [] }
    const artifact = 'artifact'
    const release = {
      organizationId,
      pluginId: 'loader-plugin',
      version: '1.0.0',
      digest: hash(artifact),
      manifestDigest: hash(manifest),
      permissionsDigest: hash([]),
      manifest,
      artifact,
      status: 'published',
      policyRevision: 1,
    }
    const payload = canonicalJson({
      organizationId,
      pluginId: release.pluginId,
      version: release.version,
      digest: release.digest,
      manifestDigest: release.manifestDigest,
      permissionsDigest: release.permissionsDigest,
    })
    const signed = { ...release, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') }
    let loads = 0
    let disposes = 0
    const dispose = await loadVerifiedPlugin(signed, organizationId, publicKey.export({ type: 'spki', format: 'pem' }).toString(), () => { loads++; return () => { disposes++ } })
    assert.equal(loads, 1)
    dispose(); dispose()
    assert.equal(disposes, 1)
    await assert.rejects(() => loadVerifiedPlugin({ ...signed, status: 'revoked' }, organizationId, publicKey.export({ type: 'spki', format: 'pem' }).toString(), () => () => {}))
  })
})
