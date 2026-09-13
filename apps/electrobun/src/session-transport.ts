/** Authenticated native session transport. Credentials never cross into the WebView or plugin input. */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { desktopCredential } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { deploymentUrl } from './desktop-auth.ts'

export const SessionTransportConfig = z.object({
  apiUrl: z.string().transform(value => deploymentUrl(value).origin),
  keychainHelper: z.string().refine(isAbsolute), keychainAccount: z.string().min(1),
  requestTimeoutMs: z.number().int().min(1).max(600000),
  maxResponseBytes: z.number().int().min(1024).max(16777216),
}).strict()
export type SessionTransportSettings = z.infer<typeof SessionTransportConfig>
export interface SessionTransportIO {
  readCredential: () => Promise<string | undefined>
  request: (url: URL, init: RequestInit) => Promise<Response>
}

/** A remote status with no response body, credential or upstream diagnostic attached. */
export class SessionTransportError extends Error {
  constructor(readonly status: number) { super(`Enterprise session request refused (${status})`) }
}

/** Deployment-bound JSON transport with deadlines, response limits and no automatic replay. */
export class SessionTransport {
  private readonly settings: SessionTransportSettings
  constructor(settings: SessionTransportSettings, private readonly io: SessionTransportIO) {
    this.settings = SessionTransportConfig.parse(settings)
  }

  /** Send one authenticated request; callers own any recovery after an uncertain mutation.
   * @param path - Session-relative path assembled by the native provider.
   * @param method - HTTP operation.
   * @param body - Validated request fields, if present.
   * @param cancellation - Optional caller cancellation.
   * @returns A bounded, decoded JSON response.
   */
  async request(path: string, method = 'GET', body?: unknown, cancellation?: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.timeout(this.settings.requestTimeoutMs)
    const signal = cancellation ? AbortSignal.any([deadline, cancellation]) : deadline
    signal.throwIfAborted()
    try {
      const credential = desktopCredential.extend({ apiOrigin: z.string() }).parse(JSON.parse(await this.io.readCredential() ?? 'null'))
      const account = createHash('sha256').update(this.settings.apiUrl).digest('hex') + ':' + credential.organizationId + ':' + credential.runtimeId
      if (account !== this.settings.keychainAccount || credential.apiOrigin !== this.settings.apiUrl) throw new SessionTransportError(401)
      signal.throwIfAborted()
      const response = await this.io.request(new URL(`/v1/organizations/${credential.organizationId}/sessions${path}`, this.settings.apiUrl), {
        method, signal, redirect: 'error', headers: { Authorization: 'Bearer ' + credential.token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok) { await response.body?.cancel(); throw new SessionTransportError(response.status) }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Missing response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) break
          size += item.value.length
          if (size > this.settings.maxResponseBytes) throw new Error('Response exceeds limit')
          chunks.push(item.value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch (error) {
      if (error instanceof SessionTransportError) throw error
      throw new Error(signal.aborted ? 'Enterprise session request cancelled or timed out' : 'Enterprise session transport failed')
    }
  }
}
