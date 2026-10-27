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
  /** Cordis registration selector: `key` for keyed slots, `id` for list slots. */
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
  | 'network.http'
  | 'credentials.read'
  | 'credentials.write'
  | 'authorization.oauth'
  | 'authorization.api-key'
  | 'mcp.connect'
  | 'skills.register'
  | 'config.read'
  | 'config.write'

/** Host HTTP policy declared by a plugin package. */
export interface PluginNetworkPolicy {
  readonly allowedHosts: readonly string[]
  readonly maxResponseBytes?: number
}

/** Credential metadata safe to expose to configuration surfaces. */
export interface PluginCredentialDescriptor {
  readonly name: string
  readonly label?: string
  readonly kind: 'secret' | 'oauth' | 'api-key'
}

/** A structured skill contributed by an activated Host target. */
export interface PluginSkill {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly content: string
  readonly version?: string
}

/** Result of discovering tools from one remote MCP server. */
export interface PluginMcpTool {
  readonly name: string
  readonly qualifiedName: string
  readonly description?: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** Remote MCP server declaration owned by the plugin activation. */
export interface PluginMcpServer {
  readonly id: string
  readonly url: string
  readonly transport: 'streamable-http' | 'sse'
}
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

/** One independently loadable Cordis package inside a product release. */
export interface PluginCordisPackageManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly targets: readonly PluginTargetManifest[]
  /** Agent preset compositions installed beside the package and discovered by AgentPresets. */
  readonly presets?: readonly { readonly id: string; readonly entry: string }[]
}

