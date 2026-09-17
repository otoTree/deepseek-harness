import type { ModelCatalogModel } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime/src/translate.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'
import { nativeCapabilitiesText } from '../src/client/capabilities.ts'
import { zh } from '../src/client/locales.ts'

const t: TranslateNS<'model'> = makeTranslate(zh)

function model(overrides: Partial<ModelCatalogModel>): ModelCatalogModel {
  return { id: 'model', name: 'Model', ...overrides }
}

describe('nativeCapabilitiesText', () => {
  it('distinguishes frame-only video from video with embedded-audio understanding', () => {
    expect(nativeCapabilitiesText(model({
      inputModalities: ['text', 'video'],
      videoAudioMode: 'visual-only',
    }), t)).toBe('原生输入：文本、视频（仅画面）')
    expect(nativeCapabilitiesText(model({
      inputModalities: ['text', 'video'],
      videoAudioMode: 'visual-and-audio',
    }), t)).toBe('原生输入：文本、视频（含音轨理解）')
  })

  it('keeps standalone audio input distinct from a video audio track', () => {
    expect(nativeCapabilitiesText(model({ inputModalities: ['audio'] }), t))
      .toBe('原生输入：音频')
  })
})
