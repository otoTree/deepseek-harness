// @vitest-environment jsdom

import { useSyncExternalStore, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import { Workbench } from '../src/client/Workbench.tsx'
import type { WorkbenchProps } from '../src/client/contract/slots.ts'
import { createWorkbenchStore } from '../src/client/stores.ts'
import { createWorkbenchFileOpener } from '../src/client/file-opener.ts'

afterEach(cleanup)

describe('Workbench', () => {
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
      instance.store.subscribe,
      () => selector(instance.store.getSnapshot()),
    )
    const renderSlot = ((_name: string, owner: { tab: string; openFile(path: string): void }, options: { fallback?: ReactNode }) => (
      owner.tab === 'results'
        ? <button type="button" onClick={() => { owner.openFile('/workspace/reports/result.md') }}>result</button>
        : options.fallback
    )) as WorkbenchProps['renderSlot']
    const props = {
      actions: instance.actions,
      closeDetails: vi.fn(),
      renderSlot,
      sessionId,
      t: (key: string) => key,
      useSessions: (selector: (snapshot: { byId: Record<string, { cwd?: string }> }) => unknown) => selector({ byId: { [sessionId]: { cwd: '/workspace' } } }),
      useStore,
      workbench: remote,
      fileOpener: createWorkbenchFileOpener(vi.fn()),
    } as unknown as WorkbenchProps

    const view = render(<Workbench {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'result' }))

    expect(view.container.querySelector('[data-workbench]')?.getAttribute('data-active-tab')).toBe('files')
    expect(await screen.findByRole('textbox')).toHaveProperty('value', 'opened result')
    expect(fileRead).toHaveBeenCalledWith(
      { sessionId, path: 'reports/result.md' },
      expect.any(AbortSignal),
    )
  })
})
