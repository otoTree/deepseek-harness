/** Departure leases retain editor input through the actual commit and cancel uncertain saves. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArivoDeparture, departureReply } from '../src/distribution/arivo-shell/client/departure.ts'

void test('synchronous composed navigation waits once and commits while input remains frozen', async () => {
  const ready = Promise.withResolvers<false | (() => void)>()
  const events: string[] = []
  const gate = new ArivoDeparture(1000, (change) => { events.push('commit'); change() }, () => { events.push('blocked') })
  gate.register(async () => { events.push('freeze'); return ready.promise })
  const first = gate.run(() => { events.push('select-session') })
  const second = gate.run(() => { events.push('conversation') })
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(await gate.run(() => { events.push('stale-later-intent') }), false)
  assert.deepEqual(events, ['freeze'])
  ready.resolve(() => { events.push('release') })
  assert.equal(await first, true)
  assert.deepEqual(events, ['freeze', 'commit', 'select-session', 'conversation', 'release'])
})

void test('refusal or rejection retains the old view and releases every successful editor', async () => {
  for (const throws of [false, true]) {
    const events: string[] = []
    const gate = new ArivoDeparture(1000, (change) => { change() }, () => { events.push('blocked') })
    gate.register(async () => () => { events.push('released') })
    gate.register(async () => { if (throws) throw new Error('disk full'); return false })
    assert.equal(await gate.run(() => { events.push('destroyed') }), false)
    assert.deepEqual(events, ['blocked', 'released'])
  }
})

void test('deadline is a refusal even if an editor ignores abort; a late lease is released', async () => {
  const ready = Promise.withResolvers<false | (() => void)>()
  const events: string[] = []
  const gate = new ArivoDeparture(5, (change) => { change() }, () => { events.push('blocked') })
  const unregister = gate.register(() => ready.promise)
  assert.equal(await gate.run(() => { events.push('destroyed') }), false)
  ready.resolve(() => { events.push('late-release') })
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(events, ['blocked', 'late-release'])
  unregister()
  assert.equal(await gate.run(() => { events.push('next-intent') }), true)
  assert.equal(events.at(-1), 'next-intent')
})

void test('roster changes and plugin disposal cancel pending mutations', async () => {
  for (const dispose of [false, true]) {
    let committed = false
    const gate = new ArivoDeparture(1000, (change) => { change() }, () => {})
    const unregister = gate.register(() => new Promise(() => {}))
    const pending = gate.run(() => { committed = true })
    if (dispose) gate.dispose(); else unregister()
    assert.equal(await pending, false); assert.equal(committed, false)
  }
})

void test('only exact v1 acknowledgement fields and the current id can grant departure', () => {
  const valid = { version: 1, type: 'arivo:leave-ready', id: 'active', allow: true }
  assert.equal(departureReply(valid, 'active'), true)
  assert.equal(departureReply({ ...valid, allow: false }, 'active'), false)
  for (const value of [null, [], { ...valid, id: 'stale' }, { ...valid, allow: 1 },
    { ...valid, version: 2 }, { ...valid, scope: 'foreign' }]) assert.equal(departureReply(value, 'active'), undefined)
})

void test('iframe preparation rejects a different origin, source, request id and unknown fields', async (t) => {
  const { prepareFrame } = await import('../src/distribution/arivo-shell/client/departure.ts')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const receiver = new EventTarget()
  Object.defineProperty(globalThis, 'window', { value: receiver, configurable: true })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') })
  const sent: { version: number; type: string; id: string }[] = []
  const origin = 'http://127.0.0.1:12345'
  const target = { postMessage(value: typeof sent[number], destination: string) { assert.equal(destination, origin); sent.push(value) } }
  const frame = { contentWindow: target } as unknown as HTMLIFrameElement
  const controller = new AbortController()
  let settled = false
  const pending = prepareFrame(frame, origin, controller.signal).then((result) => { settled = true; return result })
  const id = sent[0]!.id
  const reply = { version: 1, type: 'arivo:leave-ready', id, allow: true }
  const emit = (data: unknown, source: unknown = target, from: string = origin) => {
    const event = new Event('message')
    Object.defineProperties(event, { data: { value: data }, source: { value: source }, origin: { value: from } })
    receiver.dispatchEvent(event)
  }
  emit(reply, target, 'http://127.0.0.1:54321'); emit(reply, {})
  emit({ ...reply, id: 'stale' }); emit({ ...reply, account: 'foreign' })
  await Promise.resolve(); assert.equal(settled, false)
  emit(reply)
  const release = await pending
  assert.equal(typeof release, 'function')
  if (release) release()
  assert.deepEqual(sent.map(value => value.type), ['arivo:prepare-leave', 'arivo:release-leave'])
  const cancelled = prepareFrame(frame, origin, controller.signal)
  controller.abort()
  assert.equal(await cancelled, false)
  assert.deepEqual(sent.slice(-2).map(value => value.type), ['arivo:prepare-leave', 'arivo:release-leave'])
})

void test('native departure retains all freezes after acknowledgement and rejects competing UI intents', async () => {
  const ready = Promise.withResolvers<false | (() => void)>(), events: string[] = []
  const gate = new ArivoDeparture(1000, (change) => { change() }, () => {})
  gate.register(() => ready.promise)
  const abort = new AbortController(), holding = gate.hold(abort.signal)
  assert.equal(await gate.run(() => { events.push('destroyed') }), false)
  assert.equal(await gate.hold(abort.signal), false)
  ready.resolve(() => { events.push('released') })
  const release = await holding
  assert.equal(typeof release, 'function'); assert.deepEqual(events.slice(), [])
  assert.equal(await gate.run(() => { events.push('destroyed') }), false)
  if (release) { release(); release() }
  assert.deepEqual(events, ['released'])
  assert.equal(await gate.run(() => { events.push('next-intent') }), true)
})

void test('native cancellation releases pending, late and granted editor leases', async () => {
  for (const afterGrant of [false, true]) {
    const ready = Promise.withResolvers<false | (() => void)>(), events: string[] = []
    const gate = new ArivoDeparture(1000, (change) => { change() }, () => {})
    gate.register(() => ready.promise)
    const controller = new AbortController(), pending = gate.hold(controller.signal)
    if (afterGrant) ready.resolve(() => { events.push('released') })
    if (afterGrant) assert.equal(typeof await pending, 'function')
    controller.abort()
    if (!afterGrant) {
      assert.equal(await pending, false)
      ready.resolve(() => { events.push('released') }); await Promise.resolve(); await Promise.resolve()
    }
    assert.deepEqual(events, ['released'])
  }
})

void test('startup native entry cancels released preparation and removes its lifecycle owner', async (t) => {
  const { installNativeDeparture } = await import('../src/distribution/arivo-shell/client/departure.ts')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const target: { __arivoNativeDeparture?: {
    prepare(id: string): Promise<boolean>
    release(id: string): void
  } } = {}
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') })
  const ready = Promise.withResolvers<false | (() => void)>(), events: string[] = []
  const gate = new ArivoDeparture(1000, (change) => { change() }, () => {})
  gate.register(() => ready.promise)
  const dispose = installNativeDeparture(gate), api = target.__arivoNativeDeparture!
  const id = 'a41e4801-d5e3-4b73-a9dd-03289a8b7172'
  assert.equal(await api.prepare('invalid'), false)
  const pending = api.prepare(id)
  assert.equal(await api.prepare(id), false)
  api.release('a41e4801-d5e3-4b73-a9dd-03289a8b7173')
  api.release(id)
  assert.equal(await pending, false)
  ready.resolve(() => { events.push('late-release') }); await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(events, ['late-release'])
  dispose(); assert.equal(target.__arivoNativeDeparture, undefined)
})

void test('native grant freezes the shell for late editor mounts and restores prior inert ownership', async (t) => {
  const { installNativeDeparture } = await import('../src/distribution/arivo-shell/client/departure.ts')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const root = { inert: false }
  const target: { document: { documentElement: typeof root }
    __arivoNativeDeparture?: {
      prepare(id: string): Promise<boolean>
      release(id: string): void
    }
  } = { document: { documentElement: root } }
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') })
  const gate = new ArivoDeparture(1000, (change) => { change() }, () => {})
  const dispose = installNativeDeparture(gate), api = target.__arivoNativeDeparture!
  const id = 'a41e4801-d5e3-4b73-a9dd-03289a8b7172'
  assert.equal(await api.prepare(id), true); assert.equal(root.inert, true)
  gate.register(async () => false)
  api.release(id); assert.equal(root.inert, false)
  gate.dispose(); dispose()
  const nextGate = new ArivoDeparture(1000, (change) => { change() }, () => {})
  root.inert = true
  const nextDispose = installNativeDeparture(nextGate)
  assert.equal(await target.__arivoNativeDeparture!.prepare(id), true)
  nextDispose(); assert.equal(root.inert, true)
})
