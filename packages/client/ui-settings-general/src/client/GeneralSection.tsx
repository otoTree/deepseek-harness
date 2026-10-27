/** The General section: one column rendering feature-owned item contributions. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'> & PropsLocale<'settings'>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot, t }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      <header className={css.heading}>
        <h1>{t('general.nav')}</h1>
        <p>{t('general.description')}</p>
      </header>
      <div className={css.items}>{renderSlot('settings.general.item', {})}</div>
    </div>
  )
}
