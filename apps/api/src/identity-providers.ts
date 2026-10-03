/** Protocol-neutral identity and directory provider contracts. */
import { z } from 'zod'

export const normalizedIdentity = z.object({
  externalTenantId: z.string().min(1),
  externalId: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
  active: z.boolean(),
  groups: z.array(z.string()),
  organizationPath: z.array(z.string()),
  externalRoles: z.array(z.string()),
  source: z.enum(['oidc', 'oauth2', 'saml', 'ldap']),
  syncVersion: z.string().min(1),
}).strict()

export type NormalizedIdentity = z.infer<typeof normalizedIdentity>
export type ProviderClaims = Record<string, unknown>

export interface IdentityProviderAdapter {
  readonly protocol: NormalizedIdentity['source']
  normalize(claims: ProviderClaims, context: { tenantId: string; syncVersion: string }): NormalizedIdentity
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  return text(value).split(/[ ,]/u).map(item => item.trim()).filter(Boolean)
}

function normalize(protocol: NormalizedIdentity['source'], claims: ProviderClaims, context: { tenantId: string; syncVersion: string }): NormalizedIdentity {
  const email = text(claims.email ?? claims.mail).toLowerCase()
  if (!email) throw new Error(`${protocol} identity is missing an email claim`)
  return normalizedIdentity.parse({
    externalTenantId: text(claims.tenant_id ?? claims.tenant ?? claims.iss, context.tenantId),
    externalId: text(claims.sub ?? claims.uid ?? claims.objectId ?? claims.nameID, email),
    email,
    name: text(claims.name ?? claims.displayName ?? claims.cn, email),
    active: claims.active !== false && claims.disabled !== true && claims.status !== 'suspended',
    groups: list(claims.groups ?? claims.group),
    organizationPath: list(claims.organizationPath ?? claims.departmentPath ?? claims.department),
    externalRoles: list(claims.roles ?? claims.role),
    source: protocol,
    syncVersion: context.syncVersion,
  })
}

/** OIDC discovery/userinfo claims mapper. */
export const oidcProvider: IdentityProviderAdapter = { protocol: 'oidc', normalize: (claims, context) => normalize('oidc', claims, context) }
/** OAuth2 userinfo claims mapper. */
export const oauth2Provider: IdentityProviderAdapter = { protocol: 'oauth2', normalize: (claims, context) => normalize('oauth2', claims, context) }
/** SAML assertion attributes mapper. */
export const samlProvider: IdentityProviderAdapter = { protocol: 'saml', normalize: (claims, context) => normalize('saml', claims, context) }
/** LDAP/Active Directory entry mapper. */
export const ldapProvider: IdentityProviderAdapter = { protocol: 'ldap', normalize: (claims, context) => normalize('ldap', claims, context) }

export const identityProviderRegistry: ReadonlyMap<NormalizedIdentity['source'], IdentityProviderAdapter> = new Map([
  ['oidc', oidcProvider],
  ['oauth2', oauth2Provider],
  ['saml', samlProvider],
  ['ldap', ldapProvider],
])

/** Normalize claims using the registered adapter. */
export function normalizeIdentity(protocol: NormalizedIdentity['source'], claims: ProviderClaims, context: { tenantId: string; syncVersion: string }): NormalizedIdentity {
  const adapter = identityProviderRegistry.get(protocol)
  if (!adapter) throw new Error(`Unsupported identity protocol: ${protocol}`)
  return adapter.normalize(claims, context)
}
