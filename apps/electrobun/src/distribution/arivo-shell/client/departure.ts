/** Startup-owned editor leases. No business data or account authority is retained here. */
export type PrepareDeparture = (signal: AbortSignal) => Promise<false | (() => void)>

/** First intent wins while editors save; disposal, timeout and roster changes cancel departure. */
export class ArivoDeparture {
  private readonly editors = new Set<PrepareDeparture>()
  private revision = 0
  private pending: Promise<boolean> | undefined
  private controller: AbortController | undefined
  private closed = false
  private holding = false
  private heldRelease: (() => void) | undefined
  private accepting = false
  private changes: (() => void)[] = []

  constructor(private readonly timeoutMs: number, private readonly commit: (change: () => void) => void,
    private readonly blocked: () => void) {}

  /** Retain a mounted editor until its component releases this registration.
   * @param prepare - Acquire an input freeze and acknowledge durable local persistence.
   * @returns Registration disposer; invalidates an in-flight departure.
   */
  register(prepare: PrepareDeparture): () => void {
    this.editors.add(prepare); this.revision++
    return () => { if (this.editors.delete(prepare)) { this.revision++; this.controller?.abort() } }
  }

  /** Run one UI mutation, retaining all acquired freezes through the synchronous React commit.
   * @param change - UI mutation; never executed on refusal or an uncertain acknowledgement.
   * @returns Whether this particular intent committed; later concurrent intents are refused.
   */
  run(change: () => void): Promise<boolean> {
    if (this.holding || this.heldRelease) return Promise.resolve(false)
    return this.start(change)
  }

  private start(change: () => void, retain = false): Promise<boolean> {
    if (this.closed) return Promise.resolve(false)
    if (this.pending) {
      if (!this.accepting) return Promise.resolve(false)
      this.changes.push(change)
      return this.pending
    }
    if (!this.editors.size) { this.commit(change); if (retain) this.retain([]); return Promise.resolve(true) }
    const controller = new AbortController(); this.controller = controller
    this.changes = [change]; this.accepting = true
    queueMicrotask(() => { this.accepting = false })
    const revision = this.revision, releases: (() => void)[] = []
    const timer = setTimeout(() => { controller.abort() }, this.timeoutMs)
    this.pending = (async () => {
      const work = Promise.allSettled([...this.editors].map(async (prepare) => {
        const release = await prepare(controller.signal)
        if (release) { if (controller.signal.aborted) release(); else releases.push(release) }
        return release !== false
      }))
      const results = await Promise.race([work, new Promise<undefined>((resolve) => {
        if (controller.signal.aborted) resolve(undefined)
        else controller.signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
      })])
      if (controller.signal.aborted || this.closed || revision !== this.revision
        || !results || results.some(result => result.status === 'rejected' || !result.value)) {
        if (!this.closed && !retain) this.blocked()
        return false
      }
      this.commit(() => { for (const mutation of this.changes) mutation() })
      if (retain) this.retain(releases.splice(0))
      return true
    })().finally(() => {
      clearTimeout(timer); controller.abort()
      for (const release of releases) release()
      this.controller = undefined; this.pending = undefined
      this.changes = []; this.accepting = false
    })
    return this.pending
  }

  /** Freeze all editors through native runtime shutdown; competing UI intents are refused.
   * @param signal - Native request lifetime; cancellation releases pending and granted freezes.
   * @returns Idempotent release, or refusal without destroying the current UI.
   */
  async hold(signal: AbortSignal): Promise<false | (() => void)> {
    if (signal.aborted || this.pending || this.holding || this.heldRelease || this.closed) return false
    this.holding = true
    const isAborted = () => signal.aborted
    const abort = () => { this.controller?.abort(); this.releaseHeld() }
    signal.addEventListener('abort', abort, { once: true })
    let allowed = false
    try { allowed = await this.start(() => {}, true) }
    catch (error) { signal.removeEventListener('abort', abort); this.releaseHeld(); throw error }
    finally { this.holding = false }
    if (!allowed || isAborted() || this.isClosed()) {
      signal.removeEventListener('abort', abort); this.releaseHeld(); return false
    }
    const release = this.currentLease()
    if (!release) { signal.removeEventListener('abort', abort); return false }
    return () => { signal.removeEventListener('abort', abort); release() }
  }

