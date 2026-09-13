import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it } from 'node:test'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'
import { PluginManager } from '../src/plugin-manager.ts'
import { createHash } from 'node:crypto'

const sha = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex')
void describe('plugin lifecycle gate', () => {
  void it('verifies activation, dispatch and revocation disposal', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const artifact = 'immutable-artifact'
    const manifest = { permissions: ['storage'] }
    const release = {
      organizationId: '00000000-0000-4000-8000-000000000001',
      pluginId: 'demo-plugin',
      version: '1.0.0',
      digest: sha(artifact),
      manifestDigest: sha(manifest),
      permissionsDigest: sha(['storage']),
      manifest,
      artifact,
      status: 'published',
      policyRevision: 1,
    }
    const payload = canonicalJson({
      organizationId: release.organizationId,
      pluginId: release.pluginId,
      version: release.version,
      digest: release.digest,
      manifestDigest: release.manifestDigest,
      permissionsDigest: release.permissionsDigest,
    })
    const signed = { ...release, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') }
    let disposed = 0
    const manager = new PluginManager()
    manager.activate(signed, release.organizationId, publicKey.export({ type: 'spki', format: 'pem' }).toString(), () => { disposed++ })
    assert.equal(manager.dispatch('demo-plugin', '1.0.0', () => 'ok'), 'ok')
    manager.revoke('demo-plugin', '1.0.0')
    assert.equal(disposed, 1)
    assert.throws(() => manager.dispatch('demo-plugin', '1.0.0', () => 'no'))
  })

  void it('unloads the old version before activating a verified replacement', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const organizationId = '00000000-0000-4000-8000-000000000001'
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const signed = (version: string) => {
      const artifact = `immutable-artifact-${version}`
      const manifest = { permissions: ['storage'], version }
      const release = {
        organizationId, pluginId: 'demo-plugin', version,
        digest: sha(artifact), manifestDigest: sha(manifest), permissionsDigest: sha(['storage']),
        manifest, artifact, status: 'published' as const, policyRevision: 1,
      }
      const payload = canonicalJson({
        organizationId, pluginId: release.pluginId, version,
        digest: release.digest, manifestDigest: release.manifestDigest,
        permissionsDigest: release.permissionsDigest,
      })
      return { ...release, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') }
    }
    let disposed = 0
    const manager = new PluginManager()
    manager.activate(signed('1.0.0'), organizationId, publicPem, () => { disposed++ })
    manager.activate(signed('2.0.0'), organizationId, publicPem)
    assert.equal(disposed, 1)
    assert.equal(manager.isActive('demo-plugin', '1.0.0'), false)
    assert.equal(manager.dispatch('demo-plugin', '2.0.0', () => 'v2'), 'v2')
  })

  void it('fails closed when an old version cannot unload', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const organizationId = '00000000-0000-4000-8000-000000000001'
    const artifact = 'immutable-artifact'
    const manifest = { permissions: [] }
    const release = {
      organizationId, pluginId: 'failing-plugin', version: '1.0.0',
      digest: sha(artifact), manifestDigest: sha(manifest), permissionsDigest: sha([]),
      manifest, artifact, status: 'published' as const, policyRevision: 1,
    }
    const payload = canonicalJson({
      organizationId, pluginId: release.pluginId, version: release.version,
      digest: release.digest, manifestDigest: release.manifestDigest,
      permissionsDigest: release.permissionsDigest,
    })
    const signed = { ...release, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') }
    const manager = new PluginManager()
    manager.activate(signed, organizationId, publicKey.export({ type: 'spki', format: 'pem' }).toString(), () => { throw new Error('dispose failed') })
    assert.throws(() => { manager.revoke('failing-plugin', '1.0.0') }, AggregateError)
    assert.equal(manager.isActive('failing-plugin', '1.0.0'), false)
    assert.throws(() => manager.dispatch('failing-plugin', '1.0.0', () => 'unsafe'))
    manager.revoke('failing-plugin', '1.0.0')
  })
})
