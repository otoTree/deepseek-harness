/** Native update interaction; downloads and extraction quiesce before desktop quit. */
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDesktopRelease, type DesktopRelease, type DesktopUpdateConfig } from './update-manifest.ts'
import { downloadDesktopRelease, fetchReleaseEnvelope, type UpdateFetch } from './update-download.ts'
import { updateMessages } from './messages.ts'

type UpdateCopy = { [K in keyof typeof updateMessages.en]: string }

/** Native dialog fields independent of Electrobun imports. */
export interface UpdateDialog {
  type: 'info' | 'error' | 'question'
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

/** Native operations; install stops owned resources before opening the prepared path. */
export interface DesktopUpdateActions {
  dialog: (options: UpdateDialog) => Promise<{ response: number }>
  notify: (body: string) => void
  prepare: (artifact: string, release: DesktopRelease, signal: AbortSignal) => Promise<string>
  install: (path: string) => Promise<void>
  /** Publish a verified version, or clear the launch-scoped notification. */
  available: (version: string | null) => void
}

/** Serializes user checks and prevents late network/dialog results from installing after quit. */
export class DesktopUpdates {
  private pending: { mode: 'startup' | 'manual'; promise: Promise<void> } | undefined
  private startup: Promise<void> | undefined
  private versionAvailable: string | null = null
  private io: Promise<unknown> | undefined
  private cancellation: AbortController | undefined
  private closing = false
  private directory: string | undefined
  private handingOff = false

  constructor(
    private readonly config: DesktopUpdateConfig | undefined,
    private readonly version: string,
    private readonly target: string,
    private readonly t: UpdateCopy,
    private readonly actions: DesktopUpdateActions,
    private readonly request: UpdateFetch = fetch,
  ) {}

  /** Check on explicit user request; concurrent clicks share one interaction.
   * @returns Completion of the dialog/download/install interaction.
   */
  check(): Promise<void> {
    if (this.closing) return Promise.resolve()
    if (this.pending?.mode === 'startup') return this.pending.promise.then(() => this.check())
    return this.pending?.promise ?? this.begin('manual')
  }

  /** Silently check once per launch; an active manual check already covers discovery.
   * @returns Completion of discovery without downloading or showing native dialogs.
   */
  checkAtStartup(): Promise<void> {
    if (this.closing || !this.config) return Promise.resolve()
    return this.startup ??= this.pending?.promise ?? this.begin('startup')
  }

  /** Latest verified version awaiting user action in this launch, or null. */
  get availableVersion(): string | null { return this.versionAvailable }

  /** Hide the notification for this launch; manual checks remain available. */
  dismissNotification(): void { this.setAvailable(null) }

  private setAvailable(version: string | null): void {
    if (this.versionAvailable === version) return
    this.versionAvailable = version
    this.actions.available(version)
  }

  private begin(mode: 'startup' | 'manual'): Promise<void> {
    if (mode === 'manual') this.dismissNotification()
    const promise = this.run(mode).finally(() => { this.pending = undefined })
    this.pending = { mode, promise }
    return promise
  }

  /** Cancel the current interaction; a later menu request may retry. */
  cancel(): void {
    this.cancellation?.abort()
  }

  /** Prevent new interactions and await filesystem/network work without awaiting an install callback.
   * @returns Completion of active I/O and removal of unclaimed temporary files.
   */
  async stop(): Promise<void> {
    this.closing = true
    this.cancel()
    this.dismissNotification()
    // The interaction reports transfer/extraction failures; teardown still waits for their settlement.
    await this.io?.catch(() => undefined)
    if (!this.handingOff) await this.removeDownload()
  }

  private async removeDownload(): Promise<void> {
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
    this.directory = undefined
  }

  private async run(mode: 'startup' | 'manual'): Promise<void> {
    const controller = new AbortController()
    this.cancellation = controller
    const signal = controller.signal
    let installing = false
    const t = this.t
    const inform = (message: string, type: 'info' | 'error' = 'info'): Promise<{ response: number }> =>
      this.actions.dialog({ type, title: t.title, message, buttons: [t.ok], defaultId: 0, cancelId: 0 })
    try {
      if (!this.config) {
        if (mode === 'manual') await inform(t.unconfigured)
        return
      }
      if (mode === 'manual') this.actions.notify(t.checking)
      const checkSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
      const checking = fetchReleaseEnvelope(this.config.url, checkSignal, this.request)
      this.io = checking
      const bytes = await checking
      signal.throwIfAborted()
      const release = bytes && readDesktopRelease(bytes, this.config.publicKey, this.target, this.version)
      if (mode === 'startup') {
        this.setAvailable(release ? release.version : null)
        return
      }
      if (!release) {
        await inform(t.current.replace('{version}', this.version))
        return
      }
      const available = await this.actions.dialog({
        type: 'question', title: t.title, message: t.available.replace('{version}', release.version),
        detail: release.notes, buttons: [t.later, t.download], defaultId: 0, cancelId: 0,
      })
      signal.throwIfAborted()
      if (available.response !== 1) return
      this.actions.notify(t.downloading)
      const preparing = (async () => {
        this.directory = await mkdtemp(join(tmpdir(), 'dsh-update-'))
        await chmod(this.directory, 0o700)
        const artifact = join(this.directory, release.target === 'win32-x64' ? 'installer.zip' : 'installer.dmg')
        const transferSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)])
        await downloadDesktopRelease(release, artifact, transferSignal, this.request)
        return this.actions.prepare(artifact, release, transferSignal)
      })()
      this.io = preparing
      const installer = await preparing
      signal.throwIfAborted()
      const ready = await this.actions.dialog({
        type: 'question', title: t.title, message: t.ready.replace('{version}', release.version),
        detail: release.target === 'win32-x64' ? t.windowsInstall : t.macInstall,
        buttons: [t.later, t.install], defaultId: 0, cancelId: 0,
      })
      signal.throwIfAborted()
      if (ready.response !== 1) return
      this.handingOff = true
      installing = true
      try {
        await this.actions.install(installer)
      } catch (error) {
        this.handingOff = false
        throw error
      }
    } catch {
      if (mode === 'manual' && (!signal.aborted || installing)) await inform(t.failed, 'error')
    } finally {
      if (!this.handingOff) await this.removeDownload()
      this.io = undefined
      this.cancellation = undefined
    }
  }
}
