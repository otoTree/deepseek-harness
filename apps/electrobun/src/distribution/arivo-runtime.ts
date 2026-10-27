/** Arivo native supervisor launches only the verified first-party DSH profile. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { loadBundledPlugin } from './bundled-plugin.ts'
import { resolveDesktopDistribution } from './config.ts'
import { arivoIdentitySettings } from './arivo-identity.ts'
import { arivoAgentHome, arivoAgentScope } from './arivo-account-scope.ts'

const settings = z.object({
  binary: z.string().refine(isAbsolute),
  installAnchor: z.string().refine(isAbsolute),
  home: z.string().refine(isAbsolute),
  instanceHelper: z.string().refine(isAbsolute),
  pluginDirectory: z.string().refine(isAbsolute),
  shellDirectory: z.string().refine(isAbsolute),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  pluginVersion: z.string().min(1),
  target: z.enum(['darwin-arm64', 'win32-x64']),
  maxPluginBytes: z.number().int().positive(),
  startupTimeoutMs: z.number().int().min(100).max(120000),
  shutdownTimeoutMs: z.number().int().min(100).max(30000),
  identity: arivoIdentitySettings.extend({ keychainHelper: z.string().refine(isAbsolute) }).strict().optional(),
}).strict()

/** Validate a supervisor-only bootstrap URL without allowing a remote origin.
 * @param value - Line emitted by the bundled Arivo Host.
 * @returns The normalized authenticated loopback URL.
 */
export function arivoWorkbenchUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\d+$/u.test(url.port)
    || url.username || url.password || url.hash || url.pathname !== '/'
    || [...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('token').length !== 1
    || !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('token') ?? '')) {
    throw new Error('Arivo workbench must use its authenticated loopback URL')
  }
  return url.toString()
}

class AccountScopeChanged extends Error {
  constructor(readonly scope: string) { super('Arivo account scope changed') }
}

/** One process generation; all account changes replace it after awaited shutdown. */
class ArivoProcess {
  private child: ChildProcess | undefined
  private done: Promise<void> | undefined
  private closePlugin: (() => Promise<void>) | undefined
  private starting: Promise<string> | undefined
  private agentUrlValue: string | undefined
  private readonly abort = new AbortController()
  private stopping: Promise<void> | undefined
  private stoppingChild: Promise<void> | undefined
  private readonly config: z.infer<typeof settings>
  private readonly nextScope = Promise.withResolvers<string>()

  constructor(input: z.input<typeof settings>, private readonly scope: string, private readonly probe = false) {
    this.config = settings.parse(input)
  }

  waitForAccountChange(): Promise<string> { return this.nextScope.promise }

  /** Verify the packaged closure and start the named DSH profile exactly once.
   * @returns The local bootstrap URL, for the native WebView only.
   */
  start(): Promise<string> {
    if (this.stopping) return Promise.reject(new Error('Arivo runtime is stopping'))
    return this.starting ??= this.launch()
  }

  /** Return the original conversation UI after both Agent and Studio have started.
   * @returns Authenticated loopback URL owned by the same DSH process.
   */
  async agentUrl(): Promise<string> {
    await this.start()
    if (!this.agentUrlValue) throw new Error('Arivo Agent interface did not start')
    return this.agentUrlValue
  }

