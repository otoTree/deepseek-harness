import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from 'redis'
import { RedisRateLimiter } from '../src/rate-limit.ts'

const env = parseEnv(readFileSync(new URL('../../../.env.enterprise', import.meta.url), 'utf8'))

void test('Redis limiter isolates tenants and releases concurrent leases', { skip: !env.ENTERPRISE_REDIS_URL }, async () => {
  const client = createClient({ url: env.ENTERPRISE_REDIS_URL })
  await client.connect()
  const prefix = 'dsh:test:' + randomUUID()
  const limiter = new RedisRateLimiter(client, prefix, { requestsPerMinute: 4, concurrentCalls: 1 })
  const subject = { organizationId: 'org-a', accountId: 'user-a', modelId: 'model-a' }
  const first = await limiter.acquire(subject)
  await assert.rejects(() => limiter.acquire(subject), /concurrency limit exceeded/)
  await first.release()
  const second = await limiter.acquire(subject)
  await second.release()
  const third = await limiter.acquire(subject)
  await third.release()
  await assert.rejects(() => limiter.acquire(subject), /rate limit exceeded/)
  const otherTenant = await limiter.acquire({ ...subject, organizationId: 'org-b' })
  await otherTenant.release()
  await client.quit()
})
