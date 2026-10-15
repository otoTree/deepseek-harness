/** Host-only credential transport over the organization DSH credential store. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { PluginCapabilityTransport } from '@deepseek-ai/dsh-plugin-protocol'
import { z } from 'zod'

const secretInput = z.object({
  name: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  value: z.string().min(1).max(256 * 1024).optional(),
}).strict()

/** Resolve the native credential key shared by configuration and Host activation.
 * @param scope - Organization and installation identities.
 * @param name - Credential name declared by the verified package.
 * @returns Installation-owned native credential key.
 */
export function marketCredentialKey(scope: { readonly organizationId: string; readonly installationId: string }, name: string) {
  const namespace = 'market-' + createHash('sha256').update(JSON.stringify(scope)).digest('hex')
  return credentialKey(namespace, 'secret-' + createHash('sha256').update(name).digest('hex'))
}

/** Bind credential operations to one installation; every operation rechecks its remote lease.
 * @param ctx - Host context carrying the native credential provider.
 * @param transport - Activation-authenticated API transport.
 * @param scope - Organization and installation identities.
 * @param permissions - Permissions from the verified release.
 * @returns Local Host credential persistence with unchanged remote capabilities.
 */
export function withHostCredentials(
  ctx: Context, transport: PluginCapabilityTransport,
  scope: { readonly organizationId: string; readonly installationId: string },
  permissions: readonly string[],
): PluginCapabilityTransport {
  const namespace = 'market-' + createHash('sha256').update(JSON.stringify(scope)).digest('hex')
  return {
    stream: (operation, input, signal) => transport.stream(operation, input, signal),
    async call<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
      if (!operation.startsWith('credentials.')) return transport.call<T>(operation, input, signal)
      const permission = operation === 'credentials.get' || operation === 'credentials.list' ? 'credentials.read' : 'credentials.write'
      if (!permissions.includes(permission)) throw new Error('plugin/unsupported-capability')
      await transport.call('activation.check', {}, signal)
      signal?.throwIfAborted()
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('plugin/credentials-unavailable')
      const keyFor = (name: string) => marketCredentialKey(scope, name)
      let result: unknown
      if (operation === 'credentials.list') {
        const entries = (await credentials.listRecords()).filter(entry => entry.key.startsWith(`${namespace}/`))
        result = await Promise.all(entries.map(async (entry) => {
          const record = await credentials.readRecord(entry.key)
          if (record?.kind !== 'grant') throw new Error('plugin/invalid-credential-record')
          const payload = z.object({ name: z.string(), value: z.string() }).parse(record.payload)
          return { name: payload.name, kind: 'secret', configured: true }
        }))
      } else {
        const value = secretInput.parse(input)
        const key = keyFor(value.name)
        switch (operation) {
          case 'credentials.get': {
            const record = await credentials.readRecord(key)
            result = record?.kind === 'grant' ? z.object({ name: z.literal(value.name), value: z.string() }).parse(record.payload).value : undefined
            break
          }
          case 'credentials.set':
            if (value.value === undefined) throw new Error('plugin/invalid-request')
            await credentials.modifyRecord(key, () => Promise.resolve({ kind: 'grant', payload: { name: value.name, value: value.value } }))
            break
          case 'credentials.delete': await credentials.deleteRecord(key); break
          default: throw new Error('plugin/unsupported-capability')
        }
      }
      // T is the transport caller's operation-specific response type.
      return result as T
    },
  }
}
