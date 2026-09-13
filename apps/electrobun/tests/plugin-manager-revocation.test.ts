import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PluginManager } from '../src/plugin-manager.ts'

void describe('plugin revocation synchronization', () => {
  void it('unloads every server-revoked version', () => {
    const manager = new PluginManager()
    let disposed = 0
    const release = { organizationId: '00000000-0000-4000-8000-000000000001', pluginId: 'sync-plugin', version: '1.0.0', digest: 'a'.repeat(64), manifestDigest: 'b'.repeat(64), permissionsDigest: 'c'.repeat(64), manifest: {}, artifact: 'x', signature: 'sig', status: 'published' as const, policyRevision: 1 }
    // The manager's synchronization method is independent of signature verification.
    manager['active'].set('sync-plugin@1.0.0', () => { disposed++ })
    manager.applyRevocations([{ pluginId: release.pluginId, version: release.version }])
    assert.equal(disposed, 1)
    assert.equal(manager.isActive(release.pluginId, release.version), false)
  })

  void it('processes every revocation even when one disposer fails', () => {
    const manager = new PluginManager()
    let secondDisposed = false
    manager['active'].set('first-plugin@1.0.0', () => { throw new Error('first unload failed') })
    manager['active'].set('second-plugin@1.0.0', () => { secondDisposed = true })
    assert.throws(() => {
      manager.applyRevocations([
        { pluginId: 'first-plugin', version: '1.0.0' },
        { pluginId: 'second-plugin', version: '1.0.0' },
      ])
    }, AggregateError)
    assert.equal(secondDisposed, true)
    assert.equal(manager.isActive('first-plugin', '1.0.0'), false)
    assert.equal(manager.isActive('second-plugin', '1.0.0'), false)
  })
})
