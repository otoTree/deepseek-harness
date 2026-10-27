/** Theme choices with miniature workspace previews and persisted selection. */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Theme preference choices, independent of the currently resolved palette. */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  return (
    <div className={css.group}>
      <div className={css.heading}>
        <div><div className={css.title}>{t('appearance.title')}</div><p className={css.description}>{t('appearance.description')}</p></div>
        <span className={css.scope}>{t('appearance.scope')}</span>
      </div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <span className={clsx(css.preview, css[id])} aria-hidden="true">
              <span className={css.previewSidebar}><i /><i /><i /></span>
              <span className={css.previewContent}><i /><i /><i /></span>
            </span>
            <span className={css.caption}><span><Icon />{t(labelKey)}</span><span className={css.radio} aria-hidden="true" /></span>
          </button>
        ))}
      </div>
    </div>
  )
}
