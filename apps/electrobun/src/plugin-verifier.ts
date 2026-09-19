/** Verify an enterprise plugin release before every install, activation, or tool dispatch. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parsePluginPackage, type ParsedPluginPackage } from '@deepseek-ai/dsh-enterprise-api/plugin-package'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'

export const PluginRelease = z.object({
  organizationId: z.uuid(), pluginId: z.string().min(1), version: z.string().min(1),
  digest: z.string().length(64), manifestDigest: z.string().length(64), permissionsDigest: z.string().length(64),
  manifest: z.unknown(), artifact: z.string().min(1),
  status: z.literal('published'), policyRevision: z.number().int().positive(),
}).strict()
export type PluginRelease = z.infer<typeof PluginRelease>

const PluginPackageRelease = z.object({
  organizationId: z.uuid(), pluginId: z.string().min(1), version: z.string().min(1),
  digest: z.string().length(64), manifestDigest: z.string().length(64), permissionsDigest: z.string().length(64),
  status: z.literal('published'), revokedAt: z.null().optional(),
}).strict()
export type PluginPackageRelease = z.infer<typeof PluginPackageRelease>

/** Verify a downloaded standard package against its published release metadata. */
export function verifyPluginPackage(
  bytes: Uint8Array,
  input: unknown,
  organizationId: string,
): ParsedPluginPackage {
  const release = PluginPackageRelease.parse(input)
  if (release.organizationId !== organizationId) throw new Error('Plugin release belongs to another organization')
  const parsed = parsePluginPackage(bytes)
  if (parsed.packageDigest !== release.digest
    || parsed.manifestDigest !== release.manifestDigest
    || parsed.permissionsDigest !== release.permissionsDigest
    || parsed.manifest.pluginId !== release.pluginId
    || parsed.manifest.version !== release.version) {
    throw new Error('Plugin package digest does not match its published release metadata')
  }
  return parsed
}

/** Reject a release unless its content digests, tenant, approval and artifact fields match. */
export function verifyPluginRelease(input: unknown, organizationId: string): PluginRelease {
  const release = PluginRelease.parse(input)
  if (release.organizationId !== organizationId) throw new Error('Plugin release belongs to another organization')
  const manifestDigest = sha(release.manifest)
  const rawManifest = release.manifest as { targets?: unknown } | null
  const manifest = rawManifest?.targets === undefined ? undefined : z.object({
    targets: z.array(z.union([
      z.object({ kind: z.enum(['client', 'host']), entry: z.string().min(1).optional() }).loose(),
      z.enum(['browser', 'desktop']),
    ])).min(1),
  }).loose().safeParse(release.manifest)
  if (manifest !== undefined && (!manifest.success || manifest.data.targets.some(target => typeof target === 'string' ? false : target.entry !== undefined && !target.entry.startsWith(`${target.kind}/`)))) {
    throw new Error('Plugin release must declare only client or host targets')
  }
  const permissions = (release.manifest as { permissions?: unknown } | null)?.permissions
  const permissionsDigest = sha(permissions)
  const artifactDigest = sha(release.artifact)
  if (manifestDigest !== release.manifestDigest || permissionsDigest !== release.permissionsDigest || artifactDigest !== release.digest) {
    throw new Error('Plugin release digest does not match its published content')
  }
  return release
}

function sha(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }
