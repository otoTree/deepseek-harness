import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
/** Opaque identity of one Session-owned browser context. */
export type BrowserSessionId = Branded<'BrowserSessionId'>
/** Opaque identity of one tab within a browser context. */
export type BrowserTabId = Branded<'BrowserTabId'>
/** Opaque identity of one persistent terminal. */
export type TerminalSessionId = Branded<'TerminalSessionId'>
/** Client-safe committed state for one browser tab. */
export interface BrowserTab {
  readonly tabId: BrowserTabId
  readonly title: string
  readonly url: string
  readonly favicon?: string
  readonly loading: boolean
  readonly active: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}
/** Client-safe terminal process state. */
export interface TerminalSessionSnapshot {
  readonly sessionId: string
  readonly name?: string
  readonly type: string
  readonly pid?: number
  readonly status: {
    readonly kind: string
    readonly exitCode?: number | null
    readonly signal?: string | null
  }
}
/** Terminal state returned after a successful spawn. */
export interface TerminalSpawnResult extends TerminalSessionSnapshot { readonly motd: string }
/** Signals accepted by the Workbench terminal Remote. */
export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'
/** Retained terminal text and its source line interval. */
export interface TerminalReadResult {
  readonly text: string
  readonly totalLines: number
  readonly lineBegin: number
  readonly lineEnd: number
  readonly truncated: boolean
}

/** Opaque Session-scoped Workbench target identity. */
export type WorkbenchTarget = Branded<'WorkbenchTarget'>
/** Base request addressing one product Session. */
export interface SessionRequest { readonly sessionId: SessionId }
/** Current terminal list for a Session. */
export interface TerminalListValue { readonly items: readonly TerminalSessionSnapshot[] }
/** Request to create one persistent terminal. */
export interface TerminalOpenRequest extends SessionRequest { readonly type: string; readonly name?: string; readonly cwd?: string }
/** Result containing the newly opened terminal. */
export interface TerminalOpenValue { readonly terminal: TerminalSpawnResult }
/** Request to write text to one terminal. */
export interface TerminalSendRequest extends SessionRequest {
  readonly terminalId: TerminalSessionId
  readonly text: string
  readonly submit?: boolean
}
/** Request to write raw keyboard input to one terminal. */
export interface TerminalWriteRequest extends SessionRequest { readonly terminalId: TerminalSessionId; readonly data: string }
/** Request to read retained raw PTY output. */
export interface TerminalReadRequest extends SessionRequest { readonly terminalId: TerminalSessionId }
/** Request to send a process signal to one terminal. */
export interface TerminalSignalRequest extends SessionRequest { readonly terminalId: TerminalSessionId; readonly signal: TerminalSignal }
/** Request to resize one terminal PTY. */
export interface TerminalResizeRequest extends SessionRequest {
  readonly terminalId: TerminalSessionId
  readonly rows: number
  readonly cols: number
}
/** Stable result returned after a signal reaches the terminal process group. */
export interface TerminalSignalValue { readonly delivered: true; readonly targetPgid: number }
/** Request to close one terminal. */
export interface TerminalCloseRequest extends SessionRequest { readonly terminalId: TerminalSessionId }
/** Terminal state returned after a write settles. */
export interface TerminalSendValue { readonly viewport: string; readonly waitReason: string; readonly status: TerminalSpawnResult['status'] }
/** Workbench projection of retained raw PTY output. */
export interface TerminalReadValue { readonly text: string; readonly truncated: boolean }
/** Raw PTY output stream; each connection starts with current retained bytes. */
export type TerminalFollowFrame =
  | { readonly type: 'baseline'; readonly terminalId: TerminalSessionId; readonly revision: number; readonly text: string; readonly truncated: boolean }
  | { readonly type: 'delta'; readonly terminalId: TerminalSessionId; readonly revision: number; readonly text: string; readonly truncated: boolean }
/** Request to list one workspace-relative directory. */
export interface FileListRequest extends SessionRequest { readonly path?: string }
/** Client-safe metadata for one directory entry. */
export interface FileEntry { readonly name: string; readonly type: 'file' | 'directory' | 'other'; readonly size?: number; readonly version?: string }
/** Directory listing returned to the Workbench. */
export interface FileListValue { readonly path: string; readonly entries: readonly FileEntry[] }
/** Browser-native media types the Workbench can preview without executing file content. */
export type WorkbenchMediaType =
  | 'application/pdf'
  | 'audio/flac'
  | 'audio/mp4'
  | 'audio/mpeg'
  | 'audio/ogg'
  | 'audio/wav'
  | 'image/avif'
  | 'image/bmp'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/svg+xml'
  | 'image/webp'
  | 'video/mp4'
  | 'video/ogg'
  | 'video/quicktime'
  | 'video/webm'