  private releaseHeld(): void { this.heldRelease?.() }
  private currentLease(): (() => void) | undefined { return this.heldRelease }
  private isClosed(): boolean { return this.closed }

  private retain(releases: (() => void)[]): void {
    let active = true
    this.heldRelease = () => {
      if (!active) return
      active = false; this.heldRelease = undefined
      for (const release of releases) release()
    }
  }

  /** Cancel all leases before removing the startup plugin. */
  dispose(): void { this.closed = true; this.controller?.abort(); this.releaseHeld(); this.editors.clear(); this.revision++ }
}

/** Strict v1 iframe acknowledgement; exact origin and source are checked by the caller.
 * @param value - Untrusted message payload.
 * @param id - Active prepare request id.
 * @returns Allowed flag, or undefined for unrelated/malformed replies.
 */
export function departureReply(value: unknown, id: string): boolean | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'allow,id,type,version') return
  const reply = value as Record<string, unknown>
  if (reply.version !== 1 || reply.type !== 'arivo:leave-ready' || reply.id !== id || typeof reply.allow !== 'boolean') return
  return reply.allow
}

/** Ask only the verified local frame to freeze and flush; abort always releases the same request.
 * @param frame - Currently mounted verified iframe.
 * @param origin - Exact origin returned by the authenticated workbench operation.
 * @param signal - Startup departure lifetime, including its deadline.
 * @returns A freeze disposer or refusal; no timeout can imply permission.
 */
export function prepareFrame(frame: HTMLIFrameElement, origin: string, signal: AbortSignal): Promise<false | (() => void)> {
  // oxlint-disable-next-line no-restricted-properties -- This bridge is restricted to secure-context loopback origins.
  const target = frame.contentWindow, id = crypto.randomUUID()
  if (!target || signal.aborted) return Promise.resolve(false)
  const send = (type: string) => { target.postMessage({ version: 1, type, id }, origin) }
  return new Promise((resolve) => {
    const release = () => { send('arivo:release-leave') }
    const finish = (allowed: boolean) => {
      window.removeEventListener('message', received); signal.removeEventListener('abort', aborted)
      if (!allowed) release()
      resolve(allowed ? release : false)
    }
    const aborted = () => { finish(false) }
    const received = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== target) return
      const allowed = departureReply(event.data, id)
      if (allowed !== undefined) finish(allowed)
    }
    window.addEventListener('message', received); signal.addEventListener('abort', aborted, { once: true })
    send('arivo:prepare-leave')
  })
}

/** Install the Arivo-only native shutdown entry; it conveys a decision and retains editor freezes.
 * @param departure - Startup-owned coordinator, also used by ordinary navigation.
 * @returns Disposer that cancels pending preparation and releases retained input.
 */
export function installNativeDeparture(departure: ArivoDeparture): () => void {
  const target = window as Window & { __arivoNativeDeparture?: {
    prepare(id: string): Promise<boolean>
    release(id: string): void
  } }
  if (target.__arivoNativeDeparture) throw new Error('Arivo native departure already has an owner')
  let lease: { id: string; controller: AbortController; release: (() => void) | undefined } | undefined
  const api = {
    async prepare(id: string): Promise<boolean> {
      if (!/^[0-9a-f-]{36}$/u.test(id) || lease) return false
      const current = { id, controller: new AbortController(), release: undefined as (() => void) | undefined }
      lease = current
      const release = await departure.hold(current.controller.signal)
      if (!release || lease !== current) { if (release) release(); if (lease === current) lease = undefined; return false }
      // A frame that finishes mounting after acknowledgement must not accept new input during shutdown.
      const root = target.document.documentElement, wasInert = root.inert
      root.inert = true
      current.release = () => { root.inert = wasInert; release() }
      return true
    },
    release(id: string): void {
      if (lease?.id !== id) return
      const current = lease; lease = undefined; current.controller.abort(); current.release?.()
    },
  }
  target.__arivoNativeDeparture = api
  return () => { if (lease) api.release(lease.id); if (target.__arivoNativeDeparture === api) delete target.__arivoNativeDeparture }
}
