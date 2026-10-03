import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one published plugin. */
export type PluginId = Branded<'PluginId'>
/** Immutable version record identity. */
export type PluginReleaseId = Branded<'PluginReleaseId'>
/** Account or organization installation identity. */
export type PluginInstallationId = Branded<'PluginInstallationId'>
/** Device-scoped activation identity. */
export type PluginActivationId = Branded<'PluginActivationId'>
/** Durable plugin data namespace identity. */
export type PluginDataSpaceId = Branded<'PluginDataSpaceId'>
/** Monotonic permission and revocation revision. */
export type PluginPermissionRevision = Branded<'PluginPermissionRevision'>
/** Stable platform user identity returned to an installed plugin. */
export type PluginUserId = Branded<'PluginUserId'>
/** Stable organization identity in the current plugin context. */
export type PluginOrganizationId = Branded<'PluginOrganizationId'>
/** Stable model catalog identity. */
export type PluginModelId = Branded<'PluginModelId'>

/** Target that executes a plugin contribution. */
export type PluginTargetKind = 'client' | 'host'
/** How a Client contribution is mounted by the platform. */
export type PluginClientContributionKind = 'slot' | 'window'
/** Multiplicity policy for one Client contribution. */
export type PluginClientContributionMultiplicity = 'one' | 'many' | 'singleton'

/** Bounds for a platform-created plugin window. */
export interface PluginWindowBounds {
  readonly width: number
  readonly height: number
}

/** A Client contribution mounted into an existing application slot. */
export interface PluginSlotContribution {
  readonly kind: 'slot'
  readonly id: string
  readonly slot: string
  readonly multiplicity: 'one' | 'many'
}

/** A Client contribution mounted in a platform-created independent window. */
export interface PluginWindowContribution {
  readonly kind: 'window'
  readonly id: string
  readonly surface: string
  readonly multiplicity: 'many' | 'singleton'
  readonly titleKey: string
  readonly shell: 'standard' | 'minimal'
  readonly defaultBounds?: PluginWindowBounds
}

/** Structured Client contribution declared by a plugin target. */
export type PluginClientContribution = PluginSlotContribution | PluginWindowContribution

/** Declarative window definition normalized from a Client contribution. */
export interface ClientWindowDefinition {
  readonly pluginId: string
  readonly contributionId: string
  readonly surface: string
  readonly shell: 'standard' | 'minimal'
  readonly multiplicity: 'singleton' | 'many'
  readonly titleKey: string
  readonly defaultBounds?: PluginWindowBounds
}

/** Ephemeral platform window instance; it is not durable plugin identity. */
export interface ClientWindowInstance {
  readonly windowInstanceId: string
  readonly pluginId: string
  readonly contributionId: string
  readonly ownerWindowId?: string
  readonly connectionId?: string
  readonly state: 'opening' | 'ready' | 'closing' | 'closed'
}
/** Capability permission names understood by the first plugin runtime. */
export type PluginPermission =
  | 'identity.read'
  | 'models.text'
  | 'models.media'
  | 'objects.read'
  | 'objects.write'
  | 'database.query'
  | 'database.transaction'
  | 'cache.read'
  | 'cache.write'
/** Installation owner. */
export type PluginOwner =
  | { readonly kind: 'personal'; readonly accountId: PluginUserId }
  | { readonly kind: 'organization'; readonly organizationId: PluginOrganizationId }

/** Resource requested by a plugin manifest. */
export type PluginResourceDeclaration =
  | { readonly kind: 'objects'; readonly quotaBytes?: number }
  | { readonly kind: 'database'; readonly quotaBytes?: number }
  | { readonly kind: 'cache'; readonly quotaBytes?: number }

interface PluginTargetManifestBase {
  readonly entry: string
  readonly compatibility: string
  readonly contributions: readonly (string | PluginClientContribution)[]
}

/** One executable target in a standard plugin package. */
export type PluginTargetManifest =
  | (PluginTargetManifestBase & {
    readonly kind: 'client'
    /** Client module-table id registered by this target's bundle. */
    readonly moduleId: string
  })
  | (PluginTargetManifestBase & { readonly kind: 'host' })

