import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginSdk } from '../src/index.ts'

test('sdk routes every capability through the installation transport', async () => {
  const calls: string[] = []
  const sdk = createPluginSdk({
    call: async <T>(operation: string, input: unknown): Promise<T> => {
      calls.push(`${operation}:${JSON.stringify(input)}`)
      if (operation === 'identity.current') return { userId: 'u', name: 'Ada', avatarUrl: null, email: 'ada@example.com', organizationId: 'o', owner: { kind: 'personal', accountId: 'u' } } as T
      return (operation === 'cache.increment' ? 2 : {}) as T
    },
    stream: async function* <T>() { yield { text: 'ok', done: true } as T },
  })
  assert.equal((await sdk.identity.current()).email, 'ada@example.com')
  assert.equal(await sdk.cache.increment('counter'), 2)
  assert.match(calls[0] ?? '', /^identity\.current:/)
  assert.match(calls[1] ?? '', /^cache\.increment:/)
})
