/** Request-driven renewal of revocable desktop login sessions. */
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Transaction } from './database.ts'
import { runtimes } from './schema.ts'
import { forbidden } from './security.ts'

/** Refresh an active login during the second half of its inactivity lifetime.
 * @param tx - Authorized tenant transaction.
 * @param session - Login record resolved from the bearer token.
 * @param lifetimeSeconds - Deployment-configured inactivity lifetime.
 * @returns Completion after any required renewal, refusing concurrent revocation or expiry.
 */
export async function refreshLoginSession(
  tx: Transaction, session: Pick<typeof runtimes.$inferSelect, 'id' | 'expiresAt'>, lifetimeSeconds: number,
): Promise<void> {
  const now = new Date()
  if (session.expiresAt.getTime() - now.getTime() > lifetimeSeconds * 500) return
  const updated = await tx.update(runtimes).set({ expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000) })
    .where(and(eq(runtimes.id, session.id), isNull(runtimes.revokedAt), gt(runtimes.expiresAt, now)))
    .returning({ id: runtimes.id })
  if (updated.length === 0) forbidden()
}
