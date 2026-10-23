import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserOrigins, configSchema } from '../src/config.ts'
import { modelInput } from '../src/contracts.ts'

void test('enterprise API bind host defaults to loopback and allows container networking explicitly', () => {
  const required = {
    databaseUrl: 'postgres://localhost/dsh',
    authSecret: 'a'.repeat(32),
    encryptionKey: 'a'.repeat(64),
    apiUrl: 'http://127.0.0.1:8787',
    adminOrigin: 'http://127.0.0.1:3000',
    portalOrigin: 'http://127.0.0.1:3001',
  }

  assert.equal(configSchema.parse(required).host, '127.0.0.1')
  assert.equal(configSchema.parse(required).loginSessionSeconds, 2_592_000)
  assert.equal(configSchema.parse({ ...required, loginSessionSeconds: 300 }).loginSessionSeconds, 300)
  assert.equal(configSchema.safeParse({ ...required, loginSessionSeconds: 299 }).success, false)
  assert.equal(configSchema.parse({ ...required, host: '0.0.0.0' }).host, '0.0.0.0')
  assert.equal(configSchema.safeParse({ ...required, host: '192.168.1.5' }).success, false)
})

void test('browser origins include localhost aliases only for loopback settings', () => {
  assert.deepEqual(
    browserOrigins({ apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:3000', portalOrigin: 'http://localhost:3001' }),
    ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://127.0.0.1:3000', 'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
  )
  assert.deepEqual(
    browserOrigins({ apiUrl: 'https://api.example.com', adminOrigin: 'https://admin.example.com/console', portalOrigin: 'https://portal.example.com' }),
    ['https://api.example.com', 'https://admin.example.com', 'https://portal.example.com'],
  )
})

void test('model directory accepts advertised high-capacity outputs', () => {
  assert.doesNotThrow(() => modelInput.parse({
    name: 'DeepSeek V4 Flash', baseUrl: 'https://api.deepseek.com', upstreamModel: 'deepseek-flash', apiKey: 'secret',
    inputPriceCnyPerMillion: 1, cachedInputPriceCnyPerMillion: 0.25, outputPriceCnyPerMillion: 2,
    contextTokens: 1_000_000, maxOutputTokens: 384_000,
  }))
})
