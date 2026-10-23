// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsRootComponentProps, SettingsSectionRow } from '../src/client/shell-contract.ts'
import { SettingsPage } from '../src/client/SettingsPage.tsx'
import type { SettingsPageProps } from '../src/client/shell-contract.ts'
import { createSettingsViewStore } from '../src/client/settings-view-store.ts'
import { bindSnapshotSelector } from '../../ui-renderer/src/client/bind.ts'
import { MainNavigation } from '../../ui-layout/src/client/service.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type Row = SettingsSectionRow
type Step = { id: string; order: number }

/** Slot-content stand-ins: the shell renders whatever the seats contribute. */
const SEAT_CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
}

type AttentionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useSessionPendingInteraction']>[0]>[0]
type ConnectionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useConnectionState']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SettingsRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount({
  wide = true,
  connectionState = 'connected',
  onboardingActive = true,
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  steps = [
    { id: 'welcome', order: -100 },
    { id: 'credential', order: 0 },
  ],
}: {
  wide?: boolean
  connectionState?: ConnectionSnapshot
  onboardingActive?: boolean
  rows?: Row[]
  steps?: Step[]
} = {}) {
  // Mutable row source standing in for the bound useSections hook; bump()
  // plays a ledger change through the same observable contract.
  let current = rows
  let currentConnectionState = connectionState
  const listeners = new Set<() => void>()
  const connectionListeners = new Set<() => void>()
  const reconnect = vi.fn()
  const renderSlot = vi.fn(
    ((key: string, _owner: unknown, opts?: { only?: string }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
      return SEAT_CONTENT[key]
    }),
  )
  const useSessions = ((select: (state: unknown) => unknown) => select(onboardingActive
    ? { phase: 'ready', current: undefined, byId: {} }
    : {
      phase: 'ready',
      current: 'active-session',
      byId: { 'active-session': { blank: false } },
    })) as never
  const unusedHook = (() => { throw new Error('unused by SettingsRoot') }) as never
  const navigation = new MainNavigation()
  const store = createSettingsViewStore().create()
  const useSurface: SettingsRootComponentProps['useSurface'] = selector => selector(useSyncExternalStore(listener => navigation.subscribe(listener), () => navigation.get()))
  const props: SettingsRootComponentProps = {
    useSurface,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    openSettings: () => { navigation.openSettings() },
    exitSettings: () => { navigation.openConversation() },
    useSessions,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    wide,
    reconnect,
    t: makeTranslate(en),
    useConnectionState: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        connectionListeners.add(listener)
        return () => { connectionListeners.delete(listener) }
      }, [])
      return select(currentConnectionState)
    },
    useOnboardingSteps: select => select(steps),
    useSections: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return select(current)
    },
    renderSlot: renderSlot as SettingsRootComponentProps['renderSlot'],
  }
  function Fixture() {
    const surface = useSurface(surface => surface)
    return <><SettingsRoot {...props} />{surface === 'settings' ? <SettingsPage {...props} __renders={undefined} surface="settings" renderSlot={renderSlot as SettingsPageProps['renderSlot']} /> : null}</>
  }
  const view = render(<Fixture />)
  const bump = (next: Row[]) => {
    act(() => {
      current = next
      for (const fn of [...listeners]) fn()
    })
  }
  const setConnectionState = (next: typeof currentConnectionState) => {
    act(() => {
      currentConnectionState = next
      for (const fn of [...connectionListeners]) fn()
    })
  }
  return { view, renderSlot, bump, listeners, reconnect, setConnectionState, navigation }
}

function openPanel() {
  const trigger = screen.getByRole('button', { name: 'Settings' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('SettingsRoot trigger', () => {
  it('renders the trigger seat content as the accessible name (no aria-label of its own)', () => {
    const { renderSlot } = mount()
    const trigger = screen.getByRole('button', { name: 'Settings' })
    expect(trigger.hasAttribute('aria-label')).toBe(false)
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: true })
    expect(trigger.getAttribute('aria-current')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings', current: 'page' })).toBeTruthy()
  })

  it('hands the rail state to the trigger seat', () => {
    const { renderSlot } = mount({ wide: false })
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: false })
  })

  it('shows outage, retry progress, and a two-second recovery confirmation', () => {
    vi.useFakeTimers()
    const mounted = mount()
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()

    mounted.setConnectionState('disconnected')
    const indicator = screen.getByRole('button', { name: 'Disconnected, reconnect now' })
    expect(indicator.textContent).toContain('Disconnected')
    expect(indicator.hasAttribute('title')).toBe(false)
    expect(indicator.querySelector('svg')).toBeTruthy()
    fireEvent.click(indicator)
    expect(mounted.reconnect).toHaveBeenCalledOnce()

    mounted.setConnectionState('connecting')
    expect(screen.getByRole('button', { name: 'Connecting, restart now' }).textContent)
      .toContain('Connecting...')

    mounted.setConnectionState('connected')
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the reconnect indicator out of the collapsed rail', () => {
    mount({ wide: false, connectionState: 'disconnected' })
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()
  })
})

describe('SettingsPanel chrome seats', () => {
  it('names the page via aria-labelledby pointing at the header seat node', () => {
    mount()
    openPanel()
    const dialog = screen.getByRole('region')
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(titleId).toBeTruthy()
    const title = document.getElementById(titleId)!
    expect(title.textContent).toBe('Settings Title')
    expect(screen.getByRole('region', { name: 'Settings Title' })).toBeTruthy()
  })

  it('renders contributed header actions', () => {
    const { renderSlot } = mount()
    openPanel()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {})
  })
})

