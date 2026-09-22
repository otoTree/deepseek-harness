/** Shared enterprise plugin manifest, lifecycle, and SDK contracts. */
import { z } from 'zod'
export * from './types.ts'

const pluginPermissions = [
  'identity.read', 'models.text', 'objects.read', 'objects.write',
  'database.query', 'database.transaction', 'cache.read', 'cache.write',
] as const

/** Runtime parser for package manifests accepted by the plugin SDK. */
export const pluginManifest = z.object({
  schemaVersion: z.literal(1),
  pluginId: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
  targets: z.array(z.object({
    kind: z.enum(['client', 'host']),
    entry: z.string().regex(/^(?:client|host)\/[A-Za-z0-9._/-]+\.js$/),
    compatibility: z.string().trim().min(1).max(120),
    contributions: z.array(z.string().trim().min(1).max(160)).default([]),
  }).strict()).min(1).max(2),
  permissions: z.array(z.enum(pluginPermissions)).max(pluginPermissions.length).default([]),
  resources: z.array(z.object({
    kind: z.enum(['objects', 'database', 'cache']),
    quotaBytes: z.number().int().positive().optional(),
  }).strict()).max(3).default([]),
  sdk: z.object({ minVersion: z.string().min(1), maxVersion: z.string().min(1).optional() }).strict().optional(),
  migrations: z.array(z.object({
    version: z.number().int().positive(),
    statements: z.array(z.string().min(1)).min(1),
  }).strict()).default([]),
  contributions: z.union([z.array(z.string()), z.record(z.string(), z.json())]).default([]),
  dependencies: z.record(z.string(), z.string()).default({}),
  build: z.object({ runtime: z.string().min(1), lockfileDigest: z.string().length(64) }).strict(),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.permissions).size !== manifest.permissions.length) {
    ctx.addIssue({ code: 'custom', path: ['permissions'], message: 'manifest declares a permission more than once' })
  }
  const resources = new Set(manifest.resources.map(resource => resource.kind))
  if (resources.size !== manifest.resources.length) ctx.addIssue({ code: 'custom', path: ['resources'], message: 'manifest declares a resource more than once' })
  const versions = manifest.migrations.map(migration => migration.version)
  if (versions.some((version, index) => {
    const previous = versions[index - 1]
    return previous !== undefined && version <= previous
  })) {
    ctx.addIssue({ code: 'custom', path: ['migrations'], message: 'manifest migration versions must increase strictly' })
  }
})
