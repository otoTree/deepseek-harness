/** Official-brand dictionary namespace. */
export const NS = 'brand.official'

/** Simplified Chinese dictionary. */
export const zh = {
  name: '智域OS',
} satisfies Record<string, string>

/** Official-brand dictionary key union. */
export type OfficialBrandKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  name: '智域OS',
} satisfies Record<OfficialBrandKey, string>
