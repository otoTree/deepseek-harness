/** Platform-admin publication of signed full installers and anonymous native update feeds. */
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Hono } from 'hono'
import semver from 'semver'
import { z } from 'zod'
import type { Database } from './database.ts'
import type { ApiEnv, Services } from './application.ts'
import type { DesktopArtifactStore } from './desktop-storage.ts'
import { parseSignedDesktopRelease, type DesktopRelease } from './desktop-release.ts'
import { desktopReleases } from './schema.ts'
import { requirePlatform } from './security.ts'

const targetSchema = z.enum(['darwin-arm64', 'win32-x64'])
const releaseId = z.uuid().brand<'DesktopReleaseId'>()

async function* readBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return
      yield chunk.value
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

function readEnvelope(envelope: string, services: Services): { release: DesktopRelease; store: DesktopArtifactStore } {
  const key = services.config.desktopUpdatePublicKey
  const store = services.desktopArtifacts
  if (!key || !store) throw new HTTPException(503, { message: 'Desktop release publishing is not configured' })
  let release: DesktopRelease
  try { release = parseSignedDesktopRelease(Buffer.from(envelope), key) }
  catch { throw new HTTPException(400, { message: 'Invalid desktop release signature or metadata' }) }
  const base = services.config.apiUrl.replace(/\/$/, '')
  const expected = `${base}/desktop/updates/${release.target}/${encodeURIComponent(release.version)}/installer`
  if (release.url !== expected) throw new HTTPException(400, { message: 'Installer URL must use this API and the signed target/version' })
  if (release.size > services.config.desktopInstallerMaxBytes) throw new HTTPException(413, { message: 'Desktop installer exceeds deployment limit' })
  return { release, store }
}

async function latestVersion(db: Pick<Database, 'select'>, target: string) {
  const releases = await db.select({ id: desktopReleases.id, version: desktopReleases.version }).from(desktopReleases)
    .where(and(eq(desktopReleases.target, target), isNotNull(desktopReleases.publishedAt)))
  return releases.sort((left, right) => semver.rcompare(left.version, right.version))[0]
}

/** Mount authenticated uploads and public read-only published releases.
 * @param app - Enterprise application with control-plane session and Origin middleware.
 * @param services - Database, deployment configuration and installer storage.
 */
export function mountDesktopReleases(app: Hono<ApiEnv>, services: Services): void {
  const { db } = services
  app.get('/v1/platform/desktop-releases', async (c) => {
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const rows = await tx.select().from(desktopReleases).orderBy(desc(desktopReleases.createdAt)).limit(100)
      return {
        configured: Boolean(services.config.desktopUpdatePublicKey && services.desktopArtifacts),
        maxBytes: services.config.desktopInstallerMaxBytes,
        releases: rows.map(row => ({ id: row.id, version: row.version, target: row.target,
          createdAt: row.createdAt, publishedAt: row.publishedAt })),
      }
    }))
  })
  app.post('/v1/platform/desktop-releases', async (c) => {
    await db.transaction(tx => requirePlatform(tx, c.get('actor')))
    const input = z.object({ envelope: z.string().max(256 * 1024) }).strict().parse(await c.req.json())
    const { release } = readEnvelope(input.envelope, services)
    const id = releaseId.parse(randomUUID())
    await db.insert(desktopReleases).values({ id, target: release.target, version: release.version,
      envelope: input.envelope, submittedBy: c.get('actor').id })
    return c.json({ id, target: release.target, version: release.version, size: release.size }, 201)
  })
  app.put('/v1/platform/desktop-releases/:id/installer', async (c) => {
    const id = releaseId.parse(c.req.param('id'))
    const row = await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      return (await tx.select().from(desktopReleases).where(eq(desktopReleases.id, id)))[0]
    })
    if (!row) throw new HTTPException(404)
    if (row.publishedAt) throw new HTTPException(409, { message: 'Published installers are immutable' })
    const { release, store } = readEnvelope(row.envelope, services)
    const length = c.req.header('Content-Length')
    if (length !== undefined && Number(length) !== release.size) throw new HTTPException(400, { message: 'Installer size does not match signed metadata' })
    if (!c.req.raw.body) throw new HTTPException(400, { message: 'Installer bytes are required' })
    const directory = await mkdtemp(join(tmpdir(), 'dsh-release-upload-'))
    const file = join(directory, 'installer')
    const key = `desktop/${id}/${randomUUID()}`
    let retainObject = false
    let objectAttempted = false
    try {
      let size = 0
      const hash = createHash('sha256')
      const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > release.size) { callback(new HTTPException(413, { message: 'Installer exceeds signed size' })); return }
        hash.update(chunk)
        callback(null, chunk)
      } })
      await pipeline(Readable.from(readBody(c.req.raw.body)), bounded,
        createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: c.req.raw.signal })
      if (size !== release.size || hash.digest('hex') !== release.sha256) {
        throw new HTTPException(400, { message: 'Installer size or SHA-256 does not match signed metadata' })
      }
      objectAttempted = true
      await store.putFile(key, file)
      c.req.raw.signal.throwIfAborted()
      retainObject = true
      try { await db.transaction(async (tx) => {
        await requirePlatform(tx, c.get('actor'))
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('desktop-release'), hashtext(${release.target}))`)
        const [current] = await tx.select().from(desktopReleases).where(eq(desktopReleases.id, id)).for('update')
        if (!current || current.publishedAt) throw new HTTPException(409, { message: 'Published installers are immutable' })
        const latest = await latestVersion(tx, release.target)
        if (latest && !semver.gt(release.version, latest.version)) {
          throw new HTTPException(409, { message: 'Release version must be greater than the published version' })
        }
        await tx.update(desktopReleases).set({ objectKey: key, publishedAt: new Date() }).where(eq(desktopReleases.id, id))
      }) } catch (error) {
        // A rejected callback cannot commit. A lost commit response leaves its object intact.
        if (error instanceof HTTPException) retainObject = false
        throw error
      }
      return c.json({ id, version: release.version, target: release.target, published: true })
    } finally {
      try { if (objectAttempted && !retainObject) await store.delete(key) }
      finally { await rm(directory, { recursive: true, force: true }) }
    }
  })
  app.get('/desktop/updates/:target/latest', async (c) => {
    const target = targetSchema.parse(c.req.param('target'))
    const version = await latestVersion(db, target)
    c.header('Cache-Control', 'no-store')
    if (!version) return c.body(null, 204)
    const [latest] = await db.select().from(desktopReleases).where(eq(desktopReleases.id, version.id))
    if (!latest) throw new HTTPException(404)
    return c.body(latest.envelope, 200, { 'Content-Type': 'application/json' })
  })
  app.get('/desktop/updates/:target/:version/installer', async (c) => {
    const target = targetSchema.parse(c.req.param('target'))
    const [row] = await db.select().from(desktopReleases).where(and(eq(desktopReleases.target, target),
      eq(desktopReleases.version, c.req.param('version')), isNotNull(desktopReleases.publishedAt))).limit(1)
    if (!row?.objectKey) throw new HTTPException(404)
    const { release, store } = readEnvelope(row.envelope, services)
    return new Response(await store.read(row.objectKey), { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(release.size),
      'Content-Disposition': `attachment; filename="desktop-${release.version}-${target}.${target === 'darwin-arm64' ? 'dmg' : 'zip'}"`,
      'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    } })
  })
}
