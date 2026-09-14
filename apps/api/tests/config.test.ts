import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserOrigins } from '../src/config.ts'
import { modelInput } from '../src/contracts.ts'

void test('browser origins include localhost aliases only for loopback settings', () => {
  assert.deepEqual(
    browserOrigins({ adminOrigin: 'http://127.0.0.1:3000', portalOrigin: 'http://localhost:3001' }),
    ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
  )
  assert.deepEqual(
    browserOrigins({ adminOrigin: 'https://admin.example.com/console', portalOrigin: 'https://portal.example.com' }),
    ['https://admin.example.com', 'https://portal.example.com'],
  )
})

void test('model directory accepts advertised high-capacity outputs', () => {
  assert.doesNotThrow(() => modelInput.parse({
    name: 'DeepSeek V4 Flash', baseUrl: 'https://api.deepseek.com', upstreamModel: 'deepseek-flash', apiKey: 'secret',
    inputMicrosPerMillion: 1, outputMicrosPerMillion: 2, contextTokens: 1_000_000, maxOutputTokens: 384_000,
  }))
})