/** Manifest embedded in a `.dsh-plugin.zip` package. */
export interface PluginManifest {
  readonly schemaVersion: 2
  readonly pluginId: PluginId
  readonly name: string
  readonly version: string
  readonly targets: readonly PluginTargetManifest[]
  readonly permissions: readonly PluginPermission[]
  readonly contributions?: readonly string[] | Readonly<Record<string, unknown>>
  readonly resources: readonly PluginResourceDeclaration[]
  readonly sdk?: { readonly minVersion: string; readonly maxVersion?: string }
  readonly migrations?: readonly { readonly version: number; readonly statements: readonly string[] }[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly build?: { readonly runtime: string; readonly lockfileDigest: string }
}

/** Public profile fields available to plugin code. */
export interface PluginIdentity {
  readonly userId: PluginUserId
  readonly name: string
  readonly avatarUrl: string | null
  readonly email: string
  readonly organizationId: PluginOrganizationId
  readonly owner: PluginOwner
}

/** Text-only model descriptor exposed by the first plugin SDK release. */
export interface PluginModelDescriptor {
  readonly id: PluginModelId
  readonly name: string
  readonly inputModalities: readonly ['text'] | readonly string[]
  readonly maxOutputTokens: number
}

/** One message accepted by the text model facade. */
export interface PluginTextMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** Result and billing information for one model call. */
export interface PluginUsage {
  readonly callId: string
  readonly status: 'settled' | 'pending_reconciliation' | 'cancelled'
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalCostMicrosCny?: number
}

/** Non-streaming text response. */
export interface PluginTextResult {
  readonly text: string
  readonly usage: PluginUsage
}

/** Model operation implemented by the asynchronous platform task API. */
export type PluginModelTaskOperation = 'embedding.create' | 'image.generate' | 'video.generate' | 'audio.synthesize' | 'audio.transcribe'
/** Published operation available to plugin model-task clients. */
export interface PluginModelTaskDescriptor {
  readonly model: string
  readonly operation: PluginModelTaskOperation
  readonly version: number
}
/** Task result exposed to a plugin without Provider response fields. */
export type PluginModelTaskResult =
  | { readonly kind: 'embedding'; readonly index: number; readonly vector: readonly number[] }
  | { readonly kind: 'image' | 'video' | 'audio'; readonly index: number; readonly url: string; readonly mimeType?: string }
  | { readonly kind: 'transcript'; readonly text: string; readonly startSeconds?: number; readonly endSeconds?: number }
/** Client-safe asynchronous task status and billing projection. */
export interface PluginModelTask {
  readonly id: string
  readonly operation: PluginModelTaskOperation
  readonly publicModel: string
  readonly status: 'queued' | 'submitting' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  readonly billingStatus: 'reserved' | 'awaiting_usage' | 'settled' | 'partially_collected' | 'review_required'
  readonly results: readonly PluginModelTaskResult[]
  readonly usage?: { readonly complete: boolean; readonly items: readonly { readonly key: string; readonly unit: string; readonly quantity: string; readonly source: string; readonly final: boolean }[] } | null
  readonly finalMicrosCny?: number | null
  readonly outstandingMicrosCny: number
  readonly nextQueryAt: string
}

/** Object metadata returned by the plugin object store. */
export interface PluginObjectVersion {
  readonly objectId: string
  readonly version: string
  readonly size: number
  readonly contentType: string
  readonly createdAt: string
}

/** Query result from the plugin database. */
export interface PluginDatabaseResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number
}

/** Transport used by Host and Client adapters to provide the SDK. */
export interface PluginCapabilityTransport {
  call<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T>
  stream<T>(operation: string, input: unknown, signal?: AbortSignal): AsyncIterable<T>
}

/** Object storage facade. */
export interface PluginObjects {
  put(input: {
    readonly objectId?: string
    readonly content: Uint8Array
    readonly contentType: string
    readonly idempotencyKey: string
    readonly ifVersion?: string
  }, signal?: AbortSignal): Promise<PluginObjectVersion>
  read(objectId: string, options?: {
    readonly version?: string
    readonly start?: number
    readonly end?: number
  }, signal?: AbortSignal): Promise<Uint8Array>
  listVersions(objectId: string, signal?: AbortSignal): Promise<readonly PluginObjectVersion[]>
  delete(objectId: string, options?: { readonly version?: string }, signal?: AbortSignal): Promise<void>
}

/** Restricted SQL facade. */
export interface PluginDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<PluginDatabaseResult<Row>>
  transaction<T>(
    statements: readonly { readonly sql: string; readonly params?: readonly unknown[] }[],
    signal?: AbortSignal,
  ): Promise<readonly PluginDatabaseResult<T & Record<string, unknown>>[]>
}

