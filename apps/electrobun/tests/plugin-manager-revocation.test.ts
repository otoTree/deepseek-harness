import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PluginManager } from '../src/plugin-manager.ts'

void describe('plugin revocation synchronization', () => {
  void it('unloads every server-revoked version', () => {
    const manager = new PluginManager()
    let disposed = 0
    const release = { pluginId: 'sync-plugin', version: '1.0.0' }
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
