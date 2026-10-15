/** Native quit waits for owned cleanup, including signal-driven quit requests. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DesktopShutdown, type DesktopQuitEvent } from '../src/shutdown.ts'

void test('native quit is vetoed synchronously and waits for shared cleanup', async () => {
  const stopped = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  let cleanups = 0
  let quits = 0
  const errors: unknown[] = []
  const lifecycle = new DesktopShutdown(async () => {
    cleanups++
    entered.resolve(undefined)
    await stopped.promise
  }, () => {
    const event: DesktopQuitEvent = { response: undefined }
    lifecycle.beforeQuit(event)
    assert.equal(event.response, undefined)
    quits++
  }, (error) => { errors.push(error) })
  const event: DesktopQuitEvent = { response: undefined }
  lifecycle.beforeQuit(event)
  assert.deepEqual(event.response, { allow: false })
  await entered.promise
  const first = lifecycle.shutdown()
  assert.equal(first, lifecycle.shutdown())
  lifecycle.beforeQuit({ response: undefined })
  assert.equal(cleanups, 1)
  assert.equal(quits, 0)
  stopped.resolve(undefined)
  await first
  assert.equal(quits, 1)
  assert.deepEqual(errors, [])
})

void test('cleanup failure prevents quit and a later request can retry', async () => {
  const observed = Promise.withResolvers<unknown>()
  const failure = new Error('Host did not stop')
  let cleanups = 0
  let quits = 0
  const lifecycle = new DesktopShutdown(async () => {
    if (++cleanups === 1) throw failure
  }, () => { quits++ }, observed.resolve)
  const event: DesktopQuitEvent = { response: undefined }
  lifecycle.beforeQuit(event)
  assert.deepEqual(event.response, { allow: false })
  assert.equal(await observed.promise, failure)
  assert.equal(quits, 0)
  await lifecycle.shutdown()
  assert.equal(cleanups, 2)
  assert.equal(quits, 1)
})
