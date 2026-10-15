/** Requests shared by the bundled account page and its native host. */
import { z } from 'zod'
import { organizationId } from '@deepseek-ai/dsh-enterprise-api/contracts'

/** Allow-listed account operations; no API URL or credential can be supplied by the page. */
export const accountAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), email: z.email(), password: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('sso'), provider: z.string().regex(/^dsh-[A-Za-z0-9_-]+$/u) }).strict(),
  z.object({ action: z.literal('register'), name: z.string().trim().min(1).max(120), email: z.email(), password: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal('join'), token: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal('enter'), organizationId }).strict(),
  z.object({ action: z.literal('logout') }).strict(),
])

/** Display identity only; API cookies and Runtime tokens remain native. */
export const accountState = z.object({
  user: z.object({ email: z.email() }).nullable(),
  organizations: z.array(z.object({ id: organizationId, name: z.string() })),
  ssoProviders: z.array(z.object({ id: z.string(), name: z.string(), protocol: z.enum(['oidc', 'oauth2']) })).default([]),
})

/** Validated command accepted by the native account host. */
export type AccountAction = z.infer<typeof accountAction>
