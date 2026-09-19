/** One-use in-process authorization for control-plane calls through the native model relay. */
import { randomBytes } from 'node:crypto'
import type { AccountId, OrganizationId, ResourceId } from './contracts.ts'

const headerName = 'X-DSH-Internal-Relay'

/** Runtime identity already verified by the issuing control-plane transaction. */
export interface InternalRelayRuntime {
  readonly id: ResourceId
  readonly organizationId: OrganizationId
  readonly accountId: AccountId
  readonly email: string
}

/** A pending authorization that is consumed by one in-process relay request. */
export interface InternalRelayGrant {
  readonly headers: Readonly<Record<string, string>>
  /** Revoke an authorization that did not reach the relay. */
  revoke(): void
}

/** Issue and consume unforgeable in-process runtime authorizations. */
export interface InternalRelayAuthority {
  /**
   * Issue one authorization for a previously verified runtime.
   * @param runtime - Runtime identity verified in the caller's tenant transaction.
   * @returns One-use request headers and an idempotent revoker.
   */
  issue(runtime: InternalRelayRuntime): InternalRelayGrant
  /**
   * Consume an authorization from request headers.
   * @param headers - Incoming relay headers.
   * @returns Verified runtime identity, or `undefined` for an ordinary external request.
   */
  consume(headers: Headers): InternalRelayRuntime | undefined
}

/** Create an application-local authority whose grants never cross a process boundary. */
export function createInternalRelayAuthority(): InternalRelayAuthority {
  const pending = new Map<string, InternalRelayRuntime>()
  return {
    issue(runtime) {
      const token = randomBytes(32).toString('base64url')
      pending.set(token, runtime)
      return {
        headers: { [headerName]: token },
        revoke: () => { pending.delete(token) },
      }
    },
    consume(headers) {
      const token = headers.get(headerName)
      if (token === null) return undefined
      const runtime = pending.get(token)
      pending.delete(token)
      return runtime
    },
  }
}
