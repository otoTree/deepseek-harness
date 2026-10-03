/** Credentialed API requests never accept a user-provided upstream model address. */
import { z } from 'zod'
import { zh as t } from './messages'

const configuredApiBase = z.url().parse(process.env.NEXT_PUBLIC_ENTERPRISE_API_URL ?? 'http://127.0.0.1:8787')
const errorResponse = z.object({
  code: z.string().max(200).optional(),
  error: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(200).optional(),
}).passthrough()

const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1'
}

/** Preserve the HTTP status so the UI can distinguish an expired session from a service failure. */
export class ApiRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
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
      throw new ApiRequestError(t.accountExists, response.status)
    }
    if (parsed.success && parsed.data.code === 'INVALID_EMAIL_OR_PASSWORD') {
      throw new ApiRequestError(t.invalidCredentials, response.status)
    }
    if (parsed.success && (parsed.data.error ?? parsed.data.message)) throw new ApiRequestError(parsed.data.error ?? parsed.data.message!, response.status)
    throw new ApiRequestError(`${t.error} (${response.status})`, response.status)
  }
  return response.json()
}
