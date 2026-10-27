/** Non-secret Arivo Identity configuration, embedded by the Arivo builder only. */
import { z } from 'zod'

const origin = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return value === url.origin && !url.username && !url.password
      && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))
  } catch { return false }
}, 'Arivo origins must use HTTPS or explicit HTTP IPv4 loopback without a path')

/** Version-one first-party Host settings; tokens never belong in profile configuration. */
export const arivoIdentitySettings = z.object({
  apiOrigin: origin, webOrigin: origin,
  requestTimeoutMs: z.number().int().min(1000).max(60000),
  loginTimeoutMs: z.number().int().min(1000).max(300000),
}).strict()

/** Decode builder-pinned account settings; absence identifies an unconfigured legacy artifact.
 * @param value - JSON embedded by the Arivo build, or absence in a legacy artifact.
 * @returns Validated origins and limits, or undefined when a legacy artifact omitted account access.
 */
export function readArivoIdentitySettings(value: string | undefined): z.infer<typeof arivoIdentitySettings> | undefined {
  return value === undefined || value === '' ? undefined : arivoIdentitySettings.parse(JSON.parse(value) as unknown)
}
