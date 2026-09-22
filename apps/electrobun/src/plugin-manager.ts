import { verifyPluginRelease, type PluginRelease } from './plugin-verifier.ts'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'
import type { PluginActivationSession } from './plugin-loader.ts'

/** Tracks verified plugin lifecycles; every execution entry must acquire an active handle. */
export class PluginManager {
  private readonly active = new Map<string, () => void | Promise<void>>()

  /** Verify and activate one published version after every older version has unloaded. */
  async activate(input: unknown, organizationId: string, disposer: () => void | Promise<void> = () => {}): Promise<PluginRelease> {
    const release = verifyPluginRelease(input, organizationId)
    const key = `${release.pluginId}@${release.version}`
    const failures = await this.deactivateMatching(candidate => candidate.startsWith(`${release.pluginId}@`))
    if (failures.length) throw new AggregateError(failures, `Plugin ${release.pluginId} did not unload cleanly`)
    this.active.set(key, disposer)
    return release
  }

  /** Activate a verified release after obtaining its server lease and SDK from the control plane. */
  async activateRemote(
    input: unknown,
    organizationId: string,
    session: PluginActivationSession,
    load: (release: PluginRelease, sdk: PluginSdk) => Promise<() => void | Promise<void>> | (() => void | Promise<void>),
  ): Promise<PluginRelease> {
    const release = verifyPluginRelease(input, organizationId)
    const failures = await this.deactivateMatching(candidate => candidate.startsWith(`${release.pluginId}@`))
    if (failures.length) throw new AggregateError(failures, `Plugin ${release.pluginId} did not unload cleanly`)
    const sdk = await session.start()
    let activeKey: string | undefined
    try {
      const disposer = await load(release, sdk)
      const key = `${release.pluginId}@${release.version}`
      activeKey = key
      this.active.set(key, async () => {
        const results = await Promise.allSettled([Promise.resolve(disposer()), session.stop()])
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
        if (errors.length) throw new AggregateError(errors, `Plugin ${release.pluginId} did not unload cleanly`)
      })
      await session.heartbeat('active')
      return release
    } catch (error) {
      if (activeKey !== undefined) this.active.delete(activeKey)
      await session.heartbeat('failed', error instanceof Error ? error.message : 'Plugin activation failed').catch(() => {})
      await session.stop().catch(() => {})
      throw error
    }
  }

  /** Revoke an active release locally so tool dispatch and panels can no longer use it. */
  async revoke(pluginId: string, version: string): Promise<void> {
    const key = `${pluginId}@${version}`
    const failures = await this.deactivateMatching(candidate => candidate === key)
    if (failures.length) throw new AggregateError(failures, `Plugin ${key} did not unload cleanly`)
  }

  /** Revoke every loaded version of a plugin after a server notification. */
  async revokePlugin(pluginId: string): Promise<void> {
    const failures = await this.deactivateMatching(key => key.startsWith(`${pluginId}@`))
    if (failures.length) throw new AggregateError(failures, `Plugin ${pluginId} did not unload cleanly`)
  }

  /** Apply server revocation records and unload each affected plugin version. */
  async applyRevocations(records: readonly { pluginId: string; version: string }[]): Promise<void> {
    const failures: unknown[] = []
    for (const record of records) {
      try { await this.revoke(record.pluginId, record.version) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'One or more revoked plugins did not unload cleanly')
  }

  /** Return whether a verified release is currently active. */
  isActive(pluginId: string, version: string): boolean { return this.active.has(`${pluginId}@${version}`) }

  /** Run a tool only when its exact verified version is active. */
  dispatch<T>(pluginId: string, version: string, operation: () => T): T {
    if (!this.isActive(pluginId, version)) throw new Error('Plugin release is not active')
    return operation()
  }

  /** Dispose all active plugins during runtime shutdown. */
  async dispose(): Promise<void> {
    const failures = await this.deactivateMatching(() => true)
    if (failures.length) throw new AggregateError(failures, 'One or more plugins did not unload cleanly')
  }

  private async deactivateMatching(matches: (key: string) => boolean): Promise<unknown[]> {
    const failures: unknown[] = []
    for (const [key, disposer] of [...this.active.entries()]) {
      if (!matches(key)) continue
      this.active.delete(key)
      try { await disposer() } catch (error) { failures.push(error) }
    }
    return failures
  }
}
