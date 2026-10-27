// @vitest-environment jsdom

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BrowserSessionId, BrowserTabId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import { Workbench } from '../src/client/Workbench.tsx'
import { en } from '../src/client/locales.ts'
import type { WorkbenchProps } from '../src/client/contract/slots.ts'
import { createWorkbenchStore } from '../src/client/stores.ts'
import { createWorkbenchFileOpener } from '../src/client/file-opener.ts'

afterEach(cleanup)

describe('Workbench', () => {
  it('renders the permanent Start tab before a chat Session is selected', () => {
    const instance = createWorkbenchStore().create()
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(), reconnect: vi.fn(),
      renderSlot: (_name: string, _owner: unknown, options?: { fallback?: ReactNode }) => options?.fallback,
      sessionId: undefined,
      t: (key: keyof typeof en) => en[key],
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number } | undefined) => unknown) => selector({ id: 1 }),
      workbench: {}, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps

    render(<Workbench {...props} />)
    expect(document.querySelector('[data-workbench-start]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Workbench' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Terminal' }).getAttribute('aria-description')).toBe(en.terminalDescription)
    for (const key of ['resultsDescription', 'terminalDescription', 'browserDescription', 'filesDescription'] as const) {
      expect(screen.getByText(en[key])).toBeTruthy()
    }
  })

  it('publishes a plugin card before first use, restores its tab and removes it on contribution disposal', async () => {
    const instance = createWorkbenchStore().create('start-entry')
    function Launcher({ registerPanel }: Pick<import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'workbench.tabs'>, 'registerPanel'>) {
      useEffect(() => registerPanel({ id: 'script', key: 'script', label: 'Script', description: 'Write episodes', icon: () => <svg data-script-icon />, closable: true }), [registerPanel])
      return null
    }
    let contributed = true
    const props = {
      actions: instance.actions, closeDetails: vi.fn(), reconnect: vi.fn(),
      renderSlot: ((name: string, owner: import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'workbench.tabs'>, options?: { fallback?: ReactNode }) => name === 'workbench.tabs' && contributed
        ? <Launcher {...owner} /> : options?.fallback) as WorkbenchProps['renderSlot'],
      sessionId: 'start-entry' as SessionId, t: (key: keyof typeof en) => en[key],
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot())),
      useConnectionGeneration: () => undefined, workbench: {}, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps
    const view = render(<Workbench {...props} />)
    const card = screen.getByRole('button', { name: 'Script' })
    expect(card.querySelector('[data-script-icon]')).toBeTruthy()
    expect(instance.store.getSnapshot().activeTab).toBe('start')
    expect(instance.store.getSnapshot().tabs.map(tab => tab.key)).toEqual(['start'])
    fireEvent.click(card)
    expect(instance.store.getSnapshot().activeTab).toBe('script')
    fireEvent.click(screen.getByRole('button', { name: `${en.close} Script` }))
    expect(screen.getByRole('button', { name: 'Script' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Script' }))
    expect(instance.store.getSnapshot().activeTab).toBe('script')
    contributed = false
    view.rerender(<Workbench {...props} />)
    expect(instance.store.getSnapshot().activeTab).toBe('start')
    expect(instance.store.getSnapshot().registeredTabs.some(tab => tab.key === 'script')).toBe(false)
  })

  it('creates one real chat Session when an unowned Workbench opens', async () => {
    const instance = createWorkbenchStore().create()
    const ensureSession = vi.fn(async () => 'created-session' as SessionId)
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(), reconnect: vi.fn(), ensureSession,
      renderSlot: (_name: string, _owner: unknown, options?: { fallback?: ReactNode }) => options?.fallback,
      sessionId: undefined,
      open: true,
      t: (key: string) => ({ title: 'Workbench', results: 'Results', terminal: 'Terminal', browser: 'Browser', files: 'Files', start: 'Start', openPanel: 'Open panel', empty: 'Empty' }[key] ?? key),
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number } | undefined) => unknown) => selector({ id: 1 }),
      workbench: {}, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps

    const view = render(<Workbench {...props} />)
    await waitFor(() => { expect(ensureSession).toHaveBeenCalledOnce() })
    view.rerender(<Workbench {...props} />)
    expect(ensureSession).toHaveBeenCalledOnce()
  })

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
    const toggle = screen.getByRole('button', { name: 'openPanel' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(toggle, { key: 'Escape' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'register media' }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(registerTab).not.toHaveBeenCalled()
    expect(instance.store.getSnapshot().tabs).toContainEqual({ id: 'media', key: 'media', kind: 'plugin', label: 'Media', closable: true })
    expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy()
  })

  it('replaces connection readers while retaining the mounted browser panel', async () => {
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
      sessionId, open: true, browserInitializationTimeoutMs: 5000, t: (key: string) => key,
      useSessions: () => undefined,
      useStore: (selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) => useSyncExternalStore(
        listener => instance.store.subscribe(listener), () => selector(instance.store.getSnapshot()),
      ),
      useConnectionGeneration: (selector: (value: { id: number } | undefined) => unknown) => selector(generation),
      runtime: { ensureWorkbenchRuntime: async () => ({ ok: true }), releaseWorkbenchRuntime: async () => ({ ok: true }) },
      workbench: { browserFollow }, fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps
    const { rerender, unmount } = render(<Workbench {...props} />)
    await screen.findByRole('application', { name: 'browserViewport' })
    const initialBrowser = screen.getByRole('application', { name: 'browserViewport' })
    expect(instance.store.getSnapshot().browserId).toBe('browser-1')
    generation = undefined
    rerender(<Workbench {...props} />)
    expect(signals[0]?.aborted).toBe(true)
    expect(screen.queryByRole('application', { name: 'browserViewport' })).not.toBeNull()
    generation = { id: 2 }
    rerender(<Workbench {...props} />)
    await waitFor(() => { expect(instance.store.getSnapshot().browserId).toBe('browser-3') })
    expect(screen.getByRole('application', { name: 'browserViewport' })).toBe(initialBrowser)
    expect(browserFollow).toHaveBeenCalledTimes(3)
    unmount()
    expect(signals.every(signal => signal.aborted)).toBe(true)
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
