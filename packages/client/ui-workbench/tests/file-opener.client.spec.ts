import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createWorkbenchFileOpener } from '../src/client/file-opener.ts'

const SESSION = 'session-1' as SessionId

describe('Workbench file opener', () => {
  it('opens the mounted Session Workbench and forwards the path', async () => {
    const openDetails = vi.fn()
    const opener = createWorkbenchFileOpener(openDetails)
    const openFile = vi.fn()
    const dispose = opener.register(SESSION, openFile)

    await opener.openFile(SESSION, 'src/report.md')

    expect(openDetails).toHaveBeenCalledOnce()
    expect(openFile).toHaveBeenCalledWith('src/report.md')
    dispose()
  })

  it('queues a Chat click until the Session Workbench mounts', async () => {
    const opener = createWorkbenchFileOpener(vi.fn())
    await opener.openFile(SESSION, 'src/report.md')
    const openFile = vi.fn()

    opener.register(SESSION, openFile)

    expect(openFile).toHaveBeenCalledWith('src/report.md')
  })

  it('selects a topbar tab on the mounted Session Workbench', () => {
    const openDetails = vi.fn()
    const setActiveTab = vi.fn()
    const opener = createWorkbenchFileOpener(openDetails)
    const dispose = opener.register(SESSION, { openFile: vi.fn(), setActiveTab })

    opener.openTab(SESSION, 'terminal')

    expect(setActiveTab).toHaveBeenCalledWith('terminal')
    expect(openDetails).toHaveBeenCalledOnce()
    dispose()
  })

  it('queues a topbar tab until the Session Workbench mounts', () => {
    const setActiveTab = vi.fn()
    const opener = createWorkbenchFileOpener(vi.fn())
    opener.openTab(SESSION, 'browser')

    opener.register(SESSION, { openFile: vi.fn(), setActiveTab })

    expect(setActiveTab).toHaveBeenCalledWith('browser')
  })
})
