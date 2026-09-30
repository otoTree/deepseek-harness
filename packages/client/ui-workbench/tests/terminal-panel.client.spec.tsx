// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { TerminalSessionId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import { TerminalPanel } from '../src/client/panels/TerminalPanel.tsx'

const xterm = vi.hoisted(() => {
  class MockTerminal {
    static latest: MockTerminal | undefined
    readonly writes: string[] = []
    rows = 32
    cols = 96
    resets = 0
    focuses = 0
    disposed = false
    input: ((data: string) => void) | undefined
    constructor() { MockTerminal.latest = this }
    loadAddon() {}
    open() {}
    onData(listener: (data: string) => void) {
      this.input = listener
      return { dispose: vi.fn() }
    }
    reset() { this.resets += 1 }
    write(text: string) { this.writes.push(text) }
    focus() { this.focuses += 1 }
    dispose() { this.disposed = true }
  }
  class MockFitAddon {
    fit = vi.fn()
    dispose = vi.fn()
  }
  return { MockTerminal, MockFitAddon }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.MockTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.MockFitAddon }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const sessionId = 'session' as SessionId
const terminalId = 'pty-1' as TerminalSessionId

class MockResizeObserver {
  static latest: MockResizeObserver | undefined
  constructor(readonly callback: () => void) { MockResizeObserver.latest = this }
  observe() {}
  disconnect = vi.fn()
}

function successful(value: unknown) { return Promise.resolve({ ok: true as const, value }) }

function remoteHarness() {
  const terminalWrite = vi.fn((_request: { data: string }) => successful(undefined))
  const terminalResize = vi.fn(() => successful(undefined))
  const terminalOpen = vi.fn<WorkbenchRemote['terminalOpen']>()
  const remote = {
    terminalList: vi.fn(() => successful({ items: [{ sessionId: terminalId, name: 'Workbench', type: 'shell', status: { kind: 'running' } }] })),
    terminalOpen,
    terminalWrite,
    terminalResize,
    terminalFollow: (_request: unknown, signal?: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'baseline', terminalId, revision: 0, text: '\u001b[32mdsh> \u001b[0m', truncated: false }
        yield { type: 'delta', terminalId, revision: 1, text: 'ready\r\n', truncated: false }
        await new Promise<void>((resolve) => {
          if (signal?.aborted === true) resolve()
          else signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
      },
    }),
  } as unknown as WorkbenchRemote
  return { remote, terminalOpen, terminalWrite, terminalResize }
}

