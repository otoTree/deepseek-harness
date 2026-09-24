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
/** Capability permission names understood by the first plugin runtime. */
export type PluginPermission =
  | 'identity.read'
  | 'models.text'
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

/** One executable target in a standard plugin package. */
export interface PluginTargetManifest {
  readonly kind: PluginTargetKind
  readonly entry: string
  readonly compatibility: string
  readonly contributions: readonly string[]
}

/** Manifest embedded in a `.dsh-plugin.zip` package. */
export interface PluginManifest {
  readonly schemaVersion: 1
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
