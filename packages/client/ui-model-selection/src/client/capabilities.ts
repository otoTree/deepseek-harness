/** Locale-owned display text for provider-native model input capabilities. */

import type { ModelCatalogModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Describe only provider-native inputs; tool-based attachment analysis remains a separate runtime capability.
 * @param model - catalog entry whose exact-route capabilities were resolved by the Host.
 * @param t - model namespace translator.
 * @returns concise localized capability text.
 */
export function nativeCapabilitiesText(model: ModelCatalogModel, t: TranslateNS<'model'>): string {
  if (model.inputModalities === undefined) return t('capability.unknown')
  const labels = model.inputModalities.map((modality): string => {
    switch (modality) {
      case 'text': return t('capability.text')
      case 'image': return t('capability.image')
      case 'video': return t(model.videoAudioMode === 'visual-and-audio'
        ? 'capability.videoWithAudio'
        : 'capability.videoVisualOnly')
      case 'audio': return t('capability.audio')
      case 'document': return t('capability.document')
      // ModelModalityMap is merge-extensible; an extension may be newer than this UI package.
      default: return t('capability.unknown')
    }
  })
  return t('capability.nativeInputs', { inputs: labels.join(t('capability.separator')) })
}
