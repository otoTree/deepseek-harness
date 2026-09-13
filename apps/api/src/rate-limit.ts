import { createClient, type RedisClientType } from 'redis'
import { HTTPException } from 'hono/http-exception'

/** Limits applied to one model call before it reserves a billing budget. */
export interface RateLimitConfig {
  requestsPerMinute: number
  concurrentCalls: number
}

/** Dimensions used to isolate rate-limit counters. */
export interface RateLimitSubject {
  organizationId: string
  accountId: string
  modelId: string
}

/** A lease that releases one in-flight model call. */
export interface RateLimitLease {
  release(): Promise<void>
}

/** Distributed model-call limiter used by every API instance. */
export interface RateLimiter {
  acquire(subject: RateLimitSubject): Promise<RateLimitLease>
}

const acquireScript = `
local requests = redis.call('INCR', KEYS[1])
if requests == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local concurrent = redis.call('INCR', KEYS[2])
if concurrent == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
if requests > tonumber(ARGV[2]) or concurrent > tonumber(ARGV[3]) then
  redis.call('DECR', KEYS[2])
  return {0, requests, concurrent - 1}
end
return {1, requests, concurrent}
`

const releaseScript = `
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) > 0 then redis.call('DECR', KEYS[1]) end
return 1
`

class Lease implements RateLimitLease {
  private released = false

  public constructor(private readonly client: RedisClientType, private readonly key: string) {}

  public async release(): Promise<void> {
    if (this.released) return
    this.released = true
    await this.client.sendCommand(['EVAL', releaseScript, '1', this.key])
  }
}

/** Redis-backed limiter with atomic request-window and concurrency reservations. */
export class RedisRateLimiter implements RateLimiter {
  public constructor(
    private readonly client: RedisClientType,
    private readonly prefix: string,
    private readonly limits: RateLimitConfig,
  ) {}

  public async acquire(subject: RateLimitSubject): Promise<RateLimitLease> {
    const base = `${this.prefix}:model:${subject.organizationId}:${subject.accountId}:${subject.modelId}`
    const requestKey = `${base}:minute`
    const concurrentKey = `${base}:concurrent`
    const result = await this.client.sendCommand([
      'EVAL', acquireScript, '2', requestKey, concurrentKey,
      '60000', String(this.limits.requestsPerMinute), String(this.limits.concurrentCalls), '180000',
    ]) as unknown
    const values = Array.isArray(result) ? result.map(Number) : []
    if (values[0] !== 1) {
      const requestCount = values[1] ?? 0
      throw new HTTPException(429, {
        message: requestCount > this.limits.requestsPerMinute ? 'Model request rate limit exceeded' : 'Model concurrency limit exceeded',
      })
    }
    return new Lease(this.client, concurrentKey)
  }
}

/** Connect and verify Redis before the HTTP listener starts. */
export async function connectRedisRateLimiter(
  url: string,
  prefix: string,
  limits: RateLimitConfig,
): Promise<{ limiter: RedisRateLimiter; close: () => Promise<void> }> {
  const client = createClient({ url })
  await client.connect()
  await client.ping()
  return { limiter: new RedisRateLimiter(client, prefix, limits), close: async () => { await client.quit() } }
}

/** In-process fallback used only when a deployment deliberately omits Redis. */
export class NoopRateLimiter implements RateLimiter {
  public async acquire(_subject: RateLimitSubject): Promise<RateLimitLease> {
    return { release: async () => {} }
  }
}
