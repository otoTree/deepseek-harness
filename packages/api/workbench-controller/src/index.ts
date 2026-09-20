import { Context } from '@deepseek-ai/cordis'
import { serviceForAgent } from '@deepseek-ai/dsh-agent-presets'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import type {} from '@deepseek-ai/dsh-browser'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {
  BrowserActionRequest,
  BrowserActionValue,
  BrowserCloseTabRequest,
  BrowserCreateRequest,
  BrowserCreateValue,
  BrowserFollowFrame,
  BrowserKeyRequest,
  BrowserListValue,
  BrowserNavigateRequest,
  BrowserObservationRequest,
  BrowserOpenRequest,
  BrowserPointerRequest,
  BrowserScreenshotValue,
  BrowserScrollRequest,
  BrowserSessionRequest,
  BrowserSnapshotValue,
  BrowserTabRequest,
  BrowserTextRequest,
  FileEntry,
  FileListRequest,
  FileListValue,
  FileReadRequest,
  FileReadValue,
  FileWriteRequest,
  FileWriteValue,
  SessionRequest,
  TerminalCloseRequest,
  TerminalFollowFrame,
  TerminalListValue,
  TerminalOpenRequest,
  TerminalOpenValue,
  TerminalReadRequest,
  TerminalReadValue,
  TerminalResizeRequest,
  TerminalSendRequest,
  TerminalSendValue,
  TerminalSignalRequest,
  TerminalSignalValue,
  TerminalWriteRequest,
  WorkbenchMediaType,
  WorkbenchDocumentFormat,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { workbenchController: WorkbenchController } }

/** Workbench Remote limits applied before values cross into the Client. */
export interface Config {
  /** Maximum bytes decoded and returned by one text-file read. */
  maxFileBytes?: number
  /** Maximum bytes encoded and returned by one binary-preview read. */
  maxMediaBytes?: number
}

/** Schemastery configuration for Workbench Remote limits. */
export const Config: z<Config> = z.object({
  maxFileBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2_000_000),
  maxMediaBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_000_000),
})

