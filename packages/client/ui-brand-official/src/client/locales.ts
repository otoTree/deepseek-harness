/** Official-brand dictionary namespace. */
export const NS = 'brand.official'

/** Simplified Chinese dictionary. */
export const zh = {
  name: 'AgentOS',
} satisfies Record<string, string>

/** Official-brand dictionary key union. */
export type OfficialBrandKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  name: 'AgentOS',
} satisfies Record<OfficialBrandKey, string>
