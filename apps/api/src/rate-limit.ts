import { createClient, type RedisClientType } from 'redis'
import { HTTPException } from 'hono/http-exception'
import { randomUUID } from 'node:crypto'

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

/** Redis-backed installation cache used by plugin capability calls. */
export interface PluginCacheStore {
  get(namespace: string, key: string): Promise<{ value: unknown; version: string } | undefined>
  set(namespace: string, key: string, value: unknown, options?: { ttlSeconds?: number; ifVersion?: string }): Promise<{ version: string }>
  delete(namespace: string, key: string): Promise<void>
  increment(namespace: string, key: string, amount: number, ttlSeconds?: number): Promise<number>
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

/** Namespaced cache implementation. Values and versions are stored separately so conditional writes are atomic. */
export class RedisPluginCache implements PluginCacheStore {
  public constructor(private readonly client: RedisClientType, private readonly prefix: string) {}

  private key(namespace: string, key: string): string { return `${this.prefix}:plugin:${namespace}:${key}` }
  private versionKey(namespace: string, key: string): string { return `${this.key(namespace, key)}:version` }

  public async get(namespace: string, key: string): Promise<{ value: unknown; version: string } | undefined> {
    const value = await this.client.get(this.key(namespace, key))
    if (value === null) return undefined
    const version = await this.client.get(this.versionKey(namespace, key))
    try { return { value: JSON.parse(value) as unknown, version: version ?? '' } }
    catch { return undefined }
  }

  public async set(
    namespace: string,
    key: string,
    value: unknown,
    options: { ttlSeconds?: number; ifVersion?: string } = {},
  ): Promise<{ version: string }> {
    const valueKey = this.key(namespace, key)
    const versionKey = this.versionKey(namespace, key)
    const version = randomUUID()
    const encoded = JSON.stringify(value)
    const ttl = options.ttlSeconds === undefined ? 0 : Math.max(1, Math.floor(options.ttlSeconds))
    const result = await this.client.sendCommand([
      'EVAL', `local expected=ARGV[1]
local current=redis.call('GET', KEYS[2])
if expected ~= '' and current ~= expected then return 0 end
if ARGV[4] == '0' then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
else
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
end
return 1`, '2', valueKey, versionKey, options.ifVersion ?? '', encoded, version, String(ttl),
    ])
    if (Number(result) !== 1) throw new Error('plugin/cache-conflict')
    return { version }
  }

  public async delete(namespace: string, key: string): Promise<void> {
    await this.client.sendCommand(['DEL', this.key(namespace, key), this.versionKey(namespace, key)])
  }

  public async increment(namespace: string, key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const valueKey = this.key(namespace, key)
    const result = await this.client.incrBy(valueKey, amount)
    await this.client.set(
      this.versionKey(namespace, key),
      randomUUID(),
      ttlSeconds === undefined ? undefined : { EX: Math.max(1, Math.floor(ttlSeconds)) },
    )
    if (ttlSeconds !== undefined) await this.client.expire(valueKey, Math.max(1, Math.floor(ttlSeconds)))
    return result
  }
}

/** Connect and verify Redis before the HTTP listener starts. */
export async function connectRedisRateLimiter(
  url: string,
  prefix: string,
  limits: RateLimitConfig,
): Promise<{ limiter: RedisRateLimiter; pluginCache: RedisPluginCache; close: () => Promise<void> }> {
  const client = createClient({ url })
  await client.connect()
  await client.ping()
  return {
    limiter: new RedisRateLimiter(client, prefix, limits),
    pluginCache: new RedisPluginCache(client, prefix),
    close: async () => { await client.quit() },
  }
}

/** In-process fallback used only when a deployment deliberately omits Redis. */
export class NoopRateLimiter implements RateLimiter {
  public acquire(_subject: RateLimitSubject): Promise<RateLimitLease> {
    return Promise.resolve({ release: () => Promise.resolve() })
  }
}
