import { describe, expect, it } from 'vitest'
import type { BrowserSessionId, BrowserTabId, TerminalSessionId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import { createWorkbenchStore } from '../src/client/stores.ts'

describe('Workbench store', () => {
  it('keeps panel selections independent across Session instances', () => {
    const handle = createWorkbenchStore()
    const first = handle.create('first')
    const second = handle.create('second')
    first.actions.setActiveTab('browser')
    first.actions.setTerminalId('pty-1' as TerminalSessionId)
    first.actions.setBrowser('browser-1' as BrowserSessionId, 'tab-1' as BrowserTabId)
    first.actions.setFilePath('src')
    first.actions.setFileSelection('src/index.ts')

    expect(first.store.getSnapshot()).toEqual({
      activeTab: 'browser', terminalId: 'pty-1', browserId: 'browser-1', browserTabId: 'tab-1',
      filePath: 'src', fileSelection: 'src/index.ts',
    })
    expect(second.store.getSnapshot()).toEqual({
      activeTab: 'results', terminalId: undefined, browserId: undefined, browserTabId: undefined,
      filePath: '.', fileSelection: undefined,
    })
  })

  it('retains each selection while switching active panels', () => {
    const instance = createWorkbenchStore().create('session')
    instance.actions.setTerminalId('pty-7' as TerminalSessionId)
    instance.actions.setBrowser('browser-7' as BrowserSessionId, 'tab-9' as BrowserTabId)
    instance.actions.setFileSelection('README.md')
    instance.actions.setActiveTab('terminal')
    instance.actions.setActiveTab('files')
    instance.actions.setActiveTab('browser')

    expect(instance.store.getSnapshot()).toMatchObject({
      activeTab: 'browser', terminalId: 'pty-7', browserId: 'browser-7', browserTabId: 'tab-9', fileSelection: 'README.md',
    })
  })

  it('opens absolute and relative result paths in the Files panel', () => {
    const instance = createWorkbenchStore().create('result-session')
    instance.actions.openFile('/workspace/reports/result.md', '/workspace')
    expect(instance.store.getSnapshot()).toMatchObject({
      activeTab: 'files', filePath: 'reports', fileSelection: 'reports/result.md',
    })

    instance.actions.openFile('output/table.csv', '/workspace')
    expect(instance.store.getSnapshot()).toMatchObject({
      activeTab: 'files', filePath: 'output', fileSelection: 'output/table.csv',
    })

    instance.actions.openFile('C:\\work\\exports\\deck.pptx', 'C:\\work')
    expect(instance.store.getSnapshot()).toMatchObject({
      activeTab: 'files', filePath: 'exports', fileSelection: 'exports/deck.pptx',
    })
  })
})
