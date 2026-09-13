import { verifyPluginRelease, type PluginRelease } from './plugin-verifier.ts'

/** Tracks verified plugin lifecycles; every execution entry must acquire an active handle. */
export class PluginManager {
  private readonly active = new Map<string, () => void>()

  /** Verify and activate one published version after every older version has unloaded. */
  activate(input: unknown, organizationId: string, publicKey: string, disposer: () => void = () => {}): PluginRelease {
    const release = verifyPluginRelease(input, organizationId, publicKey)
    const key = `${release.pluginId}@${release.version}`
    const failures = this.deactivateMatching(candidate => candidate.startsWith(`${release.pluginId}@`))
    if (failures.length) throw new AggregateError(failures, `Plugin ${release.pluginId} did not unload cleanly`)
    this.active.set(key, disposer)
    return release
  }

  /** Revoke an active release locally so tool dispatch and panels can no longer use it. */
  revoke(pluginId: string, version: string): void {
    const key = `${pluginId}@${version}`
    const failures = this.deactivateMatching(candidate => candidate === key)
    if (failures.length) throw new AggregateError(failures, `Plugin ${key} did not unload cleanly`)
  }

  /** Revoke every loaded version of a plugin after a server notification. */
  revokePlugin(pluginId: string): void {
    const failures = this.deactivateMatching(key => key.startsWith(`${pluginId}@`))
    if (failures.length) throw new AggregateError(failures, `Plugin ${pluginId} did not unload cleanly`)
  }

  /** Apply server revocation records and unload each affected plugin version. */
  applyRevocations(records: readonly { pluginId: string; version: string }[]): void {
    const failures: unknown[] = []
    for (const record of records) {
      try { this.revoke(record.pluginId, record.version) } catch (error) { failures.push(error) }
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
  dispose(): void {
    const failures = this.deactivateMatching(() => true)
    if (failures.length) throw new AggregateError(failures, 'One or more plugins did not unload cleanly')
  }

  private deactivateMatching(matches: (key: string) => boolean): unknown[] {
    const failures: unknown[] = []
    for (const [key, disposer] of [...this.active.entries()]) {
      if (!matches(key)) continue
      this.active.delete(key)
      try { disposer() } catch (error) { failures.push(error) }
    }
    return failures
  }
}