/** Disposable cache facade. */
export interface PluginCache {
  get<T = unknown>(key: string, signal?: AbortSignal): Promise<T | undefined>
  set<T = unknown>(
    key: string,
    value: T,
    options?: { readonly ttlSeconds?: number; readonly ifVersion?: string },
    signal?: AbortSignal,
  ): Promise<{ readonly version: string }>
  delete(key: string, signal?: AbortSignal): Promise<void>
  increment(key: string, amount?: number, options?: { readonly ttlSeconds?: number }, signal?: AbortSignal): Promise<number>
}

/** SDK surface injected into one activated plugin target. */
export interface PluginSdk {
  readonly identity: { current(signal?: AbortSignal): Promise<PluginIdentity> }
  readonly models: {
    list(signal?: AbortSignal): Promise<readonly PluginModelDescriptor[]>
    text(input: {
      readonly modelId: PluginModelId
      readonly messages: readonly PluginTextMessage[]
      readonly idempotencyKey: string
    }, signal?: AbortSignal): Promise<PluginTextResult>
    textStream(input: {
      readonly modelId: PluginModelId
      readonly messages: readonly PluginTextMessage[]
      readonly idempotencyKey: string
    }, signal?: AbortSignal): AsyncIterable<{ readonly text: string; readonly done: boolean; readonly usage?: PluginUsage }>
    createTask(input: {
      readonly operation: PluginModelTaskOperation
      readonly model: string
      readonly input: Readonly<Record<string, unknown>>
      readonly parameters?: Readonly<Record<string, unknown>>
      readonly idempotencyKey: string
    }, signal?: AbortSignal): Promise<PluginModelTask>
    queryTask(input: { readonly taskId: string }, signal?: AbortSignal): Promise<PluginModelTask>
    listTasks(signal?: AbortSignal): Promise<readonly PluginModelTaskDescriptor[]>
  }
  readonly objects: PluginObjects
  readonly database: PluginDatabase
  readonly cache: PluginCache
}

/** Lifecycle state observed by a device. */
export type PluginActivationState = 'unknown' | 'not-installed' | 'preparing' | 'active' | 'stopping' | 'disabled' | 'failed' | 'revoked' | 'stale' | 'cleanup-failed'

/** Durable stages for a lifecycle operation. */
export type PluginOperationStage =
  | 'requested' | 'validating' | 'snapshotting' | 'quiescing' | 'revoking-old'
  | 'migrating' | 'activating-new' | 'verifying' | 'committed' | 'rollback-started'
  | 'restoring-data' | 'restoring-release' | 'activating-old' | 'rolled-back' | 'recovery-failed'

/** State returned for one target on the current device. */
export interface PluginDeviceTargetState {
  readonly installationId: PluginInstallationId
  readonly pluginId: PluginId
  readonly releaseId: PluginReleaseId
  readonly version: string
  readonly targetKind: PluginTargetKind
  readonly desiredState: 'enabled' | 'disabled' | 'stopping' | 'uninstalled'
  readonly observedState: PluginActivationState
  readonly activationId?: PluginActivationId
  readonly permissionRevision: PluginPermissionRevision
  readonly cleanupState: 'none' | 'pending' | 'failed' | 'complete'
  readonly operation?: { readonly id: string; readonly stage: PluginOperationStage; readonly status: string }
  readonly lastError?: string | null
  readonly heartbeatAt?: string | null
  readonly leaseExpiresAt?: string | null
}

/** Stable error codes emitted by plugin capability calls. */
export type PluginErrorCode =
  | 'plugin/unauthorized'
  | 'plugin/revoked'
  | 'plugin/not-active'
  | 'plugin/unsupported-capability'
  | 'plugin/invalid-request'
  | 'plugin/timeout'
  | 'plugin/cancelled'
  | 'plugin/quota-exceeded'
  | 'plugin/conflict'
  | 'device/not-owned'
  | 'plugin/installation-forbidden'
  | 'plugin/device-conflict'
  | 'plugin/operation-in-progress'
  | 'plugin/cleanup-failed'
  | 'plugin/activation-failed'
  | 'plugin/upgrade-rollback'
  | 'plugin/data-unavailable'
  | 'plugin/internal'
