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

    expect(first.store.getSnapshot()).toMatchObject({ activeTab: 'browser', terminalId: 'pty-1', browserId: 'browser-1', browserTabId: 'tab-1', filePath: 'src', fileSelection: 'src/index.ts' })
    expect(second.store.getSnapshot()).toMatchObject({ activeTab: 'start', terminalId: undefined, browserId: undefined, browserTabId: undefined, filePath: '.', fileSelection: undefined })
  })

  it('adds and closes dynamic Workbench tabs with start as the fallback', () => {
    const instance = createWorkbenchStore().create('dynamic')
    instance.actions.addTab({ id: 'plugin-media', kind: 'plugin', key: 'media', label: 'Media', closable: true })
    expect(instance.store.getSnapshot().activeTab).toBe('media')
    instance.actions.closeTab('plugin-media')
    expect(instance.store.getSnapshot().activeTab).toBe('start')
    expect(instance.store.getSnapshot().tabs.some(tab => tab.id === 'plugin-media')).toBe(false)
  })

  it('closes Results back to Start even when another panel follows it', () => {
    const instance = createWorkbenchStore().create('results-with-following-tab')
    instance.actions.addTab({ id: 'results', kind: 'builtin', key: 'results', closable: true, order: 10 })
    instance.actions.addTab({ id: 'terminal', kind: 'builtin', key: 'terminal', closable: true, order: 20 })
    instance.actions.setActiveTab('results')
    instance.actions.closeTab('results')
    expect(instance.store.getSnapshot().activeTab).toBe('start')
    expect(instance.store.getSnapshot().tabs.some(tab => tab.key === 'results')).toBe(false)
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
