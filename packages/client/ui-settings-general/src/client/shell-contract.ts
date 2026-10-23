/**
 * Settings shell contract — the types of the sidebar trigger and main page this
 * package renders. They live here rather than in ui-settings because they
 * reference the sidebar's own slot type: ui-settings is the settings domain's
 * base layer and must not depend on any `ui-*` presentation package, or the
 * reference graph closes a cycle through ui-sidebar → ui-layout → ui-theme.
 * The settings SLOT types (what registrants contribute) stay in ui-settings.
 */
import type { MainSurface } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createSettingsViewStore } from './settings-view-store.ts'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SlotIcon, HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
  icon?: SlotIcon
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): connection state and ledger projections arrive as hook-compartment
 * sources, while the reconnect command remains a plain callback.
 */
export type SettingsRootInjected = {
  /** Request a fresh logical generation and physical WebSocket immediately. */
  reconnect: () => void
  /** Open Settings in the application main column. */
  openSettings: () => void
  /** Return to conversation if Settings is still active. */
  exitSettings: () => void
  hooks: {
    /** Current application surface. */
    surface: HostObservable<MainSurface>
    /** Connection-owned state for the current Host connection. */
    connectionState: HostObservable<ConnectionState | undefined>
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (wide/rail state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections). The declared store shares section selection with onboarding links.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<'settings.trigger' | 'settings.onboarding'>
  & PropsStore<ReturnType<typeof createSettingsViewStore>>
  & InjectFace<SettingsRootInjected>
  & PropsLocale<'settings'>

/** Main-page props derived from the frame slot, shared selection, and section ledger. */
export type SettingsPageProps =
  PropsRuntime<'main.surface'>
  & PropsRenderSlots<'settings.header' | 'settings.action' | 'settings.section'>
  & PropsStore<ReturnType<typeof createSettingsViewStore>>
  & InjectFace<SettingsRootInjected>
  & PropsLocale<'settings'>
