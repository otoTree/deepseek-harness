import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { bindPluginSdk, mountPluginTarget } from '../src/index.ts'

test('runtime invalidates sdk calls after disposal', async () => {
  const bound = bindPluginSdk({
    call: async <T>() => ({}) as T,
    stream: async function* <T>() { yield {} as T },
  })
  bound.dispose()
  await assert.rejects(bound.sdk.identity.current(), /plugin\/not-active/)
})

test('runtime aborts calls that remain active during disposal', async () => {
  let observed: AbortSignal | undefined
  const bound = bindPluginSdk({
    call: async <T>(_operation: string, _input: unknown, signal?: AbortSignal) => {
      observed = signal
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => { reject(new Error(String(signal.reason))) }, { once: true }))
      return {} as T
    },
    stream: async function* <T>() { yield {} as T },
  })
  const pending = bound.sdk.identity.current()
  await Promise.resolve()
  bound.dispose()
  assert.equal(observed?.aborted, true)
  await assert.rejects(pending, /plugin\/not-active/)
})

test('target mount isolates sdk services and waits for target disposal', async () => {
  const root = new Context()
  const observed: string[] = []
  let firstSdk: typeof root.pluginSdk | undefined
  const target = {
    name: 'runtime-target',
    inject: ['pluginSdk'],
    apply(ctx: Context) {
      firstSdk = ctx.pluginSdk
      ctx.effect(() => {
        observed.push('mounted')
        return async () => { await Promise.resolve(); observed.push('disposed') }
      })
    },
  }
  const bound = bindPluginSdk({
    call: async <T>() => ({ userId: 'user-1', name: 'One', avatarUrl: null, email: 'one@example.com', organizationId: 'org-1', owner: { kind: 'personal', accountId: 'user-1' } }) as T,
    stream: async function* <T>() { yield {} as T },
  })
  const dispose = await mountPluginTarget(root, target, bound.sdk)
  assert.deepEqual(observed, ['mounted'])
  assert.equal((await firstSdk?.identity.current())?.name, 'One')
  assert.equal(root.get('pluginSdk', false), undefined)
  await dispose()
  await dispose()
  assert.deepEqual(observed, ['mounted', 'disposed'])
  await root.fiber.dispose()
})

test('target mount cancellation disposes a pending activation', async () => {
  const root = new Context()
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  const bound = bindPluginSdk({
    call: async <T>() => ({}) as T,
    stream: async function* <T>() { yield {} as T },
  })
  const target = { async apply() { await pending } }
  await assert.rejects(
    mountPluginTarget(root, target, bound.sdk, { signal: AbortSignal.timeout(10) }),
    /timed out|timeout/iu,
  )
  assert.equal(root.get('pluginSdk', false), undefined)
  release?.()
  await root.fiber.dispose()
})
