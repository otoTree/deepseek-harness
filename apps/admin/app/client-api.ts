/** Credentialed API requests never accept a user-provided upstream model address. */
import { z } from 'zod'
import { zh as t } from './messages'

const configuredApiBase = z.url().parse(process.env.NEXT_PUBLIC_ENTERPRISE_API_URL ?? 'http://127.0.0.1:8787')
const errorResponse = z.object({ code: z.string().optional() }).passthrough()

const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1'
}

/** Keep local admin and API cookies on the same host when the browser uses a loopback alias.
 * @param configured - API URL embedded by the Next.js build.
 * @param browserHostname - hostname serving the current browser page.
 * @returns API URL with matching loopback hostname when both endpoints are local.
 */
export function resolveApiBase(configured: string, browserHostname?: string): string {
  if (!browserHostname || !isLoopback(browserHostname)) return configured
  const target = new URL(configured)
  if (!isLoopback(target.hostname) || target.hostname.toLowerCase() === browserHostname.toLowerCase()) return configured
  target.hostname = browserHostname
  return target.origin
}

function apiBase(): string {
  return resolveApiBase(configuredApiBase, typeof window === 'undefined' ? undefined : window.location.hostname)
}

/**
 * Send an enterprise request; callers validate the returned JSON for their view.
 * @param path - API-relative resource path.
 * @param method - HTTP operation.
 * @param body - JSON request payload.
 * @returns Parsed response data, or a status-only error without credential-bearing bodies.
 */
export async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(apiBase() + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const parsed = errorResponse.safeParse(await response.json().catch(() => null))
    if (parsed.success && parsed.data.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      throw new Error(t.accountExists)
    }
    throw new Error(`${t.error} (${response.status})`)
  }
  return response.json()
}
