import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PluginSdk, PluginTextResult } from '@deepseek-ai/dsh-plugin-sdk'

/** Cordis function-plugin name used by the Host target. */
export const name = 'enterprise-plugin-acceptance'
/** SDK dependency injected by the enterprise runtime. */
export const inject = ['pluginSdk', 'tools']

/** Run one deterministic capability probe for integration assertions. */
export async function runAcceptanceProbe(sdk: PluginSdk, signal?: AbortSignal): Promise<{
  identity: Awaited<ReturnType<PluginSdk['identity']['current']>>
  models: Awaited<ReturnType<PluginSdk['models']['list']>>
  text?: PluginTextResult
  object: Awaited<ReturnType<PluginSdk['objects']['put']>>
  objectBytes: Uint8Array
  cacheVersion: string
  cachedIdentity: string | undefined
  database: unknown
  transaction: unknown
}> {
  const identity = await sdk.identity.current(signal)
  const models = await sdk.models.list(signal)
  const text = models[0] === undefined ? undefined : await sdk.models.text({
    modelId: models[0].id,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    idempotencyKey: `acceptance-${randomUUID()}`,
  }, signal)
  const object = await sdk.objects.put({
    content: new TextEncoder().encode('enterprise-plugin-acceptance'),
    contentType: 'text/plain',
    idempotencyKey: `acceptance-object-${randomUUID()}`,
  }, signal)
  const objectBytes = await sdk.objects.read(object.objectId, { version: object.version }, signal)
  const cache = await sdk.cache.set('last-probe', { identity: identity.userId, object: object.version }, { ttlSeconds: 300 }, signal)
  const cached = await sdk.cache.get<{ identity?: string }>('last-probe', signal)
  let database: unknown
  let transaction: unknown
  try { database = await sdk.database.query('SELECT 1 AS ok', []) }
  catch (error) { database = error instanceof Error ? { error: error.message } : { error: 'unknown' } }
  try { transaction = await sdk.database.transaction([{ sql: 'SELECT 1 AS ok', params: [] }], signal) }
  catch (error) { transaction = error instanceof Error ? { error: error.message } : { error: 'unknown' } }
  return {
    identity,
    models,
    ...(text === undefined ? {} : { text }),
    object,
    objectBytes,
    cacheVersion: cache.version,
    cachedIdentity: cached?.identity,
    database,
    transaction,
  }
}

/** Register the acceptance probe as a model-facing Agent tool. */
export function apply(ctx: Context & { pluginSdk: PluginSdk }): void {
  const tool: ToolDefinition = {
    name: 'enterprise_plugin_acceptance',
    description: 'Exercise the installed enterprise plugin SDK and return the observed capability results.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['userName', 'ownerKind', 'modelCount', 'objectId', 'objectVersion', 'objectContent', 'cacheVersion', 'database', 'transaction'],
        properties: {
          userName: { type: 'string' },
          ownerKind: { type: 'string' },
          modelCount: { type: 'number' },
          text: { type: 'string' },
          objectId: { type: 'string' },
          objectVersion: { type: 'string' },
          objectContent: { type: 'string' },
          cacheVersion: { type: 'string' },
          cachedIdentity: { type: 'string' },
          database: { type: 'string' },
          transaction: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      const probe = await runAcceptanceProbe(ctx.pluginSdk, exec.signal)
      return {
        userName: probe.identity.name,
        ownerKind: probe.identity.owner.kind,
        modelCount: probe.models.length,
        ...(probe.text === undefined ? {} : { text: probe.text.text }),
        objectId: probe.object.objectId,
        objectVersion: probe.object.version,
        objectContent: new TextDecoder().decode(probe.objectBytes),
        cacheVersion: probe.cacheVersion,
        ...(probe.cachedIdentity === undefined ? {} : { cachedIdentity: probe.cachedIdentity }),
        database: JSON.stringify(probe.database),
        transaction: JSON.stringify(probe.transaction),
      }
    },
  }
  ctx.tools.register(tool)
}
