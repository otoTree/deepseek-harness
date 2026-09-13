import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopTaskState } from '../src/desktop-task-state.ts'

void test('desktop task state marks scheduled and running work missed without replaying it', () => {
  const state = new DesktopTaskState()
  state.register({ id: 'scheduled', scheduledAt: Date.now(), sideEffect: true })
  state.register({ id: 'running', scheduledAt: Date.now(), sideEffect: false })
  state.start('running')
  state.register({ id: 'done', scheduledAt: Date.now(), sideEffect: true })
  state.start('done')
  state.complete('done')

  assert.deepEqual(state.markUnavailable('offline').map(task => task.id), ['scheduled', 'running'])
  assert.equal(state.list().find(task => task.id === 'scheduled')?.state, 'missed')
  assert.equal(state.list().find(task => task.id === 'running')?.missedReason, 'offline')
  assert.equal(state.list().find(task => task.id === 'done')?.state, 'completed')
  assert.deepEqual(state.markUnavailable('sleep'), [])
})

void test('desktop task state rejects duplicate and invalid lifecycle transitions', () => {
  const state = new DesktopTaskState()
  state.register({ id: 'one', scheduledAt: 0, sideEffect: true })
  assert.throws(() => state.register({ id: 'one', scheduledAt: 0, sideEffect: true }), /already exists/)
  assert.throws(() => state.complete('one'), /not running/)
  state.start('one')
  state.complete('one')
  assert.throws(() => state.start('one'), /not schedulable/)
  assert.throws(() => state.markUnavailable(undefined), /reason/)
})
