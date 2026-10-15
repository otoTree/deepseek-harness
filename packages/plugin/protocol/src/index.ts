/** Shared enterprise plugin manifest, lifecycle, and SDK contracts. */
import { z } from 'zod'
export * from './types.ts'

const pluginPermissions = [
  'identity.read', 'models.text', 'models.media', 'objects.read', 'objects.write',
  'database.query', 'database.transaction', 'cache.read', 'cache.write',
  'network.http', 'credentials.read', 'credentials.write', 'authorization.oauth',
  'authorization.api-key', 'mcp.connect', 'skills.register', 'config.read', 'config.write',
] as const

const contributionId = z.string().trim().regex(/^[a-z][a-z0-9._-]{1,63}$/)
const bounds = z.object({
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(240).max(2160),
}).strict()
const clientContribution = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slot'),
    id: contributionId,
    slot: z.string().trim().min(1).max(160),
    multiplicity: z.enum(['one', 'many']),
  }).strict(),
  z.object({
    kind: z.literal('window'),
    id: contributionId,
    surface: z.string().trim().min(1).max(120),
    multiplicity: z.enum(['many', 'singleton']),
    titleKey: z.string().trim().min(1).max(160),
    shell: z.enum(['standard', 'minimal']),
    defaultBounds: bounds.optional(),
  }).strict(),
])

const targetFields = {
  compatibility: z.string().trim().min(1).max(120),
}

const pluginTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('client'),
    entry: z.string().regex(/^(?:client|packages\/[a-z][a-z0-9._-]{1,63}\/client)\/[A-Za-z0-9._/-]+\.js$/),
    moduleId: z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
    contributions: z.array(clientContribution).default([]),
    ...targetFields,
  }).strict(),
  z.object({
    kind: z.literal('host'),
    entry: z.string().regex(/^(?:host|packages\/[a-z][a-z0-9._-]{1,63}\/host)\/[A-Za-z0-9._/-]+\.js$/),
    contributions: z.array(z.string().trim().min(1).max(160)).default([]),
    ...targetFields,
  }).strict(),
])

const cordisPackage = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  name: z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
  dependencies: z.record(z.string(), z.string().trim().min(1).max(200)).default({}),
  targets: z.array(pluginTarget).min(1).max(32),
  presets: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    entry: z.string().regex(/^packages\/[a-z][a-z0-9._-]{1,63}\/presets\/[a-z][a-z0-9-]{1,63}\/agent\.cordis\.yml$/),
  }).strict()).max(32).optional(),
}).strict()

