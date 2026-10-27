import { describe, expect, it, vi } from 'vitest'
import { LayoutController, LayoutPresentation } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    toggleWorkbench: vi.fn(),
    openWorkbench: vi.fn(),
    closeWorkbench: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the three panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()
    service.toggleWorkbench()
    service.openWorkbench()
    service.closeWorkbench()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.toggleWorkbench).toHaveBeenCalledTimes(1)
    expect(panels.openWorkbench).toHaveBeenCalledTimes(1)
    expect(panels.closeWorkbench).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})

it('restores compiled branding on plugin removal without clearing a later owner', () => {
  const presentation = new LayoutPresentation()
  const changed = vi.fn()
  const unsubscribe = presentation.subscribe(changed)
  expect(presentation.get()).toBeUndefined()
  const release = presentation.setProductTitle('Arivo')
  expect(presentation.get()).toBe('Arivo')
  expect(() => presentation.setProductTitle('Other')).toThrow(/already has an owner/u)
  release()
  expect(presentation.get()).toBeUndefined()
  const next = presentation.setProductTitle('Next')
  release()
  expect(presentation.get()).toBe('Next')
  unsubscribe()
  next()
  expect(changed).toHaveBeenCalledTimes(3)
})

it('optional departure coordination can retain navigation and restores synchronous defaults on disposal', async () => {
  const { MainNavigation } = await import('../src/client/service.ts')
  const navigation = new MainNavigation()
  const pending: (() => void)[] = []
  const changed = vi.fn()
  navigation.subscribe(changed)
  const release = navigation.setTransitionHandler((change) => { pending.push(change) })
  expect(() => navigation.setTransitionHandler(() => {})).toThrow(/already have an owner/)
  navigation.openPluginSurface('arivo.studio')
  expect(navigation.get()).toBe('conversation')
  expect(changed).not.toHaveBeenCalled()
  pending.shift()?.()
  expect(navigation.get()).toBe('arivo.studio')
  navigation.openPluginMarket()
  expect(navigation.get()).toBe('arivo.studio')
  pending.shift()?.()
  expect(navigation.get()).toBe('plugin-market')
  release()
  const second = navigation.setTransitionHandler((change) => { pending.push(change) })
  release()
  navigation.openSettings()
  expect(navigation.get()).toBe('plugin-market')
  second()
  navigation.openConversation()
  expect(navigation.get()).toBe('conversation')
})
