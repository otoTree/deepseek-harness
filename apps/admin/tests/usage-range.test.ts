import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shanghaiDate, shiftCalendarDate, usageRange } from '../app/usage-range'

void test('usage ranges use Shanghai midnight independently of the host timezone', () => {
  assert.deepEqual(usageRange('2026-03-08', '2026-03-08'), {
    from: '2026-03-07T16:00:00.000Z',
    to: '2026-03-08T16:00:00.000Z',
  })
  assert.deepEqual(usageRange('2026-09-01', '2026-09-30'), {
    from: '2026-08-31T16:00:00.000Z',
    to: '2026-09-30T16:00:00.000Z',
  })
})

void test('Shanghai date helpers cross UTC day and month boundaries', () => {
  assert.equal(shanghaiDate(new Date('2026-03-08T15:59:59.999Z')), '2026-03-08')
  assert.equal(shanghaiDate(new Date('2026-03-08T16:00:00.000Z')), '2026-03-09')
  assert.equal(shiftCalendarDate('2024-02-29', 1), '2024-03-01')
  assert.equal(shiftCalendarDate('2026-01-01', -1), '2025-12-31')
})

void test('usage ranges reject empty, impossible, reversed and oversized dates', () => {
  assert.equal(usageRange('', '2026-03-08'), undefined)
  assert.equal(usageRange('2026-02-30', '2026-03-08'), undefined)
  assert.equal(usageRange('2026-03-09', '2026-03-08'), undefined)
  assert.equal(usageRange('2025-01-01', '2026-01-02'), undefined)
})