/** Runtime parser for package manifests accepted by the plugin SDK. */
export const pluginManifest = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  pluginId: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
  targets: z.array(pluginTarget).max(32).default([]),
  packages: z.array(cordisPackage).min(1).max(32).optional(),
  permissions: z.array(z.enum(pluginPermissions)).max(pluginPermissions.length).default([]),
  network: z.object({
    allowedHosts: z.array(z.string().trim().min(1).max(253)).min(1).max(64),
    maxResponseBytes: z.number().int().positive().max(32 * 1024 * 1024).optional(),
  }).strict().optional(),
  credentialDescriptors: z.array(z.object({
    name: z.string().trim().regex(/^[a-z][a-z0-9._-]{1,63}$/),
    label: z.string().trim().min(1).max(120).optional(),
    kind: z.enum(['secret', 'oauth', 'api-key']),
  }).strict()).max(32).optional(),
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
  if (manifest.schemaVersion === 2 && (manifest.targets.length === 0 || manifest.packages !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['targets'], message: 'schema version 2 requires targets and does not accept Cordis packages' })
  }
  if (manifest.schemaVersion === 3 && (manifest.packages === undefined || manifest.targets.length !== 0)) {
    ctx.addIssue({ code: 'custom', path: ['packages'], message: 'schema version 3 requires Cordis packages and does not accept top-level targets' })
  }
  const packageIds = new Set<string>()
  const packageNames = new Set<string>()
  const clientModuleIds = new Set<string>()
  const clientContributionIds = new Set<string>()
  for (const target of manifest.targets) {
    if (target.kind !== 'client') continue
    if (clientModuleIds.has(target.moduleId)) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'manifest declares a Client module id more than once' })
    clientModuleIds.add(target.moduleId)
    for (const contribution of target.contributions) {
      if (clientContributionIds.has(contribution.id)) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'manifest declares a Client contribution id more than once' })
      clientContributionIds.add(contribution.id)
    }
  }
  for (const item of manifest.packages ?? []) {
    if (packageIds.has(item.id)) ctx.addIssue({ code: 'custom', path: ['packages'], message: 'manifest declares a Cordis package id more than once' })
    if (packageNames.has(item.name)) ctx.addIssue({ code: 'custom', path: ['packages'], message: 'manifest declares a Cordis package name more than once' })
    packageIds.add(item.id)
    packageNames.add(item.name)
    for (const preset of item.presets ?? []) {
      if (!preset.entry.startsWith(`packages/${item.id}/presets/${preset.id}/`)) {
        ctx.addIssue({ code: 'custom', path: ['packages'], message: `preset entry must be inside packages/${item.id}/presets/${preset.id}` })
      }
    }
    for (const target of item.targets) {
      if (!target.entry.startsWith(`packages/${item.id}/`)) ctx.addIssue({ code: 'custom', path: ['packages'], message: `target entry must be inside packages/${item.id}` })
      if (target.kind === 'client') {
        if (clientModuleIds.has(target.moduleId)) ctx.addIssue({ code: 'custom', path: ['packages'], message: 'manifest declares a Client module id more than once' })
        clientModuleIds.add(target.moduleId)
        for (const contribution of target.contributions) {
          if (clientContributionIds.has(contribution.id)) ctx.addIssue({ code: 'custom', path: ['packages'], message: 'manifest declares a Client contribution id more than once' })
          clientContributionIds.add(contribution.id)
        }
      }
    }
  }
  if (new Set(manifest.permissions).size !== manifest.permissions.length) {
    ctx.addIssue({ code: 'custom', path: ['permissions'], message: 'manifest declares a permission more than once' })
  }
  const resources = new Set(manifest.resources.map(resource => resource.kind))
  if (resources.size !== manifest.resources.length) ctx.addIssue({ code: 'custom', path: ['resources'], message: 'manifest declares a resource more than once' })
  for (const target of manifest.targets) {
    if (target.kind !== 'client') continue
    const ids = new Set(target.contributions.map(contribution => contribution.id))
    if (ids.size !== target.contributions.length) {
      ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Client target declares a contribution more than once' })
    }
  }
  const versions = manifest.migrations.map(migration => migration.version)
  if (versions.some((version, index) => {
    const previous = versions[index - 1]
    return previous !== undefined && version <= previous
  })) {
    ctx.addIssue({ code: 'custom', path: ['migrations'], message: 'manifest migration versions must increase strictly' })
  }
})

/** One target together with its owning Cordis package, if the archive uses schema version 3. */
export interface ResolvedPluginTarget {
  readonly packageId: string | undefined
  readonly packageName: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly presets: readonly { readonly id: string; readonly entry: string }[]
  readonly target: z.infer<typeof pluginTarget>
}

/** Flatten legacy targets and schema-version-3 package targets for runtime consumers.
 * @param manifest - Parsed product release manifest.
 * @returns Targets with their owning package metadata.
 */
export function resolvePluginTargets(manifest: z.infer<typeof pluginManifest>): readonly ResolvedPluginTarget[] {
  if (manifest.schemaVersion === 3) {
    return (manifest.packages ?? []).flatMap(item => item.targets.map(target => ({
      packageId: item.id, packageName: item.name, dependencies: item.dependencies, target,
      presets: item.presets ?? [],
    })))
  }
  return manifest.targets.map(target => ({
    packageId: undefined, packageName: undefined, dependencies: manifest.dependencies, presets: [], target,
  }))
}