describe('SettingsPanel close paths', () => {
  it('leaves Settings through application navigation and restores trigger focus', async () => {
    const { navigation } = mount()
    const trigger = openPanel()
    act(() => { navigation.openConversation() })
    expect(screen.queryByRole('region')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('keeps the Settings page open on Escape and has no modal layer', () => {
    mount()
    openPanel()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('region', { name: 'Settings Title' })).toBeTruthy()
  })

  it('focuses the page content on entry', () => {
    mount()
    openPanel()
    expect(document.activeElement?.contains(screen.getByTestId('section-general'))).toBe(true)
  })

})

describe('SettingsPanel navigation', () => {
  it('retains the selected section when returning to Settings', () => {
    const { navigation } = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    act(() => { navigation.openConversation() })
    openPanel()
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('section-models')).toBeTruthy()
  })
  it('projects rows, marks the first active, and renders only that section', () => {
    mount()
    openPanel()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('gives every section a nav glyph, distinct for the ids the shell knows', () => {
    mount({
      rows: [
        { id: 'general', order: 0, label: 'General' },
        { id: 'models', order: 10, label: 'Models' },
        { id: 'agent-presets', order: 20, label: 'Agent presets' },
        { id: 'plugins', order: 30, label: 'Plugins' },
        { id: 'contributed', order: 40, label: 'Contributed' },
      ],
    })
    openPanel()
    // Glyphs carry no id of their own, so the drawn paths are what tells them apart.
    const glyphs = ['General', 'Models', 'Agent presets', 'Plugins', 'Contributed']
      .map(name => screen.getByRole('button', { name }).querySelector('svg')?.innerHTML)

    expect(glyphs.every(glyph => glyph !== undefined && glyph !== '')).toBe(true)
    // The three ids the shell names get their own glyph; every other section —
    // including one this package never heard of — shares the gear.
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4)
    expect(glyphs[4]).toBe(glyphs[0])
  })

  it('groups settings by task and uses the icon supplied by each registrant', () => {
    mount({ rows: [
      { id: 'general', order: 0, label: 'General' },
      { id: 'enterprise', order: 5, label: 'Account', icon: () => <svg data-testid="account-glyph" /> },
      { id: 'enterprise-models', order: 10, label: 'Models' },
      { id: 'enterprise-directory', order: 15, label: 'Directory' },
      { id: 'enterprise-billing', order: 16, label: 'Billing' },
      { id: 'agent-presets', order: 20, label: 'Agent presets' },
      { id: 'plugins', order: 30, label: 'Plugins' },
    ] })
    openPanel()
    const labels = (name: string) => within(screen.getByRole('group', { name })).getAllByRole('button').map(button => button.textContent)
    expect(labels('Preferences')).toEqual(['General', 'Models', 'Agent presets'])
    expect(labels('Organization & account')).toEqual(['Account', 'Directory', 'Billing'])
    expect(labels('Extensions')).toEqual(['Plugins'])
    expect(within(screen.getByRole('button', { name: 'Account' })).getByTestId('account-glyph')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByTestId('section-enterprise')).toBeTruthy()
  })

  it('switches the rendered section on nav click', () => {
    mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(screen.queryByTestId('section-general')).toBeNull()
  })

  it('mounts onboarding steps in order and transfers ownership only on completion', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    expect(first?.[2]).toEqual({ only: 'welcome' })
    act(() => {
      (first?.[1] as { complete: () => void }).complete()
      ;(first?.[1] as { complete: () => void }).complete()
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    const second = onboardingCalls.at(-1)
    expect(second?.[1]).toMatchObject({ stepId: 'credential' })
    expect(second?.[2]).toEqual({ only: 'credential' })

    act(() => {
      (second?.[1] as { openSection: (id: string) => void }).openSection('models')
    })
    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.getByTestId('section-models')).toBeTruthy()

    cleanup()
    const inactive = mount({ onboardingActive: false }).renderSlot.mock.calls
      .filter(call => call[0] === 'settings.onboarding')
    expect(inactive).toHaveLength(0)
  })

  it('paints no takeover chrome of its own around the mounted step', () => {
    // The chrome (mask, opaque stage, #root inert) belongs to the step via
    // the step-owned dialog surface — a mounted-but-deciding step that
    // renders null must show and block nothing (the reload white-flash fix;
    // onboarding-surface.spec.tsx pins the primitive's half).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const { view } = mount()
    expect(view.container.querySelector('[class*="onboarding"]')).toBeNull()
    expect(document.body.querySelector('[class*="onboarding"]')).toBeNull()
    expect(appRoot.inert).not.toBe(true)
    view.unmount()
    appRoot.remove()
  })

  it('falls back to the first row when the active entry unregisters', () => {
    const { bump } = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    bump([{ id: 'general', order: 0, label: 'General' }])
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('renders an empty content column when the ledger is empty', () => {
    const { renderSlot } = mount({ rows: [] })
    openPanel()
    expect(screen.getByRole('region')).toBeTruthy()
    const sectionCalls = renderSlot.mock.calls.filter(c => c[0] === 'settings.section')
    expect(sectionCalls).toHaveLength(0)
  })

  it('drops the ledger subscription on unmount', () => {
    const { view, listeners } = mount()
    openPanel()
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})
