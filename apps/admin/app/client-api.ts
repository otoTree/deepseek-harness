/** Credentialed API requests never accept a user-provided upstream model address. */
import { z } from 'zod'
import { zh as t } from './messages'

const apiBase = z.url().parse(process.env.NEXT_PUBLIC_ENTERPRISE_API_URL ?? 'http://127.0.0.1:8787')
const errorResponse = z.object({ code: z.string().optional() }).passthrough()

/**
 * Send an enterprise request; callers validate the returned JSON for their view.
 * @param path - API-relative resource path.
 * @param method - HTTP operation.
 * @param body - JSON request payload.
 * @returns Parsed response data, or a status-only error without credential-bearing bodies.
 */
export async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(apiBase + path, {
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
