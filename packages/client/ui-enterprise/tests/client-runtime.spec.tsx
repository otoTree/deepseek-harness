// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'
import type { PluginTargetModule } from '@deepseek-ai/dsh-plugin-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseClientPluginRuntime } from '../src/client/enterprise.tsx'

interface TargetContext extends Context {
  pluginSdk: PluginSdk
  slots: SlotRegistry
}

describe('enterprise Client plugin runtime', () => {
  it('mounts SDK-backed slots and removes them when the Host withdraws the target', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const disposeRoot = slots.register({
      name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const activationId = '00000000-0000-4000-8000-000000000011'
    let targets = [{
      installationId: 'installation', releaseId: 'release', pluginId: 'client-probe', version: '1.0.0',
      activationId, source: 'export const name = "client-probe"',
    }]
    let identityName: string | undefined
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const call = vi.fn(async (endpoint: string, payload: unknown): Promise<unknown> => {
      calls.push({ endpoint, payload })
      if (endpoint === 'plugin-runtime-targets') return targets
      if (endpoint === 'plugin-sdk-call') {
        return { userId: 'user', name: 'Ada', avatarUrl: null, email: 'ada@example.com', organizationId: 'organization', owner: { kind: 'personal', accountId: 'user' } }
      }
      if (endpoint === 'plugin-client-heartbeat') return null
      throw new Error(`Unexpected endpoint ${endpoint}`)
    })
    const module: PluginTargetModule = {
      name: 'client-probe', inject: ['pluginSdk', 'slots'],
      apply(targetContext: Context): void {
        const target = targetContext as TargetContext
        void target.pluginSdk.identity.current().then((identity) => { identityName = identity.name })
        target.slots.inject('settings.section', () => target.slots.register({
          name: 'settings.section', id: 'client-probe', order: 40, label: 'Client probe',
        }, () => null))
      },
    }
    const runtime = new EnterpriseClientPluginRuntime({ ctx, call, importTarget: async () => module })

    await runtime.reconcile()
    await vi.waitFor(() => { expect(identityName).toBe('Ada') })
    expect(slots.entries('settings.section').map(entry => entry.options.id)).toContain('client-probe')
    expect(calls).toContainEqual({ endpoint: 'plugin-client-heartbeat', payload: { activationId, state: 'active', error: null } })
    expect(calls.some(callRecord => callRecord.endpoint === 'plugin-sdk-call')).toBe(true)

    targets = []
    await runtime.reconcile()
    expect(slots.entries('settings.section').map(entry => entry.options.id)).not.toContain('client-probe')
    await runtime.dispose()
    disposeRoot()
    await ctx.fiber.dispose()
  })
})