/** Office and delimited-text formats rendered by the Workbench without editing. */
export type WorkbenchDocumentFormat = 'docx' | 'pptx' | 'xlsx' | 'csv'
/** Request to read one workspace-relative file. */
export interface FileReadRequest extends SessionRequest { readonly path: string }
/** Versioned UTF-8 text returned for editing. */
export interface TextFileReadValue {
  readonly kind: 'text'
  readonly path: string
  readonly content: string
  readonly version: string
  readonly mediaType: 'text/plain'
}
/** Versioned binary content returned for a browser-native media preview. */
export interface MediaFileReadValue {
  readonly kind: 'media'
  readonly path: string
  readonly data: string
  readonly version: string
  readonly mediaType: WorkbenchMediaType
}
/** Versioned bounded Office or CSV payload for a Workbench preview or editor. */
export interface DocumentFileReadValue {
  readonly kind: 'document'
  readonly path: string
  readonly data: string
  readonly version: string
  readonly format: WorkbenchDocumentFormat
}
/** Versioned file content returned to the Workbench. */
export type FileReadValue = TextFileReadValue | MediaFileReadValue | DocumentFileReadValue
/** Fields shared by version-checked file replacements. */
interface FileWriteBase extends SessionRequest {
  readonly path: string
  readonly expectedVersion: string
}
/** Request to replace one workspace-relative UTF-8 text file. */
export interface TextFileWriteRequest extends FileWriteBase {
  readonly kind: 'text'
  readonly content: string
}
/** Request to replace one editable Office file with a Base64 OOXML payload. */
export interface BinaryFileWriteRequest extends FileWriteBase {
  readonly kind: 'binary'
  readonly data: string
}
/** Version-checked text or editable Office file replacement. */
export type FileWriteRequest = TextFileWriteRequest | BinaryFileWriteRequest
/** Path and new version returned after a file replacement. */
export interface FileWriteValue { readonly path: string; readonly version: string }
/** Request to discover or create the Session browser context. */
export interface BrowserCreateRequest extends SessionRequest { readonly provider?: string }
/** Identity returned for a Session browser context. */
export interface BrowserCreateValue { readonly browserId: BrowserSessionId }
/** Base request addressing one Session browser context. */
export interface BrowserSessionRequest extends SessionRequest { readonly browserId: BrowserSessionId }
/** Base request addressing one tab. */
export interface BrowserTabRequest extends BrowserSessionRequest { readonly tabId: BrowserTabId }
/** Request to close one browser tab. */
export interface BrowserCloseTabRequest extends BrowserTabRequest {}
/** Complete committed browser tab list. */
export interface BrowserListValue { readonly tabs: readonly BrowserTab[] }
/** Request to open a new browser tab. */
export interface BrowserOpenRequest extends BrowserSessionRequest { readonly url: string }
/** Request to navigate an existing browser tab. */
export interface BrowserNavigateRequest extends BrowserTabRequest { readonly url: string }
/** Request for a selector-based browser action. */
export interface BrowserActionRequest extends BrowserTabRequest { readonly selector: string; readonly value?: string }
/** Request for a viewport-coordinate browser click. */
export interface BrowserPointerRequest extends BrowserTabRequest { readonly x: number; readonly y: number; readonly clicks: 1 | 2 }
/** Request for a browser viewport wheel delta. */
export interface BrowserScrollRequest extends BrowserTabRequest { readonly deltaX: number; readonly deltaY: number }
/** Request to insert text at the focused page element. */
export interface BrowserTextRequest extends BrowserTabRequest { readonly text: string }
/** Request to press a key chord at the focused page element. */
export interface BrowserKeyRequest extends BrowserTabRequest { readonly key: string }
/** Bounded semantic state observed from a visible native browser. */
export interface BrowserObservationRequest extends BrowserTabRequest {
  readonly title: string
  readonly url: string
  readonly snapshot: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}
/** Committed tab returned after a browser action. */
export interface BrowserActionValue { readonly tab: BrowserTab }
/** Semantic page snapshot returned to a Remote consumer. */
export interface BrowserSnapshotValue { readonly text: string }
/** Base64 PNG screenshot returned to a Remote consumer. */
export interface BrowserScreenshotValue { readonly data: string; readonly mediaType: 'image/png' }
/** Browser state stream; each connection starts with a complete baseline. */
export type BrowserFollowFrame =
  | { readonly type: 'baseline'; readonly browserId: BrowserSessionId; readonly revision: number; readonly tabs: readonly BrowserTab[] }
  | { readonly type: 'state'; readonly browserId: BrowserSessionId; readonly revision: number; readonly tabs: readonly BrowserTab[] }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'workbench/session': { readonly sessionId: SessionId }
    'workbench/file-conflict': { readonly path: string; readonly version: string }
    'workbench/file-invalid': { readonly path: string }
    'workbench/file-binary': { readonly path: string }
    'workbench/file-too-large': { readonly path: string; readonly maxBytes: number }
    'workbench/file-error': { readonly path: string; readonly code: string }
    'workbench/browser-limit': { readonly reason: string }
  }
}
