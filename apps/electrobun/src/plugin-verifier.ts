/** Verify an enterprise plugin release before every install, activation, or tool dispatch. */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'

export const PluginRelease = z.object({
  organizationId: z.uuid(), pluginId: z.string().min(1), version: z.string().min(1),
  digest: z.string().length(64), manifestDigest: z.string().length(64), permissionsDigest: z.string().length(64),
  manifest: z.unknown(), artifact: z.string().min(1), signature: z.string().min(1),
  status: z.literal('published'), policyRevision: z.number().int().positive(),
}).strict()
export type PluginRelease = z.infer<typeof PluginRelease>

/** Reject a release unless all signed bytes, tenant, approval and artifact fields match. */
export function verifyPluginRelease(input: unknown, organizationId: string, publicKey: string): PluginRelease {
  const release = PluginRelease.parse(input)
  if (release.organizationId !== organizationId) throw new Error('Plugin release belongs to another organization')
  const manifestDigest = sha(release.manifest)
  const permissions = (release.manifest as { permissions?: unknown } | null)?.permissions
  const permissionsDigest = sha(permissions)
  const artifactDigest = sha(release.artifact)
  if (manifestDigest !== release.manifestDigest || permissionsDigest !== release.permissionsDigest || artifactDigest !== release.digest) {
    throw new Error('Plugin release digest does not match its signed content')
  }
  const payload = canonicalJson({ organizationId: release.organizationId, pluginId: release.pluginId, version: release.version,
    digest: release.digest, manifestDigest: release.manifestDigest, permissionsDigest: release.permissionsDigest })
  const key = createPublicKey(publicKey)
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(payload), key, Buffer.from(release.signature, 'base64url'))) {
    throw new Error('Plugin release signature is invalid')
  }
  return release
}

function sha(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }
