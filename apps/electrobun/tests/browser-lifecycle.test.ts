import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NativeGuestCloseGuard, type NativeWindowCloseEvent } from '../src/browser-lifecycle.ts'

function guest(renderer: 'native' | 'cef' = 'cef') {
  let ready: ((event: unknown) => void) | undefined
  return {
    renderer, windowId: 7, isRemoved: false,
    on(name: string, handler: (event: unknown) => void) {
      assert.equal(name, 'did-commit-navigation')
      ready = handler
    },
    load() { ready?.(undefined) },
    remove() { this.isRemoved = true },
  }
}
function close(id = 7): NativeWindowCloseEvent { return { data: { id }, response: undefined } }

void test('loaded CEF removal vetoes its parent close once and preserves later user closes', () => {
  const guard = new NativeGuestCloseGuard()
  const view = guest()
  guard.observe(view)
  view.load()
  view.remove()
  view.remove()
  const foreign = close(8)
  guard.beforeClose(foreign)
  assert.equal(foreign.response, undefined)
  const parent = close()
  guard.beforeClose(parent)
  assert.deepEqual(parent.response, { allow: false })
  const user = close()
  guard.beforeClose(user)
  assert.equal(user.response, undefined)
})

void test('uninitialized CEF and native views do not suppress user window closes', () => {
  for (const renderer of ['cef', 'native'] as const) {
    const guard = new NativeGuestCloseGuard()
    const view = guest(renderer)
    guard.observe(view)
    if (renderer === 'native') view.load()
    view.remove()
    const user = close()
    guard.beforeClose(user)
    assert.equal(user.response, undefined)
  }
})

void test('simultaneous guest removals consume one parent close request per guest', () => {
  const guard = new NativeGuestCloseGuard()
  for (let index = 0; index < 2; index++) {
    const view = guest()
    guard.observe(view)
    view.load()
    view.remove()
  }
  for (let index = 0; index < 2; index++) {
    const event = close()
    guard.beforeClose(event)
    assert.deepEqual(event.response, { allow: false })
  }
  const user = close()
  guard.beforeClose(user)
  assert.equal(user.response, undefined)
})
