import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the official sidebar name.
 * @param props - localized official-brand copy.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ t }: PropsLocale<'brand.official'>) {
  return <span>{t('name')}</span>
}
