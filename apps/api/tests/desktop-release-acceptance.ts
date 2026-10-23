/** Isolated publication acceptance through real control-plane authentication and PostgreSQL. */
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import type { TestContext } from 'node:test'
import { configSchema } from '../src/config.ts'
import { connectDatabase } from '../src/database.ts'
import { createApplication } from '../src/application.ts'
import type { DesktopArtifactStore } from '../src/desktop-storage.ts'
import { readDesktopRelease } from '../../electrobun/src/update-manifest.ts'
import { fetchReleaseEnvelope } from '../../electrobun/src/update-download.ts'

/** Exercise publication permissions, exact bytes, immutable versions and concurrent finalization.
 * @param t - Per-database test owner.
 * @param env - Initialized isolated database and bootstrap account, never a production deployment.
 * @returns Completion after all request bodies and resources have settled.
 */
export async function desktopReleaseAcceptance(t: TestContext, env: Record<string, string>): Promise<void> {
  const connection = connectDatabase(env.ENTERPRISE_DATABASE_URL)
  t.after(() => connection.close())
  const keys = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const config = configSchema.parse({ databaseUrl: env.ENTERPRISE_DATABASE_URL,
    authSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), apiUrl: 'https://api.example.com',
    adminOrigin: 'https://admin.example.com', portalOrigin: 'https://api.example.com',
    desktopUpdatePublicKey: publicKey, desktopInstallerMaxBytes: 1024 })
  const objects = new Map<string, Uint8Array>()
  const files: string[] = []
  let failStorage = false
  const store: DesktopArtifactStore = {
    putFile: async (key, file) => {
      files.push(file)
      if (failStorage) throw new Error('Test storage unavailable')
      objects.set(key, await readFile(file))
    },
    read: async key => new ReadableStream({ start(controller) { controller.enqueue(objects.get(key)!); controller.close() } }),
    delete: async (key) => { objects.delete(key) },
  }
  const { app } = createApplication({ db: connection.db, config, mail: async () => {}, desktopArtifacts: store })
  const headers = { 'X-Forwarded-For': '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'), Origin: config.adminOrigin, 'Content-Type': 'application/json' }
  const login = await app.request('/auth/sign-in/email', { method: 'POST', headers,
    body: JSON.stringify({ email: env.ENTERPRISE_BOOTSTRAP_EMAIL, password: env.ENTERPRISE_BOOTSTRAP_PASSWORD }) })
  assert.equal(login.status, 200, await login.clone().text())
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await login.arrayBuffer()
  const adminHeaders = { ...headers, Cookie: cookie }
  const installer = Buffer.from('A complete installer fixture')
  function envelope(version: string, changes = {}) {
    const payload = Buffer.from(JSON.stringify({ format: 1, identifier: 'ai.deepseek.harness.enterprise',
      version, target: 'darwin-arm64', url: `${config.apiUrl}/desktop/updates/darwin-arm64/${version}/installer`,
      size: installer.length, sha256: createHash('sha256').update(installer).digest('hex'), notes: 'Release notes', ...changes }))
    return JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') })
  }
  async function prepare(value: string) {
    const response = await app.request('/v1/platform/desktop-releases', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ envelope: value }) })
    assert.equal(response.status, 201, await response.clone().text())
    return (await response.json() as { id: string }).id
  }
  const upload = (id: string, bytes: Uint8Array = installer) => app.request(`/v1/platform/desktop-releases/${id}/installer`, {
    method: 'PUT', headers: { ...adminHeaders, 'Content-Type': 'application/octet-stream' }, body: bytes,
  })
  const feedPath = '/desktop/updates/darwin-arm64/latest'
  assert.equal((await app.request(feedPath)).status, 204)
  assert.equal(await fetchReleaseEnvelope(config.apiUrl + feedPath, new AbortController().signal,
    (url, init) => app.request(url, init)), undefined)
  assert.equal((await app.request('/v1/platform/desktop-releases')).status, 401)
  const denied = await app.request('/v1/platform/desktop-releases', { method: 'POST', headers, body: '{}' })
  assert.equal(denied.status, 401)
  const member = await app.request('/auth/sign-up/email', { method: 'POST', headers,
    body: JSON.stringify({ name: 'Member', email: 'release-member@example.com', password: 'Member-password-123!' }) })
  assert.equal(member.status, 200, await member.clone().text())
  const memberCookie = member.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await member.arrayBuffer()
  assert.equal((await app.request('/v1/platform/desktop-releases', { headers: { Cookie: memberCookie } })).status, 403)
  for (const [value, status] of [
    ['{}', 400], [envelope('0.2.0', { url: 'https://other.example/installer' }), 400],
    [envelope('0.2.0', { size: 1025 }), 413],
  ] as const) {
    const response = await app.request('/v1/platform/desktop-releases', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ envelope: value }) })
    assert.equal(response.status, status)
  }
  const id = await prepare(envelope('0.2.0'))
  assert.equal((await app.request(`/v1/platform/desktop-releases/${id}/installer`, { method: 'PUT',
    headers: { ...adminHeaders, Origin: 'https://untrusted.example' }, body: installer })).status, 403)
  assert.equal((await upload(id, Buffer.alloc(installer.length))).status, 400)
  assert.equal((await upload(id, installer.subarray(1))).status, 400)
  assert.equal((await upload(id, Buffer.concat([installer, installer]))).status, 413)
  assert.equal((await app.request(feedPath)).status, 204)
  assert.equal(objects.size, 0)
  assert.equal((await upload(id)).status, 200)
  const feed = await app.request(feedPath)
  assert.equal(feed.headers.get('Cache-Control'), 'no-store')
  const release = readDesktopRelease(new Uint8Array(await feed.arrayBuffer()), publicKey, 'darwin-arm64', '0.1.0')!
  assert.equal(release.version, '0.2.0')
  const download = await app.request(release.url)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), installer)
  assert.equal((await upload(id)).status, 409)
  const older = await prepare(envelope('0.1.9'))
  assert.equal((await upload(older)).status, 409)
  assert.equal(objects.size, 1)
  const next = await prepare(envelope('0.3.0'))
  failStorage = true
  assert.equal((await upload(next)).status, 500)
  failStorage = false
  const results = await Promise.all([upload(next), upload(next)])
  assert.deepEqual(results.map(value => value.status).sort(), [200, 409])
  assert.equal(objects.size, 2)
  for (const file of files) await assert.rejects(access(file), { code: 'ENOENT' })
  const newest = await app.request(feedPath)
  const verifiedVersion = readDesktopRelease(new Uint8Array(await newest.arrayBuffer()), publicKey, 'darwin-arm64', '0.2.0')?.version
  assert.equal(verifiedVersion, '0.3.0')
  const listing = await app.request('/v1/platform/desktop-releases', { headers: adminHeaders })
  assert.equal(listing.status, 200)
  const data = await listing.json() as { configured: boolean; releases: { publishedAt: string | null }[] }
  assert.equal(data.configured, true)
  assert.equal(data.releases.filter(row => row.publishedAt).length, 2)
  const outcome = { configured: data.configured, verifiedVersion,
    releases: (data.releases as { version: string; publishedAt: string | null }[])
      .map(row => ({ version: row.version, published: row.publishedAt !== null })).sort((a, b) => a.version.localeCompare(b.version)),
    downloadedSha256: createHash('sha256').update(installer).digest('hex') }
  assert.deepEqual(outcome, JSON.parse(await readFile(new URL('./expected/desktop-publication.json', import.meta.url), 'utf8')))
}
