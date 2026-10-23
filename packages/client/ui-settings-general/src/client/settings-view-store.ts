/** Shared section selection for the Settings page and onboarding links. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type SettingsView = { activeId: string | undefined }
type SettingsViewActions = { select: (draft: SettingsView, id: string) => void }

/**
 * Create the Settings navigation store for one plugin instance.
 * @returns A handle shared by the sidebar trigger and the main page.
 */
export function createSettingsViewStore(): EngineStoreHandle<SettingsView, SettingsViewActions> {
  return defineStore({
    init: (): SettingsView => ({ activeId: undefined }),
    actions: { select: (draft, id: string) => { draft.activeId = id } },
  })
}