beforeEach(() => {
  xterm.MockTerminal.latest = undefined
  MockResizeObserver.latest = undefined
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TerminalPanel', () => {
  it('waits for discovery before following a cached terminal and ignores a late list after unmount', async () => {
    const { remote, terminalOpen } = remoteHarness()
    const listed = Promise.withResolvers<Awaited<ReturnType<WorkbenchRemote['terminalList']>>>()
    vi.spyOn(remote, 'terminalList').mockReturnValue(listed.promise)
    const follow = vi.spyOn(remote, 'terminalFollow')
    const { unmount } = render(<TerminalPanel t={key => key} reconnect={vi.fn()} remote={remote}
      sessionId={sessionId} terminalId={terminalId} setTerminalId={vi.fn()} />)
    expect(follow).not.toHaveBeenCalled()
    unmount()
    await act(async () => { listed.resolve({ ok: true, value: { items: [] } }) })
    expect(terminalOpen).not.toHaveBeenCalled()
    expect(follow).not.toHaveBeenCalled()
  })

  it('releases an exited Workbench name before creating a usable shell', async () => {
    const { remote, terminalOpen } = remoteHarness()
    vi.spyOn(remote, 'terminalList').mockResolvedValue({ ok: true, value: { items: [
      { sessionId: terminalId, name: 'Workbench', type: 'shell', status: { kind: 'exited' } },
    ] } })
    const closed = Promise.withResolvers<Awaited<ReturnType<WorkbenchRemote['terminalClose']>>>()
    const terminalClose = vi.fn(() => closed.promise)
    remote.terminalClose = terminalClose
    const replacement = 'pty-2' as TerminalSessionId
    vi.spyOn(remote, 'terminalOpen').mockResolvedValue({ ok: true, value: { terminal: {
      sessionId: replacement, type: 'shell', status: { kind: 'running' }, motd: '',
    } } })
    const follow = vi.spyOn(remote, 'terminalFollow')
    const setTerminalId = vi.fn()
    render(<TerminalPanel t={key => key} reconnect={vi.fn()} remote={remote}
      sessionId={sessionId} terminalId={terminalId} setTerminalId={setTerminalId} />)
    await waitFor(() => { expect(terminalClose).toHaveBeenCalledWith({ sessionId, terminalId }) })
    expect(terminalOpen).not.toHaveBeenCalled()
    await act(async () => { closed.resolve({ ok: true, value: { closed: true } }) })
    await waitFor(() => { expect(follow).toHaveBeenCalledWith({ sessionId, terminalId: replacement }, expect.any(AbortSignal)) })
    expect(setTerminalId).toHaveBeenCalledWith(replacement)
  })

  it('reuses a running terminal instead of selecting an exited Workbench terminal', async () => {
    const { remote, terminalOpen } = remoteHarness()
    const replacement = 'pty-2' as TerminalSessionId
    vi.spyOn(remote, 'terminalList').mockResolvedValue({ ok: true, value: { items: [
      { sessionId: terminalId, name: 'Workbench', type: 'shell', status: { kind: 'exited' } },
      { sessionId: replacement, type: 'shell', status: { kind: 'running' } },
    ] } })
    const follow = vi.spyOn(remote, 'terminalFollow')
    render(<TerminalPanel t={key => key} reconnect={vi.fn()} remote={remote}
      sessionId={sessionId} terminalId={terminalId} setTerminalId={vi.fn()} />)
    await waitFor(() => { expect(follow).toHaveBeenCalledWith({ sessionId, terminalId: replacement }, expect.any(AbortSignal)) })
    expect(terminalOpen).not.toHaveBeenCalled()
  })

  it('streams raw PTY output and forwards Bash keyboard bytes from the terminal canvas', async () => {
    const { remote, terminalWrite } = remoteHarness()
    const setTerminalId = vi.fn()
    const { container, unmount } = render(<TerminalPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      terminalId={terminalId}
      setTerminalId={setTerminalId}
    />)

    await screen.findByRole('application', { name: 'terminalInput' })
    await waitFor(() => {
      expect(xterm.MockTerminal.latest?.writes).toEqual(['\u001b[32mdsh> \u001b[0m', 'ready\r\n'])
    })
    const terminal = xterm.MockTerminal.latest
    terminal?.input?.('echo hello')
    terminal?.input?.('\r')
    terminal?.input?.('\u001b[A')
    terminal?.input?.('\t')
    terminal?.input?.('\u0003')
    await waitFor(() => {
      expect(terminalWrite.mock.calls.map(call => call[0].data)).toEqual([
        'echo hello', '\r', '\u001b[A', '\t', '\u0003',
      ])
    })
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('select')).toBeNull()

    unmount()
    expect(terminal?.disposed).toBe(true)
  })

  it('fits the renderer and sends its measured rows and columns to the PTY', async () => {
    const { remote, terminalResize } = remoteHarness()
    render(<TerminalPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      terminalId={terminalId}
      setTerminalId={vi.fn()}
    />)
    const canvas = await screen.findByRole('application', { name: 'terminalInput' })
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 500 },
    })
    MockResizeObserver.latest?.callback()
    await waitFor(() => {
      expect(terminalResize).toHaveBeenCalledWith({ sessionId, terminalId, rows: 32, cols: 96 })
    })
  })
})