  private async launch(): Promise<string> {
    let url: string | undefined
    const config = this.config
    const scopedHome = await arivoAgentHome(config.home, this.scope)
    const agentHome = this.probe ? await mkdtemp(join(config.home, 'account-probe-')) : scopedHome
    const profileName = `arivo-studio-${randomUUID()}`
    const profile = join(agentHome, 'profiles', profileName)
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(config.startupTimeoutMs)])
    try {
      const close = await loadBundledPlugin({
        distribution: resolveDesktopDistribution('arivo'), directory: config.pluginDirectory,
        manifestSha256: config.manifestSha256, version: config.pluginVersion,
        target: config.target, maxBytes: config.maxPluginBytes, signal,
      }, async (plugin) => {
        await mkdir(profile, { recursive: true, mode: 0o700 })
        const write = async (name: string, value: string) => {
          const path = join(profile, name)
          const temporary = `${path}.${randomUUID()}.tmp`
          await writeFile(temporary, value, { flag: 'wx', mode: 0o600 })
          await rename(temporary, path)
        }
        await write('package.json', JSON.stringify({
          name: '@arivo/studio-profile', version: config.pluginVersion, type: 'module', private: true,
          dsh: { profile: { bundles: this.probe ? [] : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'startup' } },
        }) + '\n')
        await mkdir(join(agentHome, 'workspace'), { recursive: true, mode: 0o700 })
        const providers = [
          { id: 'arivo-studio-host', name: plugin.host, config: {
            version: config.pluginVersion, target: config.target,
            requestTimeoutMs: 10000, shutdownTimeoutMs: config.shutdownTimeoutMs,
            dataDirectory: config.home, instanceHelper: config.instanceHelper, nativeOwnerPid: process.pid,
            agentScope: { version: 1, id: this.scope },
            ...(config.identity ? { identity: config.identity } : {}),
          } },
          { id: 'arivo-studio-agent', name: plugin.agent, config: { clientEntry: plugin.client } },
        ]
        await write('cordis.patch.yml', JSON.stringify(this.probe ? [{ insert: providers }] : [
          { id: 'session-telemetry-otel', disabled: true },
          { id: 'ui-brand-official', disabled: true },
          { id: 'ui-trajectory', disabled: true },
          { id: 'llm-deepseek', disabled: true },
          { id: 'ui-settings-models', disabled: true },
          { id: 'ui-settings-plugins', disabled: true },
          { id: 'ui-settings-plugin-inventory', disabled: true },
          { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: join(agentHome, 'workspace') } },
          { id: 'agent-presets', config: { default: 'cordis', disabledPresets: ['standard', 'ptc', 'minimal'], roots: [{ path: join(agentHome, '.agent-presets'), trust: 'user' }],
            includeShippedRoot: true, includeUserRoot: false } },
          { insert: [
            ...providers,
            { id: 'arivo-startup-shell', name: join(config.shellDirectory, 'host.mjs'), config: { triggerStatePath: join(agentHome, 'triggers.json') } },
          ] }], null, 2) + '\n')
        signal.throwIfAborted()
        const env: NodeJS.ProcessEnv = { DSH_HOME: agentHome, DSH_INSTALL_ANCHOR: config.installAnchor }
        const permitted = new Set(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'LOCALAPPDATA',
          'APPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'PATHEXT', 'COMSPEC'])
        for (const [key, value] of Object.entries(process.env)) {
          if (permitted.has(key.toUpperCase())) env[key] = value
        }
        if (process.platform === 'win32') env.DSH_DESKTOP_PARENT_PID = String(process.pid)
        const child = spawn(config.binary, ['--profile', profileName, '--no-open', '--host', '127.0.0.1', '--port', '0'], {
          cwd: agentHome, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.child = child
        this.done = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
        // The supervisor never forwards child output, which may contain local bootstrap authorization.
        child.stderr.resume()
        const ready = new Promise<string>((resolve, reject) => {
          let buffer = ''
          let confirmedScope = false
          let readyResolved = false
          const cleanup = () => {
            signal.removeEventListener('abort', aborted)
            child.off('error', fail)
            child.off('close', fail)
          }
          const aborted = () => { cleanup(); reject(new Error('Arivo startup was cancelled', { cause: signal.reason })) }
          const fail = () => { cleanup(); reject(new Error('Arivo runtime exited before the workbench was ready')) }
          const data = (chunk: Buffer) => {
            buffer += chunk.toString('utf8')
            if (buffer.length > 65536) { cleanup(); reject(new Error('Arivo runtime readiness output exceeded its limit')); return }
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (line.startsWith('arivo account-scope: ')) {
                const value = line.slice('arivo account-scope: '.length)
                const parsed = value.startsWith('v1:') ? arivoAgentScope.safeParse(value.slice(3)) : undefined
                if (!parsed?.success) { cleanup(); reject(new Error('Invalid Arivo account scope')); return }
                if (this.probe || parsed.data !== this.scope) {
                  this.nextScope.resolve(parsed.data)
                  if (!readyResolved) { cleanup(); reject(new AccountScopeChanged(parsed.data)) }
                  return
                }
                confirmedScope = true
              }
              const prefix = line.startsWith('arivo workbench: ') ? 'arivo workbench: ' : line.startsWith('dsh web: ') ? 'dsh web: ' : undefined
              if (prefix) try {
                const parsed = arivoWorkbenchUrl(line.slice(prefix.length))
                if (prefix === 'dsh web: ') this.agentUrlValue = parsed
                else url = parsed
              }
              catch (error) { cleanup(); reject(new Error('Arivo runtime bootstrap was invalid', { cause: error })) }
              if (!readyResolved && confirmedScope && url && this.agentUrlValue) {
                readyResolved = true; cleanup(); resolve(url)
              }
            }
          }
          signal.addEventListener('abort', aborted, { once: true })
          child.once('error', fail)
          child.once('close', fail)
          child.stdout.on('data', data)
          if (signal.aborted) aborted()
        })
        try { url = await ready }
        catch (error) { await this.stopChild(); throw error }
        child.stdout.resume()
        return async () => { await this.stopChild(); await rm(this.probe ? agentHome : profile, { recursive: true, force: true }) }
      })
      this.closePlugin = close
      if (!url) throw new Error('Arivo runtime did not produce a workbench URL')
      return url
    } catch (error) { await this.stopChild(); await rm(this.probe ? agentHome : profile, { recursive: true, force: true }); throw error }
  }

  private stopChild(): Promise<void> { return this.stoppingChild ??= this.terminateChild() }

  private async terminateChild(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) { await this.done; return }
    const terminate = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    terminate('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    const failed = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try { terminate('SIGKILL') }
        catch (error) { reject(new Error('Arivo runtime could not be terminated', { cause: error })) }
      }, this.config.shutdownTimeoutMs)
    })
    try { await Promise.race([this.done, failed]) } finally { clearTimeout(timer) }
  }

  /** Observe the managed process after startup; native UI owns unexpected-exit feedback.
   * @returns Completion after the Host and its stdio have closed.
   */
  async waitForExit(): Promise<void> { await this.starting; await this.done }

  /** Cancel startup and await local provider shutdown; repeated calls share one result. */
  stop(): Promise<void> {
    return this.stopping ??= (async () => {
      this.abort.abort(new Error('Arivo runtime shutdown requested'))
      await this.starting?.catch(() => {})
      await this.closePlugin?.()
      await this.stopChild()
    })()
  }
}

