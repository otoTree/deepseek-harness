/** Credentialed API requests never accept a user-provided upstream model address. */
import { z } from 'zod'
import { zh as t } from './messages'

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
 * @param configured - API URL supplied by the Admin server at request time.
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
  const configured = z.url({ protocol: /^https?$/ }).parse(document.querySelector<HTMLMetaElement>('meta[name="enterprise-api-url"]')?.content)
  return resolveApiBase(configured.replace(/\/$/, ''), window.location.hostname)
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
    if (parsed.success && (parsed.data.error ?? parsed.data.message)) throw new ApiRequestError(parsed.data.error ?? parsed.data.message!,
      response.status)
    throw new ApiRequestError(`${t.error} (${response.status})`, response.status)
  }
  return response.json()
}

/** Upload a binary package to an enterprise API endpoint with the current session. */
export async function requestBinary(path: string, body: ArrayBuffer): Promise<unknown> {
  const response = await fetch(apiBase() + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/zip' },
    body,
  })
  if (!response.ok) {
    const parsed = errorResponse.safeParse(await response.json().catch(() => null))
    throw new ApiRequestError(parsed.success ? parsed.data.error ?? parsed.data.message ?? `${t.error} (${response.status})` : `${t.error} (${response.status})`, response.status)
  }
  return response.json()
}

/** Publish a verified ZIP through the platform administrator's digest-checked approval. */
export async function publishPlatformPlugin(body: ArrayBuffer): Promise<{ id: string; pluginId: string; version: string }> {
  const uploaded = z.object({ id: z.uuid(), pluginId: z.string(), version: z.string(), digest: z.string().length(64) })
    .parse(await requestBinary('/v1/platform/plugins/packages', body))
  const approval = z.object({ id: z.uuid(), status: z.literal('published'), digest: z.string().length(64) })
    .parse(await request(`/v1/platform/plugins/${uploaded.id}/approve`, 'POST', { digest: uploaded.digest }))
  if (approval.id !== uploaded.id || approval.digest !== uploaded.digest) throw new Error('Published plugin release does not match the uploaded package')
  return { id: uploaded.id, pluginId: uploaded.pluginId, version: uploaded.version }
}

/** Upload a signed installer and publish only after server-side byte verification.
 * @param envelope - Offline-signed release JSON selected by the administrator.
 * @param installer - Installer file streamed by the browser without an ArrayBuffer copy.
 * @param signal - Cancellation for the upload.
 * @returns Published version and platform; API failures throw a status-preserving error.
 */
export async function publishDesktopRelease(
  envelope: string, installer: File, signal: AbortSignal,
): Promise<{ version: string; target: string }> {
  const prepared = z.object({ id: z.uuid(), size: z.number().int().positive() })
    .parse(await request('/v1/platform/desktop-releases', 'POST', { envelope }))
  signal.throwIfAborted()
  if (prepared.size !== installer.size) throw new Error(t.desktopInstallerSizeMismatch)
  const response = await fetch(`${apiBase()}/v1/platform/desktop-releases/${prepared.id}/installer`, {
    method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' },
    body: installer, signal,
  })
  if (!response.ok) {
    const parsed = errorResponse.safeParse(await response.json().catch(() => null))
    throw new ApiRequestError(parsed.success ? parsed.data.error ?? parsed.data.message ?? `${t.error} (${response.status})` : `${t.error} (${response.status})`, response.status)
  }
  return z.object({ version: z.string(), target: z.string(), published: z.literal(true) }).parse(await response.json())
}
