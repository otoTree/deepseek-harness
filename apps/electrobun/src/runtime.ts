/** Owned POSIX process group for an explicitly provisioned enterprise DSH profile. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { open as openFile, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { flock } from 'fs-ext'
import { z } from 'zod'
import { provisionEnterpriseProfile, enterpriseProfileConfig } from './enterprise-profile.ts'

const configSchema = z.object({
  binary: z.string().refine(isAbsolute),
  installAnchor: z.string().refine(isAbsolute).optional(),
  organizationId: z.uuid(),
  dataRoot: z.string().refine(isAbsolute),
  shutdownTimeoutMs: z.number().int().min(1).max(60000),
  enterprise: enterpriseProfileConfig.omit({ home: true }),
})

/**
 * Validate the only URL a desktop WebView may receive from a local runtime.
 * The DSH process token is intentionally retained in the query for the
 * existing Connection bootstrap; it is never accepted from a non-loopback
 * authority or forwarded to another origin.
 * @param value - startup URL emitted by the DSH web bundle.
 * @returns the validated URL.
 */
export function validateLocalWebUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Desktop runtime reported an invalid Web UI URL') }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
    || url.port === '' || url.pathname !== '/' || url.hash !== ''
    || url.searchParams.getAll('token').length !== 1
    || !/^[A-Za-z0-9_-]{8,512}$/.test(url.searchParams.get('token') ?? '')) {
    throw new Error('Desktop runtime Web UI URL must be an authenticated loopback URL')
  }
  return url.toString()
}

/** Local DSH process owned by the desktop application. */
export class LocalRuntime {
  private child: ChildProcess | undefined
  private done: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private webUrlValue: string | undefined
  private webUrlPromise: Promise<string> | undefined
  private organizationLock: FileHandle | undefined
  private readonly config: z.infer<typeof configSchema>

  constructor(config: z.input<typeof configSchema>) {
    this.config = configSchema.parse(config)
    if (process.platform === 'win32') throw new Error('Desktop runtime requires POSIX process groups')
  }

  /** Organization-scoped DSH home, never the user's existing personal home. */
  get home(): string {
    return join(this.config.dataRoot, 'organizations', this.config.organizationId)
  }

  /** Start one long-lived local profile if it is not already running. */
  async start(): Promise<void> {
    if (this.child !== undefined || this.stopping) throw new Error('Desktop runtime is already running or stopping')
    mkdirSync(this.home, { recursive: true, mode: 0o700 })
    const lock = await openFile(join(this.home, 'runtime.lock'), 'a')
    try {
      await new Promise<void>((resolve, reject) => {
        flock(lock.fd, 'exnb', error => error ? reject(error) : resolve())
      })
    } catch (error: unknown) {
      await lock.close()
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
        throw new Error(`Desktop runtime for organization ${this.config.organizationId} is already running`)
      }
      throw error
    }
    this.organizationLock = lock
    try { await provisionEnterpriseProfile({ home: this.home, ...this.config.enterprise }) } catch (error) {
      await this.releaseOrganizationLock()
      throw error
    }
    this.webUrlValue = undefined
    this.webUrlPromise = undefined
    const args = ['--profile', 'enterprise-desktop', '--no-open', '--host', '127.0.0.1', '--port', '0']
    const env: NodeJS.ProcessEnv = { DSH_HOME: this.home }
    if (this.config.installAnchor) env.DSH_INSTALL_ANCHOR = this.config.installAnchor
    for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME']) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
    const child = spawn(this.config.binary, args, {
      cwd: this.home,
      env,
      detached: true,
      // stderr is intentionally discarded: the desktop host does not expose
      // child diagnostics to the WebView, and an unread pipe could eventually
      // stop the long-lived local agent.
      // Keep stderr visible during desktop development so profile/plugin
      // startup failures are actionable; release hosts still receive no
      // browser-visible diagnostics.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    // The tuple stdio declaration guarantees a readable stream for stdout;
    // keep the assertion local so the runtime contract remains explicit while
    // avoiding an impossible-condition lint branch.
    const stdout = child.stdout as NodeJS.ReadableStream
    child.stderr?.on('data', (chunk: Buffer) => {
      if (process.env.NODE_ENV !== 'production') process.stderr.write(`[enterprise runtime] ${chunk.toString()}`)
    })
    this.webUrlPromise = new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer): void => {
        const match = chunk.toString().match(/dsh web:\s+(https?:\/\/[^\s]+)/)
        if (match?.[1]) {
          try {
            const url = validateLocalWebUrl(match[1])
            this.webUrlValue = url
            resolve(url)
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
          stdout.off('data', onData)
        }
      }
      stdout.on('data', onData)
      child.once('error', reject)
      child.once('close', () => { reject(new Error('Enterprise DSH runtime exited before opening its Web UI')) })
    })
    void this.webUrlPromise.catch(() => {})
    this.done = new Promise<void>(resolve => child.once('close', () => {
      // A leader may exit while tools remain. Its owned group must not outlive the runtime.
      try { this.signalGroup(child, 'SIGKILL') } catch (error) {
        // The close event can race process-group reaping on macOS; once the
        // leader is gone, EPERM means the kernel no longer permits signalling
        // the group and there is no owned process left to clean up.
        if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'ESRCH') {
          // Teardown must not turn a normal child exit into an uncaught
          // exception. The process is already gone; there is no safe recovery
          // action for a failed best-effort group signal.
        }
      }
      if (this.child === child) this.child = undefined
      void this.releaseOrganizationLock()
      resolve()
    }))
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', () => { reject(new Error('Desktop DSH executable could not start')) })
      })
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  /** Wait for the local Web profile to report its authenticated loopback URL. */
  async waitForWebUrl(timeoutMs = 30000): Promise<string> {
    if (this.webUrlValue) return this.webUrlValue
    if (!this.webUrlPromise) throw new Error('Desktop runtime has not started')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.webUrlPromise,
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => { reject(new Error('Desktop Web UI did not become ready')) }, timeoutMs)
        }),
      ])
    } finally { if (timer) clearTimeout(timer) }
  }

  /** Stop the owned process and wait for its exit. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    const child = this.child
    if (child === undefined) {
      this.webUrlValue = undefined
      this.webUrlPromise = undefined
      return (this.done ?? Promise.resolve()).finally(() => this.releaseOrganizationLock())
    }
    const done = this.done
    if (!done) throw new Error('Desktop process is missing its close observer')
    this.signalGroup(child, 'SIGTERM')
    const timer = setTimeout(() => { this.signalGroup(child, 'SIGKILL') }, this.config.shutdownTimeoutMs)
    this.stopping = done.finally(() => {
      clearTimeout(timer)
      this.stopping = undefined
      this.webUrlValue = undefined
      this.webUrlPromise = undefined
    })
    return this.stopping
  }

  private async releaseOrganizationLock(): Promise<void> {
    const lock = this.organizationLock
    this.organizationLock = undefined
    if (lock !== undefined) await lock.close()
  }

  private signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) return
    try { process.kill(-child.pid, signal) } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ESRCH' && !(code === 'EPERM' && child.exitCode !== null)) throw error
    }
  }
}