/** Native window notifications for an account transition; callbacks must not retain old bootstrap URLs. */
export interface ArivoRuntimeNavigation {
  /** Clear the old account UI before awaiting its Host shutdown. */
  switching(): void
  /** Navigate only after the replacement Host confirms its credential-owned scope.
   * @param url - Replacement Agent's authenticated loopback bootstrap URL.
   */
  ready(url: string): void
}

/** Own all account generations, with one private DSH home and one live Host at a time. */
export class ArivoRuntime {
  private current: ArivoProcess | undefined
  private starting: Promise<string> | undefined
  private watching: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private readonly config: z.infer<typeof settings>

  constructor(input: z.input<typeof settings>, private readonly navigation?: ArivoRuntimeNavigation) {
    this.config = settings.parse(input)
  }

  private async prepare(scope: string, probe = false): Promise<string> {
    for (;;) {
      if (this.stopping) throw new Error('Arivo runtime is stopping')
      const generation = new ArivoProcess(this.config, scope, probe)
      this.current = generation
      try { return await generation.start() }
      catch (error) {
        await generation.stop()
        if (!(error instanceof AccountScopeChanged)) throw error
        scope = error.scope
        probe = false
      }
    }
  }

  /** Start the verified profile and reconcile its saved native identity before exposing any UI.
   * @returns The creative bootstrap URL for the initial confirmed account.
   */
  start(): Promise<string> {
    if (this.stopping) return Promise.reject(new Error('Arivo runtime is stopping'))
    return this.starting ??= this.prepare('device', true).then((url) => {
      this.watching = this.watch()
      // Native waitForExit observes failures; attach a handler before handing startup back to the caller.
      void this.watching.catch(() => {})
      return url
    })
  }

  private generation(): ArivoProcess {
    if (!this.current) throw new Error('Arivo runtime has no active Host')
    return this.current
  }

  private isStopping(): boolean { return this.stopping !== undefined }

  private async watch(): Promise<void> {
    while (!this.isStopping()) {
      const generation = this.generation()
      const change = await Promise.race([
        generation.waitForAccountChange().then(scope => ({ scope })),
        generation.waitForExit().then(() => undefined),
      ])
      if (!change || this.isStopping()) return
      this.navigation?.switching()
      await generation.stop()
      if (this.isStopping()) return
      await this.prepare(change.scope)
      if (this.isStopping()) return
      this.navigation?.ready(await this.generation().agentUrl())
    }
  }

  /** Read the current confirmed Agent URL; old account URLs expire on transition.
   * @returns Authenticated native-only bootstrap URL.
   */
  async agentUrl(): Promise<string> { await this.start(); return this.generation().agentUrl() }

  /** Observe all generations until shutdown or an unexpected Host failure. */
  async waitForExit(): Promise<void> { await this.starting; await this.watching }

  /** Cancel startup or switching and await the active Host and its resources; repeated calls share one result. */
  stop(): Promise<void> {
    return this.stopping ??= Promise.resolve().then(async () => {
      await this.current?.stop()
      await this.starting?.catch(() => {})
      await this.watching?.catch(() => {})
      await this.current?.stop()
    })
  }
}
