import { z } from 'zod'

/** Input accepted by the native notification request. */
export const nativeNotification = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000),
}).strict()

/** Input accepted by the external-link request. */
export const nativeExternalLink = z.object({ url: z.url() }).strict()

/** Validate a native link without allowing custom schemes or credentials. */
export function validateNativeExternalUrl(value: unknown): string {
  const input = nativeExternalLink.parse(value)
  const url = new URL(input.url)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('Only credential-free HTTP(S) links may be opened')
  }
  return url.toString()
}

/** Window capabilities used to keep the remote authentication page untrusted. */
export function windowCapabilities(trustedLocal: boolean): { sandbox: boolean; exposeNativeRpc: boolean } {
  return { sandbox: !trustedLocal, exposeNativeRpc: trustedLocal }
}
