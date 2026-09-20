import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { BrowserActionRequest, BrowserActionValue, BrowserCreateRequest, BrowserCreateValue, BrowserFollowFrame, BrowserKeyRequest, BrowserListValue, BrowserNavigateRequest, BrowserObservationRequest, BrowserOpenRequest, BrowserPointerRequest, BrowserScrollRequest, BrowserSessionRequest, BrowserSnapshotValue, BrowserScreenshotValue, BrowserTabRequest, BrowserCloseTabRequest, BrowserTextRequest, FileListRequest, FileListValue, FileReadRequest, FileReadValue, FileWriteRequest, FileWriteValue, TerminalCloseRequest, TerminalFollowFrame, TerminalListValue, TerminalOpenRequest, TerminalOpenValue, TerminalReadRequest, TerminalReadValue, TerminalResizeRequest, TerminalSendRequest, TerminalSendValue, TerminalSignalRequest, TerminalSignalValue, TerminalWriteRequest } from '../types.ts'

/** Typed Client calls and streams exposed by the Workbench Host controller. */
export interface WorkbenchRemote {
  terminalList(request: { sessionId: string }): Promise<RemoteResult<TerminalListValue>>
  terminalOpen(request: TerminalOpenRequest, signal?: AbortSignal): Promise<RemoteResult<TerminalOpenValue>>
  terminalSend(request: TerminalSendRequest): Promise<RemoteResult<TerminalSendValue>>
  terminalWrite(request: TerminalWriteRequest): Promise<RemoteResult<void>>
  terminalRead(request: TerminalReadRequest): Promise<RemoteResult<TerminalReadValue>>
  terminalSignal(request: TerminalSignalRequest): Promise<RemoteResult<TerminalSignalValue>>
  terminalResize(request: TerminalResizeRequest): Promise<RemoteResult<void>>
  terminalClose(request: TerminalCloseRequest): Promise<RemoteResult<{ closed: boolean }>>
  terminalFollow(request: TerminalReadRequest, signal?: AbortSignal): AsyncIterable<TerminalFollowFrame>
  fileList(request: FileListRequest, signal?: AbortSignal): Promise<RemoteResult<FileListValue>>
  fileRead(request: FileReadRequest, signal?: AbortSignal): Promise<RemoteResult<FileReadValue>>
  fileWrite(request: FileWriteRequest, signal?: AbortSignal): Promise<RemoteResult<FileWriteValue>>
  browserCreate(request: BrowserCreateRequest): Promise<RemoteResult<BrowserCreateValue>>
  browserClose(request: BrowserSessionRequest): Promise<RemoteResult<void>>
  browserList(request: BrowserSessionRequest): Promise<RemoteResult<BrowserListValue>>
  browserOpen(request: BrowserOpenRequest): Promise<RemoteResult<BrowserActionValue>>
  browserNavigate(request: BrowserNavigateRequest): Promise<RemoteResult<BrowserActionValue>>
  browserSelectTab(request: BrowserTabRequest): Promise<RemoteResult<BrowserActionValue>>
  browserCloseTab(request: BrowserCloseTabRequest): Promise<RemoteResult<{ closed: boolean }>>
  browserBack(request: BrowserTabRequest): Promise<RemoteResult<BrowserActionValue>>
  browserForward(request: BrowserTabRequest): Promise<RemoteResult<BrowserActionValue>>
  browserReload(request: BrowserTabRequest): Promise<RemoteResult<BrowserActionValue>>
  browserClick(request: BrowserActionRequest): Promise<RemoteResult<BrowserActionValue>>
  browserFill(request: BrowserActionRequest): Promise<RemoteResult<BrowserActionValue>>
  browserPress(request: BrowserActionRequest): Promise<RemoteResult<BrowserActionValue>>
  browserPointer(request: BrowserPointerRequest): Promise<RemoteResult<BrowserActionValue>>
  browserScroll(request: BrowserScrollRequest): Promise<RemoteResult<BrowserActionValue>>
  browserType(request: BrowserTextRequest): Promise<RemoteResult<BrowserActionValue>>
  browserKey(request: BrowserKeyRequest): Promise<RemoteResult<BrowserActionValue>>
  browserObserve(request: BrowserObservationRequest): Promise<RemoteResult<BrowserActionValue>>
  browserSnapshot(request: BrowserTabRequest): Promise<RemoteResult<BrowserSnapshotValue>>
  browserScreenshot(request: BrowserTabRequest): Promise<RemoteResult<BrowserScreenshotValue>>
  browserFollow(request: BrowserCreateRequest, signal?: AbortSignal): AsyncIterable<BrowserFollowFrame>
}

declare module '@deepseek-ai/dsh-typert-protocol' { interface TypertRemoteNamespaceMap { workbench: WorkbenchRemote } }
/** Generated Typert Client namespace for Workbench calls. */
export type WorkbenchRemoteNamespace = TypertClientRemote['workbench']
