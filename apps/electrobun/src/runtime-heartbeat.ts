/** Authenticated runtime lease renewer with quiescent shutdown. */
import { runtimeHeartbeat } from '@deepseek-ai/dsh-enterprise-api/contracts'

export interface RuntimeHeartbeatOptions {
  apiUrl: string
  organizationId: string
  runtimeId: string
  token: string
  intervalMs: number
  request?: RequestFunction
  onLeaseLost?: (error: unknown) => void | Promise<void>
}

type RequestFunction = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

/** Keeps one registered runtime lease alive and stops after the first failed renewal. */
export class RuntimeHeartbeat {
  private readonly options: RuntimeHeartbeatOptions
  private stopped = false
  private wake?: () => void
  private requestAbort?: AbortController
  private loopTask?: Promise<void>
  private readyResolve?: () => void
  private readyReject?: (error: unknown) => void
  private _policyRevision = 1

  constructor(options: RuntimeHeartbeatOptions) {
    if (!Number.isInteger(options.intervalMs) || options.intervalMs < 100 || options.intervalMs > 86_400_000)
      throw new Error('Runtime heartbeat interval is invalid')
    this.options = options
  }

  /** Last policy revision acknowledged by the enterprise service. */
  get policyRevision(): number { return this._policyRevision }

  /** Start with an immediate renewal; subsequent renewals never overlap. */
  async start(): Promise<void> {
    if (this.loopTask) throw new Error('Runtime heartbeat is already running')
    const ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
    this.loopTask = this.run()
    await ready
  }

  /** Stop renewal and await any in-flight request. */
  async stop(): Promise<void> {
    this.stopped = true
    this.readyReject?.(new Error('Runtime heartbeat stopped before first renewal'))
    this.readyReject = undefined
    this.requestAbort?.abort()
    this.wake?.()
    await this.loopTask
  }

  private async run(): Promise<void> {
    try {
      while (!this.stopped) {
        await this.renew()
        this.readyResolve?.()
        this.readyResolve = undefined
        await new Promise<void>((resolve) => {
          this.wake = resolve
          const timer = setTimeout(() => { this.wake = undefined; resolve() }, this.options.intervalMs)
          const previous = this.wake
          this.wake = () => {
            clearTimeout(timer)
            this.wake = undefined
            previous()
          }
        })
      }
    } catch (error) {
      if (!this.stopped) {
        this.stopped = true
        this.readyReject?.(error)
        this.readyReject = undefined
        await this.options.onLeaseLost?.(error)
      }
    } finally {
      this.requestAbort?.abort()
      this.requestAbort = undefined
      this.readyReject = undefined
    }
  }

  private async renew(): Promise<void> {
    const request = this.options.request ?? fetch
    const abort = new AbortController()
    this.requestAbort = abort
    const response = await request(new URL(`/v1/organizations/${this.options.organizationId}/runtimes/${this.options.runtimeId}/heartbeat`, this.options.apiUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: abort.signal,
    })
    if (!response.ok) throw new Error(`Runtime heartbeat refused (${response.status})`)
    const value = runtimeHeartbeat.parse(await response.json())
    if (Date.parse(value.leaseUntil) <= Date.now()) throw new Error('Runtime heartbeat returned an expired lease')
    this._policyRevision = value.policyRevision
    this.requestAbort = undefined
  }
}
