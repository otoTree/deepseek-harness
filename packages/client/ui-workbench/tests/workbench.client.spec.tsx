// @vitest-environment jsdom

import { useSyncExternalStore, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BrowserSessionId, BrowserTabId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import { Workbench } from '../src/client/Workbench.tsx'
import type { WorkbenchProps } from '../src/client/contract/slots.ts'
import { createWorkbenchStore } from '../src/client/stores.ts'
import { createWorkbenchFileOpener } from '../src/client/file-opener.ts'

afterEach(cleanup)

describe('Workbench', () => {
  it('registers a plugin tab through the workbench.tabs owner and disposes it', async () => {
    const instance = createWorkbenchStore().create('dynamic-plugin')
    const registerTab = vi.fn((tab: { id: string; key: string; label: string; closable: boolean }) => {
      instance.actions.addTab({ ...tab, kind: 'plugin', key: tab.key })
      return () => { instance.actions.closeTab(tab.id) }
    })
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(), reconnect: vi.fn(),
      renderSlot: ((name: string, owner: { registerTab?: typeof registerTab }, options?: { fallback?: ReactNode }) => {
        if (name === 'workbench.tabs') {
          return <button type="button" onClick={() => { owner.registerTab?.({ id: 'media', key: 'media', label: 'Media', closable: true }) }}>register media</button>
        }
        return options?.fallback
      }) as WorkbenchProps['renderSlot'],
      sessionId: 'plugin-session' as SessionId,
      t: (key: string) => key,
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number }) => unknown) => selector({ id: 1 }),
      workbench: {}, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps

    render(<Workbench {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'register media' }))
    expect(registerTab).not.toHaveBeenCalled()
    expect(instance.store.getSnapshot().tabs).toContainEqual({ id: 'media', key: 'media', kind: 'plugin', label: 'Media', closable: true })
    expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy()
  })

  it('withdraws old readers during connection loss and uses the next generation baseline', async () => {
    const sessionId = 'session' as SessionId
    const instance = createWorkbenchStore().create('workbench-reconnect')
    instance.actions.setActiveTab('browser')
    let generation: { id: number } | undefined = { id: 1 }
    const signals: AbortSignal[] = []
    const browserFollow = vi.fn<WorkbenchRemote['browserFollow']>((_request, signal) => ({
      async *[Symbol.asyncIterator]() {
        if (signal === undefined) throw new Error('expected a cancellable reader')
        signals.push(signal)
        const browserId = `browser-${signals.length}` as BrowserSessionId
        yield { type: 'baseline', browserId, revision: 0, tabs: [{
          tabId: 'tab' as BrowserTabId, title: 'Recovered', url: 'about:blank', loading: false,
          active: true, canGoBack: false, canGoForward: false,
        }] }
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      },
    }))
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(), reconnect: vi.fn(),
      renderSlot: (_name: string, _owner: unknown, options?: { fallback?: ReactNode }) => options?.fallback,
      sessionId, t: (key: string) => key,
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number } | undefined) => unknown) => selector(generation),
      workbench: { browserFollow }, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps
    const { rerender, unmount } = render(<Workbench {...props} />)
    await screen.findByRole('application', { name: 'browserViewport' })
    expect(instance.store.getSnapshot().browserId).toBe('browser-1')
    generation = undefined
    rerender(<Workbench {...props} />)
    expect(signals[0]?.aborted).toBe(true)
    expect(screen.queryByRole('application', { name: 'browserViewport' })).toBeNull()
    generation = { id: 2 }
    rerender(<Workbench {...props} />)
    await waitFor(() => { expect(instance.store.getSnapshot().browserId).toBe('browser-2') })
    expect(browserFollow).toHaveBeenCalledTimes(2)
    unmount()
    expect(signals[1]?.aborted).toBe(true)
  })

  it('switches a selected result to Files and opens the workspace-relative file', async () => {
    const sessionId = 'session' as SessionId
    const instance = createWorkbenchStore().create('workbench-result')
    const fileRead = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        kind: 'text' as const,
        path: 'reports/result.md',
        content: 'opened result',
        version: 'version-1',
        mediaType: 'text/plain' as const,
      },
    }))
    const remote = {
      fileList: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { path: 'reports', entries: [{ name: 'result.md', type: 'file' as const }] },
      })),
      fileRead,
      fileWrite: vi.fn(),
    } as unknown as WorkbenchRemote
    const useStore: WorkbenchProps['useStore'] = selector => useSyncExternalStore(
      listener => instance.store.subscribe(listener),
      () => selector(instance.store.getSnapshot()),
    )
    const renderSlot = ((_name: string, owner: { tab: string; openFile(path: string): void }, options?: { fallback?: ReactNode }) => (
      owner.tab === 'results'
        ? <button type="button" onClick={() => { owner.openFile('/workspace/reports/result.md') }}>result</button>
        : options?.fallback
    )) as WorkbenchProps['renderSlot']
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(),
      renderSlot,
      sessionId,
      t: (key: string) => key,
      useSessions: (selector: (snapshot: { byId: Record<string, { cwd?: string }> }) => unknown) => selector({ byId: { [sessionId]: { cwd: '/workspace' } } }),
      useConnectionGeneration: (selector: (value: { id: number }) => unknown) => selector({ id: 1 }),
      reconnect: vi.fn(),
      useStore,
      workbench: remote,
      fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps

    const view = render(<Workbench {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'results' }))
    fireEvent.click(screen.getByRole('button', { name: 'result' }))

    expect(view.container.querySelector('[data-workbench]')?.getAttribute('data-active-tab')).toBe('files')
    expect(await screen.findByRole('textbox')).toHaveProperty('value', 'opened result')
    expect(fileRead).toHaveBeenCalledWith(
      { sessionId, path: 'reports/result.md' },
      expect.any(AbortSignal),
    )
  })

  it('opens built-in panels from the start tab', async () => {
    const instance = createWorkbenchStore().create('workbench-picker')
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(), reconnect: vi.fn(),
      renderSlot: (_name: string, _owner: unknown, options?: { fallback?: ReactNode }) => options?.fallback,
      sessionId: 'picker-session' as SessionId,
      t: (key: string) => ({
        title: 'Workbench', results: 'Results', terminal: 'Terminal', browser: 'Browser', files: 'Files',
        start: 'Start', openPanel: 'Open panel', empty: 'Choose a workbench panel',
      }[key] ?? key),
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number } | undefined) => unknown) => selector({ id: 1 }),
      workbench: {}, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps

    render(<Workbench {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browser' }))
    expect(instance.store.getSnapshot().activeTab).toBe('browser')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes Results back to Start and restores it from the Start entry', () => {
    const instance = createWorkbenchStore().create('results-lifecycle')
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(), reconnect: vi.fn(),
      renderSlot: ((_name: string, _owner: unknown, options?: { fallback?: ReactNode }) => options?.fallback) as WorkbenchProps['renderSlot'],
      sessionId: 'results-session' as SessionId,
      t: (key: string) => ({ start: 'Start', results: 'Results', terminal: 'Terminal', browser: 'Browser', files: 'Files', openPanel: 'Open panel', empty: 'Empty' }[key] ?? key),
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number } | undefined) => unknown) => selector({ id: 1 }),
      workbench: {}, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps
    render(<Workbench {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Results' }))
    fireEvent.click(screen.getByRole('button', { name: /close Results/ }))
    expect(instance.store.getSnapshot().activeTab).toBe('start')
    fireEvent.click(screen.getByRole('button', { name: 'Results' }))
    expect(instance.store.getSnapshot().activeTab).toBe('results')
  })
})
