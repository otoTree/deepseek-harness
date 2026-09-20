import type { WorkbenchLauncherProps } from './contract/slots.ts'
import css from './WorkbenchLauncher.module.css'

/** Render the small, always-available action that opens the session Workbench. */
export function WorkbenchLauncher({ openDetails, t }: WorkbenchLauncherProps) {
  return (
    <button type="button" className={css.launcher} aria-label={t('open')} onClick={openDetails}>
      <svg className={css.icon} viewBox="0 0 20 20" aria-hidden focusable="false">
        <rect x="2.5" y="3" width="15" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 7h15M7 7v10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  )
}
