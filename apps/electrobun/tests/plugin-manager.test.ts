import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'
import { PluginManager } from '../src/plugin-manager.ts'
import { createHash } from 'node:crypto'

const sha = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex')
void describe('plugin lifecycle gate', () => {
  void it('verifies activation, dispatch and revocation disposal', async () => {
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
    let disposed = 0
    const manager = new PluginManager()
    await manager.activate(release, release.organizationId, () => { disposed++ })
    assert.equal(manager.dispatch('demo-plugin', '1.0.0', () => 'ok'), 'ok')
    await manager.revoke('demo-plugin', '1.0.0')
    assert.equal(disposed, 1)
    assert.throws(() => manager.dispatch('demo-plugin', '1.0.0', () => 'no'))
  })

  void it('unloads the old version before activating a verified replacement', async () => {
    const organizationId = '00000000-0000-4000-8000-000000000001'
    const release = (version: string) => {
      const artifact = `immutable-artifact-${version}`
      const manifest = { permissions: ['storage'], version }
      const release = {
        organizationId, pluginId: 'demo-plugin', version,
        digest: sha(artifact), manifestDigest: sha(manifest), permissionsDigest: sha(['storage']),
        manifest, artifact, status: 'published' as const, policyRevision: 1,
      }
      return release
    }
    let disposed = 0
    const manager = new PluginManager()
    await manager.activate(release('1.0.0'), organizationId, async () => { await Promise.resolve(); disposed++ })
    await manager.activate(release('2.0.0'), organizationId)
    assert.equal(disposed, 1)
    assert.equal(manager.isActive('demo-plugin', '1.0.0'), false)
    assert.equal(manager.dispatch('demo-plugin', '2.0.0', () => 'v2'), 'v2')
  })

  void it('fails closed when an old version cannot unload', async () => {
    const organizationId = '00000000-0000-4000-8000-000000000001'
    const artifact = 'immutable-artifact'
    const manifest = { permissions: [] }
    const release = {
      organizationId, pluginId: 'failing-plugin', version: '1.0.0',
      digest: sha(artifact), manifestDigest: sha(manifest), permissionsDigest: sha([]),
      manifest, artifact, status: 'published' as const, policyRevision: 1,
    }
    const manager = new PluginManager()
    await manager.activate(release, organizationId, async () => { await Promise.resolve(); throw new Error('dispose failed') })
    await assert.rejects(() => manager.revoke('failing-plugin', '1.0.0'), AggregateError)
    assert.equal(manager.isActive('failing-plugin', '1.0.0'), false)
    assert.throws(() => manager.dispatch('failing-plugin', '1.0.0', () => 'unsafe'))
    await manager.revoke('failing-plugin', '1.0.0')
  })
})
