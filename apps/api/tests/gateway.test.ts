/** Focused model transport DNS and diagnostic tests. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LookupAddress, LookupOptions } from 'node:dns'
import {
  calculateUsageCosts,
  createModelLookup,
  reportModelFailure,
  reportModelStatus,
  reportModelUsageFailure,
  waitForProviderUpload,
  type ModelAddressResolver,
  type SharedProviderUpload,
} from '../src/gateway.ts'

void test('CNY usage cost separates cached input and rounds each component', () => {
  assert.deepEqual(calculateUsageCosts({
    promptTokens: 12,
    cachedPromptTokens: 5,
    completionTokens: 8,
    reasoningTokens: 3,
  }, {
    inputPriceMicrosCnyPerMillion: 2_000_000,
    cachedInputPriceMicrosCnyPerMillion: 500_000,
    outputPriceMicrosCnyPerMillion: 8_000_000,
  }), {
    uncachedInputTokens: 7,
    inputCostMicrosCny: 14,
    cachedInputCostMicrosCny: 3,
    outputCostMicrosCny: 64,
    totalCostMicrosCny: 81,
  })
})

void test('shared provider upload attributes usage to a surviving waiter', async () => {
  let resolveUpload!: SharedProviderUpload['promise'] extends Promise<infer T> ? (value: T) => void : never
  const operation: SharedProviderUpload = {
    controller: new AbortController(),
    promise: new Promise((resolve) => { resolveUpload = resolve }),
    settled: false,
    waiters: 0,
    uploadedClaimed: false,
  }
  const cancelled = new AbortController()
  const survivor = new AbortController()
  const first = waitForProviderUpload(operation, cancelled.signal)
  const second = waitForProviderUpload(operation, survivor.signal)

  cancelled.abort(new Error('cancel first waiter'))
  await assert.rejects(first, /cancel first waiter/)
  assert.equal(operation.controller.signal.aborted, false)
  resolveUpload({ fileId: 'file-shared', expiresAt: 2_000, modelId: 'model-a' })
  operation.settled = true
  assert.deepEqual(await second, {
    receipt: { fileId: 'file-shared', expiresAt: 2_000, modelId: 'model-a' },
    uploaded: true,
  })
})

function callLookup(
  resolver: ModelAddressResolver,
  options: LookupOptions,
): Promise<{
  error: NodeJS.ErrnoException | null
  address: string | LookupAddress[]
  family: number | undefined
}> {
  return new Promise((resolve) => {
    createModelLookup(resolver)('model.example', options, (error, address, family) => {
      resolve({ error, address, family })
    })
  })
}

void test('model lookup returns the callback form requested by Node', async () => {
  const resolver: ModelAddressResolver = (_hostname, options, callback) => {
    assert.deepEqual(options, { family: 4, all: true })
    callback(null, [
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ])
  }
  assert.deepEqual(await callLookup(resolver, {}), {
    error: null,
    address: '8.8.8.8',
    family: 4,
  })
  assert.deepEqual(await callLookup(resolver, { all: true }), {
    error: null,
    address: [
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ],
    family: undefined,
  })
})

void test('model lookup rejects resolver failures and every unsafe answer set', async () => {
  const failed = await callLookup((_hostname, _options, callback) => {
    callback(Object.assign(new Error('dns failed'), { code: 'ENOTFOUND' }), [])
  }, { all: true })
  assert.equal(failed.error?.code, 'ENOTFOUND')
  assert.deepEqual(failed.address, [])

  for (const addresses of [
    [],
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: 'not-an-address', family: 4 }],
  ]) {
    const result = await callLookup((_hostname, _options, callback) => {
      callback(null, addresses)
    }, { all: true })
    assert.ok(result.error)
    assert.deepEqual(result.address, [])
  }
})

void test('gateway diagnostics exclude credentials, request bodies, and query parameters', () => {
  const calls: unknown[][] = []
  reportModelFailure({
    modelId: 'model-id',
    upstreamOrigin: 'https://api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
  }, Object.assign(new TypeError('Invalid IP address: undefined'), { code: 'ERR_INVALID_IP_ADDRESS' }),
  (...values: unknown[]) => { calls.push(values) })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [
    '[enterprise-gateway] upstream request failed',
    {
      modelId: 'model-id',
      upstreamOrigin: 'https://api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      error: {
        name: 'TypeError',
        code: 'ERR_INVALID_IP_ADDRESS',
      },
    },
  ])
  const serialized = JSON.stringify(calls)
  assert.ok(!serialized.includes('Authorization'))
  assert.ok(!serialized.includes('messages'))
  assert.ok(!serialized.includes('?'))

  const statuses: unknown[][] = []
  reportModelStatus({
    modelId: 'model-id',
    upstreamOrigin: 'https://api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
  }, 401, (...values: unknown[]) => { statuses.push(values) })
  assert.deepEqual(statuses, [[
    '[enterprise-gateway] upstream returned an error status',
    {
      modelId: 'model-id',
      upstreamOrigin: 'https://api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      status: 401,
    },
  ]])

  const metering: unknown[][] = []
  reportModelUsageFailure({
    modelId: 'model-id',
    upstreamOrigin: 'https://api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
  }, new Error('database exposed a secret'), (...values: unknown[]) => { metering.push(values) })
  assert.deepEqual(metering, [[
    '[enterprise-gateway] usage persistence failed',
    {
      modelId: 'model-id',
      upstreamOrigin: 'https://api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      error: {
        name: 'Error',
        code: 'ERR_MODEL_USAGE_PERSISTENCE',
      },
    },
  ]])
  assert.ok(!JSON.stringify(metering).includes('database exposed a secret'))
})
