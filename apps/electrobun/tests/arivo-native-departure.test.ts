/** Native shutdown accepts only the current page's one-use callback; failure retains the window. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { prepareArivoNativeDeparture } from '../src/distribution/arivo-native-departure.ts'

const browserFetch = (url: string, input: RequestInit) => {
  const headers = new Headers(input.headers); headers.set('Origin', origin)
  return fetch(url, { ...input, headers })
}

const origin = 'http://127.0.0.1:34567'

void test('native acknowledgement retains the client lease until explicit runtime cleanup', async () => {
  const events: string[] = [], work: Promise<unknown>[] = []
  const active = new AbortController()
  const api = { async prepare() { events.push('freeze'); return true }, release() { events.push('release') } }
  const lease = await prepareArivoNativeDeparture({ origin, timeoutMs: 1000, signal: active.signal, execute: (script) => {
    const value: unknown = runInNewContext(script, { location: { origin }, window: { __arivoNativeDeparture: api },
      fetch: browserFetch })
    if (value instanceof Promise) work.push(value)
  } })
  assert.equal(typeof lease, 'function'); assert.deepEqual(events, ['freeze'])
  if (lease) { lease(); lease() }
  assert.deepEqual(events, ['freeze', 'release'])
  await Promise.allSettled(work)
})

void test('missing startup entry and explicit refusal cannot stop the native runtime', async () => {
  for (const api of [undefined, { prepare: async () => false, release: () => {} }]) {
    const result = await prepareArivoNativeDeparture({ origin, timeoutMs: 1000, signal: new AbortController().signal,
      execute: (script) => { runInNewContext(script, { location: { origin }, window: { __arivoNativeDeparture: api },
        fetch: browserFetch }) } })
    assert.equal(result, false)
  }
})

void test('forged origin, stale id, unknown fields, oversized bodies and non-POST callbacks are refused', async () => {
  const observed = Promise.withResolvers<string>()
  const pending = prepareArivoNativeDeparture({ origin, timeoutMs: 5000, signal: new AbortController().signal,
    execute: (script) => {
      const callback = script.match(/fetch\("(http:\/\/127\.0\.0\.1:\d+\/([a-f0-9-]{36}))"/u)
      if (callback) observed.resolve(callback[1])
    } })
  const url = await observed.promise, id = new URL(url).pathname.slice(1)
  const post = async (value: unknown, from = origin) => fetch(url, { method: 'POST', headers: { Origin: from }, body: JSON.stringify(value) })
  const valid = { version: 1, id, allow: true }
  assert.equal((await fetch(url, { headers: { Origin: origin } })).status, 403)
  assert.equal((await post(valid, 'http://127.0.0.1:34568')).status, 403)
  assert.equal((await post({ ...valid, id: 'e7e4bb76-bd54-431f-bcb0-233bf2119c9d' })).status, 403)
  assert.equal((await post({ ...valid, scope: 'foreign' })).status, 400)
  try { assert.equal((await post('x'.repeat(1100))).status, 413) }
  catch (error) { assert.ok(error instanceof TypeError, 'Oversized request may be terminated before its response is read') }
  assert.equal((await post(valid)).status, 204)
  const release = await pending; assert.equal(typeof release, 'function'); if (release) release()
  await assert.rejects(fetch(url), /fetch failed/u)
})

void test('deadline and generation cancellation release even a late client preparation', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(), ready = Promise.withResolvers<boolean>(), calls: string[] = []
    const started = Promise.withResolvers<undefined>()
    const pending = prepareArivoNativeDeparture({ origin, timeoutMs: cancel ? 1000 : 15, signal: controller.signal,
      execute: (script) => { runInNewContext(script, { location: { origin }, window: { __arivoNativeDeparture: {
        prepare: () => { calls.push('prepare'); started.resolve(undefined); return ready.promise },
        release: () => { calls.push('release') },
      } }, fetch: async () => { calls.push('late-callback') } }) } })
    await started.promise
    if (cancel) controller.abort()
    assert.equal(await pending, false); assert.deepEqual(calls, ['prepare', 'release'])
    ready.resolve(true); await Promise.resolve(); await Promise.resolve()
  }
})

void test('foreign or noncanonical OS origins fail before creating a callback server', async () => {
  for (const value of ['https://arivo.example', origin + '/', 'http://localhost:34567', origin + '/?token=bad']) {
    await assert.rejects(prepareArivoNativeDeparture({ origin: value, timeoutMs: 1000,
      signal: new AbortController().signal, execute: () => { assert.fail('Must not dispatch') } }), /loopback OS origin/u)
  }
})