/** Host Remote owner for the Session-following Workbench. */
export class WorkbenchController extends TypertRemoteService {
  static inject = ['sessionController', 'fs', 'browsers', 'sandboxPolicy', 'typert']
  static Config = Config
  private readonly maxFileBytes: number
  private readonly maxMediaBytes: number
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workbenchController', { namespace: 'workbench' })
    this.maxFileBytes = config.maxFileBytes ?? 2_000_000
    this.maxMediaBytes = config.maxMediaBytes ?? 32_000_000
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 1) {
      throw new Error('workbench-controller: maxFileBytes must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.maxMediaBytes) || this.maxMediaBytes < 1) {
      throw new Error('workbench-controller: maxMediaBytes must be a positive safe integer')
    }
  }

  /**
   * List terminals owned by the requested Session.
   * @param request - Session selector.
   * @returns current terminal snapshots.
   */
  @Remote('terminalList')
  async terminalList(request: SessionRequest): Promise<TerminalListValue> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    return { items: terminals.list(owner) }
  }
  /**
   * Open one persistent terminal for the requested Session.
   * @param request - terminal type, name, and optional working directory.
   * @param signal - cancellation for terminal startup.
   * @returns the opened terminal state.
   */
  @Remote('terminalOpen')
  async terminalOpen(request: TerminalOpenRequest, signal: AbortSignal): Promise<TerminalOpenValue> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    const terminal = await terminals.spawn(owner, {
      type: request.type,
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    }, signal)
    return { terminal }
  }
  /**
   * Send text to one persistent terminal.
   * @param request - terminal identity and submitted text.
   * @returns viewport and terminal status after the write settles.
   */
  @Remote('terminalSend')
  async terminalSend(request: TerminalSendRequest): Promise<TerminalSendValue> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    const operation = terminals.startSend(owner, request.terminalId, {
      text: request.text,
      submit: request.submit ?? true,
    })
    const result = await operation.done
    return { viewport: result.viewport, waitReason: result.waitReason, status: result.sessionStatus }
  }
  /**
   * Write raw keyboard input to one persistent terminal.
   * @param request - terminal identity and terminal input bytes.
   * @returns when the PTY transport accepts the input.
   */
  @Remote('terminalWrite')
  async terminalWrite(request: TerminalWriteRequest): Promise<void> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    await terminals.write(owner, request.terminalId, request.data)
  }
  /**
   * Read retained output from one persistent terminal.
   * @param request - terminal identity.
   * @returns retained raw PTY text and truncation state.
   */
  @Remote('terminalRead')
  async terminalRead(request: TerminalReadRequest): Promise<TerminalReadValue> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    return terminals.readOutput(owner, request.terminalId)
  }
  /**
   * Signal one persistent terminal process group.
   * @param request - terminal identity and signal.
   * @returns delivery metadata for the process group.
   */
  @Remote('terminalSignal')
  async terminalSignal(request: TerminalSignalRequest): Promise<TerminalSignalValue> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    return terminals.signal(owner, request.terminalId, request.signal)
  }
  /**
   * Resize one persistent terminal PTY.
   * @param request - terminal identity and row/column dimensions.
   * @returns when the resize has reached the provider.
   */
  @Remote('terminalResize')
  async terminalResize(request: TerminalResizeRequest): Promise<void> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    await terminals.resize(owner, request.terminalId, { rows: request.rows, cols: request.cols })
  }
  /**
   * Close one persistent terminal.
   * @param request - terminal identity.
   * @returns whether a live terminal was closed.
   */
  @Remote('terminalClose')
  async terminalClose(request: TerminalCloseRequest): Promise<{ closed: boolean }> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    return { closed: await terminals.kill(owner, request.terminalId, 'Workbench closed') }
  }

  /**
   * Stream current retained output followed by raw PTY deltas.
   * @param request - terminal identity.
   * @param signal - stream cancellation.
   * @returns baseline-plus-delta terminal frames.
   */
  @Remote({ mode: 'stream' })
  async *terminalFollow(request: TerminalReadRequest, signal: AbortSignal): AsyncIterable<TerminalFollowFrame> {
    const owner = await this.agent(request.sessionId)
    const terminals = this.terminalsFor(owner)
    const pending: Array<{ revision: number; text: string; truncated: boolean }> = []
    let wake = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const onAbort = (): void => { aborted.resolve() }
    signal.addEventListener('abort', onAbort, { once: true })
    const stop = terminals.subscribeOutput(owner, request.terminalId, (delta) => {
      pending.push(delta)
      wake.resolve()
    })
    try {
      const baseline = terminals.readOutput(owner, request.terminalId)
      let revision = baseline.revision
      yield { type: 'baseline', terminalId: request.terminalId, revision, text: baseline.text, truncated: baseline.truncated }
      while (!signal.aborted) {
        if (pending.length === 0) {
          await Promise.race([wake.promise, aborted.promise])
          wake = Promise.withResolvers<void>()
        }
        while (pending.length > 0) {
          const frame = pending.shift()
          if (frame !== undefined && frame.revision > revision) {
            revision = frame.revision
            yield { type: 'delta', terminalId: request.terminalId, ...frame }
          }
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      stop()
    }
  }

  /**
   * List one directory below the Session workspace root.
   * @param request - Session and workspace-relative directory.
   * @param signal - operation cancellation.
   * @returns normalized path and directory entries.
   */
  @Remote('fileList')
  async fileList(request: FileListRequest, signal: AbortSignal): Promise<FileListValue> {
    const path = normalizeWorkspacePath(request.path ?? '.')
    const target = await this.workspaceTarget(request.sessionId, path, signal)
    try {
      const entries = await this.ctx.fs.listDir(target, signal)
      return {
        path,
        entries: entries.map((entry): FileEntry => ({
          name: entry.name,
          type: entry.type,
          ...(entry.size === undefined ? {} : { size: entry.size }),
          ...(entry.version === undefined ? {} : { version: String(entry.version) }),
        })),
      }
    } catch (error) { this.throwFileError(path, error) }
  }
  /**
   * Read one bounded text, document, or browser-native media file below the Session workspace root.
   * @param request - Session and workspace-relative file path.
   * @param signal - operation cancellation.
   * @returns versioned text or Base64 preview content.
   */
  @Remote('fileRead')
  async fileRead(request: FileReadRequest, signal: AbortSignal): Promise<FileReadValue> {
    const path = normalizeWorkspacePath(request.path)
    const target = await this.workspaceTarget(request.sessionId, path, signal)
    const mediaType = mediaTypeForPath(path)
    const documentFormat = documentFormatForPath(path)
    const maxBytes = mediaType !== undefined || documentFormat !== undefined ? this.maxMediaBytes : this.maxFileBytes
    try {
      const info = await this.ctx.fs.stat(target, signal)
      if (info?.type !== 'file') throw new RemoteError('workbench/file-invalid', `not a readable file: ${path}`, { path })
      if ((info.size ?? 0) > maxBytes) {
        throw new RemoteError(
          'workbench/file-too-large',
          `file exceeds the ${maxBytes}-byte Workbench limit: ${path}`,
          { path, maxBytes },
        )
      }
      const bytes = await this.ctx.fs.readBytes(target, signal, maxBytes)
      if (mediaType !== undefined) {
        return {
          kind: 'media',
          path,
          data: Buffer.from(bytes).toString('base64'),
          version: String(info.version),
          mediaType,
        }
      }
      if (documentFormat !== undefined) {
        return {
          kind: 'document',
          path,
          data: Buffer.from(bytes).toString('base64'),
          version: String(info.version),
          format: documentFormat,
        }
      }
      let content: string
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
        throw new RemoteError('workbench/file-binary', `file is not valid UTF-8 text: ${path}`, { path })
      }
      if (content.includes('\0')) throw new RemoteError('workbench/file-binary', `file contains binary data: ${path}`, { path })
      return { kind: 'text', path, content, version: String(info.version), mediaType: 'text/plain' }
    } catch (error) { this.throwFileError(path, error, maxBytes) }
  }
  /**
   * Replace one text or editable Office file when its expected version still matches.
   * @param request - path, replacement payload, and expected version.
   * @param signal - operation cancellation.
   * @returns path and newly committed version.
   */
  @Remote('fileWrite')
  async fileWrite(request: FileWriteRequest, signal: AbortSignal): Promise<FileWriteValue> {
    const path = normalizeWorkspacePath(request.path)
    const target = await this.workspaceTarget(request.sessionId, path, signal)
    const owner = await this.agent(request.sessionId)
    const policy = this.ctx.sandboxPolicy.resolve({ session: owner.session })
    try {
      const expected = { kind: 'replaceIfVersion' as const, version: request.expectedVersion as FsVersion }
      const result = request.kind === 'text'
        ? await this.ctx.fs.writeText(target, request.content, expected, signal, policy)
        : await this.ctx.fs.writeBytes(
          target,
          decodeOfficeReplacement(path, request.data, this.maxMediaBytes),
          expected,
          signal,
          policy,
        )
      return { path, version: String(result.version) }
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_STALE_VERSION') {
        throw new RemoteError(
          'workbench/file-conflict',
          `file changed since it was read: ${path}`,
          { path, version: request.expectedVersion },
          { cause: error },
        )
      }
      this.throwFileError(path, error)
    }
  }

  /**
   * Discover or create the Session browser context.
   * @param request - Session and optional provider name.
   * @returns the shared browser context identity.
   */
  @Remote('browserCreate')
  async browserCreate(request: BrowserCreateRequest): Promise<BrowserCreateValue> {
    const owner = await this.agent(request.sessionId)
    return { browserId: this.ctx.browsers.ensure(owner.id, request.provider, owner.ctx) }
  }
  /**
   * Close a Session browser context and all its tabs.
   * @param request - Session and browser identities.
   * @returns when provider cleanup completes.
   */
  @Remote('browserClose')
  browserClose(request: BrowserSessionRequest): Promise<void> { return this.ctx.browsers.close(request.sessionId, request.browserId) }
  /**
   * List committed tabs in a Session browser context.
   * @param request - Session and browser identities.
   * @returns the complete tab list.
   */
  @Remote('browserList')
  browserList(request: BrowserSessionRequest): BrowserListValue {
    return { tabs: this.ctx.browsers.list(request.sessionId, request.browserId) }
  }
  /**
   * Open and select a new browser tab.
   * @param request - browser identity and URL.
   * @returns the committed tab.
   */
  @Remote('browserOpen')
  browserOpen(request: BrowserOpenRequest): Promise<BrowserActionValue> {
    return this.ctx.browsers.open(request.sessionId, request.browserId, request.url)
  }
  /**
   * Navigate an existing browser tab.
   * @param request - tab identity and URL.
   * @returns the committed tab.
   */
  @Remote('browserNavigate')
  browserNavigate(request: BrowserNavigateRequest): Promise<BrowserActionValue> {
    return this.ctx.browsers.navigate(request.sessionId, request.browserId, request.tabId, request.url)
  }
  /**
   * Select an existing browser tab.
   * @param request - tab identity.
   * @returns the selected tab.
   */
  @Remote('browserSelectTab')
  browserSelectTab(request: BrowserTabRequest): BrowserActionValue {
    return this.ctx.browsers.select(request.sessionId, request.browserId, request.tabId)
  }
  /**
   * Close one browser tab.
   * @param request - tab identity.
   * @returns a close acknowledgement.
   */
  @Remote('browserCloseTab') browserCloseTab(request: BrowserCloseTabRequest): Promise<{ closed: boolean }> { return this.ctx.browsers.closeTab(request.sessionId, request.browserId, request.tabId) }
  /**
   * Navigate one browser tab backward.
   * @param request - tab identity.
   * @returns the committed tab.
   */
  @Remote('browserBack') browserBack(request: BrowserTabRequest): Promise<BrowserActionValue> { return this.ctx.browsers.back(request.sessionId, request.browserId, request.tabId) }
  /**
   * Navigate one browser tab forward.
   * @param request - tab identity.
   * @returns the committed tab.
   */
  @Remote('browserForward') browserForward(request: BrowserTabRequest): Promise<BrowserActionValue> { return this.ctx.browsers.forward(request.sessionId, request.browserId, request.tabId) }
  /**
   * Reload one browser tab.
   * @param request - tab identity.
   * @returns the committed tab.
   */
  @Remote('browserReload') browserReload(request: BrowserTabRequest): Promise<BrowserActionValue> { return this.ctx.browsers.reload(request.sessionId, request.browserId, request.tabId) }
  /**
   * Click an element selected in the provider page.
   * @param request - tab identity and selector.
   * @returns the committed tab.
   */
  @Remote('browserClick')
  browserClick(request: BrowserActionRequest): Promise<BrowserActionValue> { return this.ctx.browsers.action(request.sessionId, request.browserId, request.tabId, 'click', request.selector) }
  /**
   * Fill an element selected in the provider page.
   * @param request - tab identity, selector, and value.
   * @returns the committed tab.
   */
  @Remote('browserFill')
  browserFill(request: BrowserActionRequest): Promise<BrowserActionValue> { return this.ctx.browsers.action(request.sessionId, request.browserId, request.tabId, 'fill', request.selector, request.value) }
  /**
   * Press a key on an element selected in the provider page.
   * @param request - tab identity, selector, and key.
   * @returns the committed tab.
   */
  @Remote('browserPress')
  browserPress(request: BrowserActionRequest): Promise<BrowserActionValue> { return this.ctx.browsers.action(request.sessionId, request.browserId, request.tabId, 'press', request.selector, request.value) }
  /**
   * Click provider-page viewport coordinates.
   * @param request - tab identity, coordinates, and click count.
   * @returns the committed tab.
   */
  @Remote('browserPointer')
  browserPointer(request: BrowserPointerRequest): Promise<BrowserActionValue> {
    return this.ctx.browsers.clickAt(
      request.sessionId,
      request.browserId,
      request.tabId,
      request.x,
      request.y,
      request.clicks,
    )
  }
  /**
   * Apply a wheel delta to the provider page.
   * @param request - tab identity and wheel delta.
   * @returns the committed tab.
   */
  @Remote('browserScroll')
  browserScroll(request: BrowserScrollRequest): Promise<BrowserActionValue> {
    return this.ctx.browsers.scroll(
      request.sessionId,
      request.browserId,
      request.tabId,
      request.deltaX,
      request.deltaY,
    )
  }
  /**
   * Insert text at the provider page's focused element.
   * @param request - tab identity and text.
   * @returns the committed tab.
   */
  @Remote('browserType')
  browserType(request: BrowserTextRequest): Promise<BrowserActionValue> {
    return this.ctx.browsers.insertText(request.sessionId, request.browserId, request.tabId, request.text)
  }
  /**
   * Press a key chord at the provider page's focused element.
   * @param request - tab identity and key chord.
   * @returns the committed tab.
   */
  @Remote('browserKey')
  browserKey(request: BrowserKeyRequest): Promise<BrowserActionValue> {
    return this.ctx.browsers.pressFocused(request.sessionId, request.browserId, request.tabId, request.key)
  }
  /**
   * Store bounded semantic state from the visible native browser.
   * @param request - tab identity and native observation.
   * @returns the committed tab.
   */
  @Remote('browserObserve')
  browserObserve(request: BrowserObservationRequest): BrowserActionValue {
    return this.ctx.browsers.observe(request.sessionId, request.browserId, request.tabId, request)
  }
  /**
   * Read the current semantic page snapshot.
   * @param request - tab identity.
   * @returns semantic text from the native observation or provider.
   */
  @Remote('browserSnapshot')
  async browserSnapshot(request: BrowserTabRequest): Promise<BrowserSnapshotValue> {
    return { text: await this.ctx.browsers.snapshot(request.sessionId, request.browserId, request.tabId) }
  }
  /**
   * Capture the provider page as a bounded PNG payload.
   * @param request - tab identity.
   * @returns a base64 PNG result.
   */
  @Remote('browserScreenshot')
  async browserScreenshot(request: BrowserTabRequest): Promise<BrowserScreenshotValue> {
    const data = await this.ctx.browsers.screenshot(request.sessionId, request.browserId, request.tabId)
    return { data: Buffer.from(data).toString('base64'), mediaType: 'image/png' }
  }

  /**
   * Stream a complete browser baseline followed by committed state revisions.
   * @param request - Session and optional provider name.
   * @param signal - stream cancellation.
   * @returns baseline-plus-state browser frames.
   */
  @Remote({ mode: 'stream' })
  async *browserFollow(request: BrowserCreateRequest, signal: AbortSignal): AsyncIterable<BrowserFollowFrame> {
    const owner = await this.agent(request.sessionId)
    const browserId = this.ctx.browsers.ensure(owner.id, request.provider, owner.ctx)
    const pending: BrowserFollowFrame[] = []
    let wake = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const onAbort = (): void => { aborted.resolve() }
    signal.addEventListener('abort', onAbort, { once: true })
    const stop = this.ctx.on('browser/change', (sessionId, changedBrowserId, revision, tabs) => {
      if (sessionId !== owner.id || changedBrowserId !== browserId) return
      pending.push({ type: 'state', browserId, revision, tabs })
      wake.resolve()
    })
    try {
      let revision = this.ctx.browsers.revision(owner.id, browserId)
      yield { type: 'baseline', browserId, revision, tabs: this.ctx.browsers.list(owner.id, browserId) }
      while (!signal.aborted) {
        if (pending.length === 0) {
          await Promise.race([wake.promise, aborted.promise])
          wake = Promise.withResolvers<void>()
        }
        while (pending.length > 0) {
          const frame = pending.shift()
          if (frame !== undefined && frame.revision > revision) {
            revision = frame.revision
            yield frame
          }
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      stop()
    }
  }

  private async agent(id: SessionRequest['sessionId']): Promise<Agent> {
    const result = await this.ctx.sessionController.resolveAgent(id)
    if ('error' in result) throw result.error
    return result.agent
  }
  private terminalsFor(owner: Agent): TerminalSessionService {
    const terminals = serviceForAgent(this.ctx, owner, 'terminals')
    if (terminals === undefined) {
      throw new RemoteError(
        'workbench/session',
        `Session has no terminal capability: ${owner.id}`,
        { sessionId: owner.id },
      )
    }
    return terminals
  }
  private async workspaceTarget(id: SessionId, path: string, signal: AbortSignal): Promise<FsTarget> {
    const cwd = await this.cwd(id)
    const root = await this.ctx.fs.resolve('.', { cwd, signal })
    const target = await this.ctx.fs.resolve(path, { cwd, signal })
    if (!this.ctx.fs.contains(root, target)) {
      throw new RemoteError('workbench/file-invalid', `path leaves the Session workspace: ${path}`, { path })
    }
    return target
  }
  private throwFileError(path: string, error: unknown, maxBytes = this.maxFileBytes): never {
    if (error instanceof RemoteError) throw error
    if (error instanceof FsError) {
      if (error.code === 'FS_TOO_LARGE') {
        throw new RemoteError('workbench/file-too-large', error.message, { path, maxBytes }, { cause: error })
      }
      if (error.code === 'FS_NOT_TEXT') {
        throw new RemoteError('workbench/file-binary', error.message, { path }, { cause: error })
      }
      throw new RemoteError('workbench/file-error', error.message, { path, code: error.code }, { cause: error })
    }
    throw error
  }
  private async cwd(id: SessionId): Promise<string> {
    const inspection = await this.ctx.sessionController.inspect(id)
    if (inspection.meta.cwd === undefined) {
      throw new RemoteError('workbench/session', `Session has no workspace: ${id}`, { sessionId: id })
    }
    return inspection.meta.cwd
  }
}

const MEDIA_TYPES = new Map<string, WorkbenchMediaType>([
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['flac', 'audio/flac'],
  ['gif', 'image/gif'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['m4a', 'audio/mp4'],
  ['mov', 'video/quicktime'],
  ['mp3', 'audio/mpeg'],
  ['mp4', 'video/mp4'],
  ['oga', 'audio/ogg'],
  ['ogg', 'audio/ogg'],
  ['ogv', 'video/ogg'],
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
  ['wav', 'audio/wav'],
  ['webm', 'video/webm'],
  ['webp', 'image/webp'],
])

const DOCUMENT_FORMATS = new Map<string, WorkbenchDocumentFormat>([
  ['docx', 'docx'],
  ['pptx', 'pptx'],
  ['xlsx', 'xlsx'],
  ['csv', 'csv'],
])

/** Return the browser-native media type selected by a workspace filename. */
function mediaTypeForPath(path: string): WorkbenchMediaType | undefined {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  return dot < 0 ? undefined : MEDIA_TYPES.get(basename.slice(dot + 1).toLowerCase())
}

/** Return the bounded document renderer selected by a workspace filename. */
function documentFormatForPath(path: string): WorkbenchDocumentFormat | undefined {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  return dot < 0 ? undefined : DOCUMENT_FORMATS.get(basename.slice(dot + 1).toLowerCase())
}

function decodeOfficeReplacement(path: string, data: string, maxBytes: number): Uint8Array {
  const format = documentFormatForPath(path)
  if (format !== 'docx' && format !== 'xlsx') {
    throw new RemoteError('workbench/file-invalid', `binary editing is not supported for this file: ${path}`, { path })
  }
  const maximumBase64Length = Math.ceil(maxBytes / 3) * 4
  if (data.length === 0 || data.length > maximumBase64Length || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new RemoteError('workbench/file-invalid', `invalid Base64 replacement for: ${path}`, { path })
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.toString('base64') !== data) {
    throw new RemoteError('workbench/file-invalid', `invalid Base64 replacement for: ${path}`, { path })
  }
  if (bytes.byteLength > maxBytes) {
    throw new RemoteError('workbench/file-too-large', `file exceeds the ${maxBytes}-byte Workbench limit: ${path}`, { path, maxBytes })
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new RemoteError('workbench/file-invalid', `editable Office file is not an OOXML archive: ${path}`, { path })
  }
  return bytes
}

function normalizeWorkspacePath(value: string): string {
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new RemoteError('workbench/file-invalid', `path must be relative to the Session workspace: ${value}`, { path: value })
  }
  const parts = value.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      throw new RemoteError('workbench/file-invalid', `path leaves the Session workspace: ${value}`, { path: value })
    }
    normalized.push(part)
  }
  return normalized.join('/') || '.'
}

export default WorkbenchController