/** Manifest embedded in a `.dsh-plugin.zip` package. */
export interface PluginManifest {
  readonly schemaVersion: 2 | 3
  readonly pluginId: PluginId
  readonly name: string
  /** Embedded PNG data URL, at most 64 KiB decoded and 512 × 512 pixels. */
  readonly icon?: string
  readonly version: string
  readonly targets: readonly PluginTargetManifest[]
  readonly packages?: readonly PluginCordisPackageManifest[]
  readonly permissions: readonly PluginPermission[]
  readonly network?: PluginNetworkPolicy
  readonly credentialDescriptors?: readonly PluginCredentialDescriptor[]
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

/** Public platform model operation; provider addresses and credentials remain server-owned. */
export interface PluginModelDescriptor {
  readonly id: PluginModelId
  readonly name: string
  readonly inputModalities: readonly ['text'] | readonly string[]
  readonly maxOutputTokens?: number
  readonly operation: 'text.generate' | PluginModelTaskOperation
  readonly outputModalities: readonly string[]
  readonly version?: number
  readonly parameters?: Readonly<Record<string, PluginModelParameter>>
  readonly settlementUnits?: Readonly<Record<string, string>>
  readonly prices?: Readonly<Record<string, string>>
  readonly reserve?: {
    readonly quantityPath: string
    readonly microsCnyPerUnit: string
    readonly quantityOverrides: Readonly<Record<string, number>>
  }
  readonly estimatedMicrosCny?: number
  readonly videoReferencePrices?: Readonly<Record<string, string>>
  readonly referenceKinds?: readonly string[]
}

/** Validated parameter rules exposed by an operation revision. */
export interface PluginModelParameter {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  readonly required: boolean
  readonly label?: string
  readonly default?: unknown
  readonly minimum?: number
  readonly maximum?: number
  readonly values?: readonly (string | number | boolean)[]
  readonly specialValues: readonly (string | number | boolean)[]
}

/** Server-validated cost estimate and selected immutable rate condition; funds are charged after settlement. */
export interface PluginModelTaskPreview {
  readonly model: PluginModelId
  readonly adapterVersion: number
  readonly estimatedMicrosCny: number
  readonly settlementUnits: Readonly<Record<string, string>>
  readonly prices: Readonly<Record<string, string>>
  readonly priceCondition: 'standard' | 'video_reference'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly missingUsagePolicy: 'use_reserved' | 'await_usage'
}

/** Durable generation request; references use authorized platform asset IDs. */
export interface PluginModelTaskInput {
  readonly operation: PluginModelTaskOperation
  readonly model: PluginModelId
  readonly input: Readonly<Record<string, unknown>>
  readonly parameters?: Readonly<Record<string, unknown>>
  readonly idempotencyKey: string
}

/** One message accepted by the text model facade. */
export interface PluginTextMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** Result and billing information for one model call. */
export interface PluginUsage {
  readonly callId: string
  readonly status: 'settled' | 'pending_reconciliation' | 'cancelled' | 'failed'
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
/** Task result exposed to a plugin without Provider response fields. */
export type PluginModelTaskResult =
  | { readonly kind: 'embedding'; readonly index: number; readonly vector: readonly number[] }
  | { readonly kind: 'image' | 'video' | 'audio'; readonly index: number; readonly assetId: string; readonly mimeType: string; readonly byteLength: number; readonly checksum: string; readonly recoverableUntil?: string }
  | { readonly kind: 'transcript'; readonly text: string; readonly startSeconds?: number; readonly endSeconds?: number }
/** Client-safe asynchronous task status and billing projection. */
export interface PluginModelTask {
  readonly id: string
  readonly operation: PluginModelTaskOperation
  readonly publicModel: string
  readonly modelId: PluginModelId
  readonly assetStatus: 'pending' | 'ready' | 'review_required' | 'not_applicable'
  readonly billingBasis: string | null
  readonly estimatedMicrosCny: number
  readonly reviewReason?: string | null
  readonly status: 'queued' | 'submitting' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  readonly billingStatus: 'pending' | 'reserved' | 'awaiting_usage' | 'settled' | 'partially_collected' | 'review_required'
  readonly results: readonly PluginModelTaskResult[]
  readonly usage?: {
    readonly complete: boolean
    readonly items: readonly {
      readonly key: string
      readonly unit: string
      readonly quantity: string
      readonly source: string
      readonly final: boolean
    }[]
  } | null
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
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers may enforce an explicit stored-value type.
  set<T = unknown>(
    key: string,
    value: T,
    options?: { readonly ttlSeconds?: number; readonly ifVersion?: string },
    signal?: AbortSignal,
  ): Promise<{ readonly version: string }>
  delete(key: string, signal?: AbortSignal): Promise<void>
  increment(key: string, amount?: number, options?: { readonly ttlSeconds?: number }, signal?: AbortSignal): Promise<number>
}

/** Host HTTP request and bounded response returned by the network capability. */
export interface PluginHttpRequest {
  readonly url: string
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

/** Bounded HTTP response returned to a Host plugin. */
export interface PluginHttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly truncated: boolean
}

/** Installation-scoped credentials facade. Values are Host-only secrets. */
export interface PluginCredentials {
  get(name: string, signal?: AbortSignal): Promise<string | undefined>
  set(name: string, value: string, signal?: AbortSignal): Promise<void>
  delete(name: string, signal?: AbortSignal): Promise<void>
  list(signal?: AbortSignal): Promise<readonly PluginCredentialDescriptor[]>
}

/** Authorization broker facade; providers persist resulting secrets in credentials. */
export interface PluginAuthorization {
  begin(input: { readonly kind: 'oauth' | 'api-key' | 'device-code'; readonly provider: string; readonly scopes?: readonly string[]; readonly metadata?: Readonly<Record<string, string>> }, signal?: AbortSignal): Promise<{ readonly authorizationId: string; readonly url?: string; readonly userCode?: string }>
  complete(
    authorizationId: string, input?: Readonly<Record<string, string>>, signal?: AbortSignal,
  ): Promise<{ readonly completed: boolean }>
}

/** MCP connection, discovery, and call facade. */
export interface PluginMcp {
  connect(input: { readonly id: string; readonly url: string; readonly transport?: 'streamable-http' | 'sse' }, signal?: AbortSignal): Promise<PluginMcpServer>
  disconnect(id: string, signal?: AbortSignal): Promise<void>
  listTools(id: string, signal?: AbortSignal): Promise<readonly PluginMcpTool[]>
  call(input: {
    readonly serverId: string
    readonly tool: string
    readonly arguments: Readonly<Record<string, unknown>>
  }, signal?: AbortSignal): Promise<unknown>
}

/** Skill registration facade owned by one Host activation. */
export interface PluginSkills {
  register(skill: PluginSkill, signal?: AbortSignal): Promise<void>
  unregister(id: string, signal?: AbortSignal): Promise<void>
  list(signal?: AbortSignal): Promise<readonly PluginSkill[]>
}

/** Installation-level non-secret configuration facade. */
export interface PluginConfig {
  get<T = unknown>(key: string, signal?: AbortSignal): Promise<T | undefined>
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers may enforce an explicit stored-value type.
  set<T = unknown>(key: string, value: T, signal?: AbortSignal): Promise<void>
  delete(key: string, signal?: AbortSignal): Promise<void>
}

/** SDK surface injected into one activated plugin target. */
export interface PluginSdk {
  readonly identity: { current(signal?: AbortSignal): Promise<PluginIdentity> }
  readonly models: {
    list(options?: { readonly operation?: 'text.generate' | PluginModelTaskOperation }, signal?: AbortSignal): Promise<readonly PluginModelDescriptor[]>
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
    previewTask(input: PluginModelTaskInput, signal?: AbortSignal): Promise<PluginModelTaskPreview>
    createTask(input: PluginModelTaskInput, signal?: AbortSignal): Promise<PluginModelTask>
    queryTask(input: { readonly taskId: string }, signal?: AbortSignal): Promise<PluginModelTask>
    cancelTask(input: { readonly taskId: string }, signal?: AbortSignal): Promise<PluginModelTask>
    retryTaskSave(input: { readonly taskId: string }, signal?: AbortSignal): Promise<PluginModelTask>
    listTasks(signal?: AbortSignal): Promise<readonly PluginModelTask[]>
    listTaskPage(input: {
      readonly cursor?: string
      readonly limit?: number
      readonly status?: PluginModelTask['status']
      readonly query?: string
    }, signal?: AbortSignal): Promise<{ readonly items: readonly PluginModelTask[]; readonly nextCursor: string | null }>
    uploadAsset(
      input: { readonly assetId: string; readonly content: Uint8Array; readonly contentType: string }, signal?: AbortSignal,
    ): Promise<{ readonly assetId: string; readonly mimeType: string; readonly checksum: string }>
    assetAccess(input: { readonly assetId: string }, signal?: AbortSignal): Promise<{
      readonly assetId: string
      readonly url: string
      readonly expiresAt: string
      readonly mimeType: string
      readonly recoverableUntil: string | null
    }>

  }
  readonly objects: PluginObjects
  readonly database: PluginDatabase
  readonly cache: PluginCache
  readonly network?: { request(input: PluginHttpRequest, signal?: AbortSignal): Promise<PluginHttpResponse> }
  readonly credentials?: PluginCredentials
  readonly authorization?: PluginAuthorization
  readonly mcp?: PluginMcp
  readonly skills?: PluginSkills
  readonly config?: PluginConfig
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
  | 'plugin/network-policy-missing'
  | 'plugin/network-scheme-forbidden'
  | 'plugin/network-host-forbidden'
  | 'plugin/response-too-large'
  | 'plugin/credentials-unavailable'
  | 'plugin/authorization-unavailable'
  | 'plugin/mcp-unavailable'
  | 'plugin/skills-unavailable'
  | 'plugin/config-unavailable'
  | 'plugin/internal'
