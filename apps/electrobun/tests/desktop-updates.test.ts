/** Signed feeds, streamed installers and native update/quit ordering. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DesktopUpdates, type UpdateDialog } from '../src/desktop-updates.ts'
import { readDesktopRelease, resolveDesktopUpdates, type DesktopRelease } from '../src/update-manifest.ts'
import { downloadDesktopRelease, fetchReleaseEnvelope, type UpdateFetch } from '../src/update-download.ts'
import { DesktopShutdown } from '../src/shutdown.ts'
import { updateMessages } from '../src/messages.ts'
import { prepareDesktopInstaller } from '../src/update-installer.ts'

const { privateKey, publicKey: key } = generateKeyPairSync('ed25519')
const publicKey = key.export({ type: 'spki', format: 'der' }).toString('base64')
const config = { url: 'https://updates.example.test/latest.json', publicKey }
const installer = Buffer.from('fixture full installer')
const release: DesktopRelease = {
  format: 1, identifier: 'ai.deepseek.harness.enterprise', version: '0.2.0', target: 'darwin-arm64',
  url: 'https://downloads.example.test/client.dmg', size: installer.length,
  sha256: createHash('sha256').update(installer).digest('hex'), notes: 'Release notes',
}

function envelope(value: unknown = release): Buffer {
  const payload = Buffer.from(JSON.stringify(value))
  return Buffer.from(JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }))
}

const request: UpdateFetch = async input => new Response(
  new Uint8Array(input === config.url ? envelope() : installer),
)

void test('release signature, identity, target and semantic version select the authenticated update', () => {
  assert.deepEqual(resolveDesktopUpdates(config.url, publicKey), config)
  assert.equal(resolveDesktopUpdates(undefined, undefined), undefined)
  assert.throws(() => resolveDesktopUpdates(config.url, undefined), /both/)
  assert.throws(() => resolveDesktopUpdates('http://updates.example.test', publicKey), /HTTPS/)
  assert.throws(() => resolveDesktopUpdates('https://user:pass@updates.example.test', publicKey), /credentials/)
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  assert.throws(() => resolveDesktopUpdates(config.url, rsa), /Ed25519/)
  assert.deepEqual(readDesktopRelease(envelope(), publicKey, release.target, '0.1.3-alpha.1'), release)
  assert.equal(readDesktopRelease(envelope(), publicKey, release.target, '0.2.0'), undefined)
  assert.equal(readDesktopRelease(envelope(), publicKey, release.target, '0.3.0'), undefined)
  assert.ok(readDesktopRelease(envelope({ ...release, version: '0.2.0-beta.10' }), publicKey, release.target, '0.2.0-beta.9'))
  assert.throws(() => readDesktopRelease(envelope(), publicKey, 'win32-x64', '0.1.0'), /target/)
  for (const change of [
    { identifier: 'other-app' }, { format: 2 }, { version: 'invalid' }, { url: 'http://downloads.example.test' },
    { size: 0 }, { sha256: 'invalid' }, { notes: '' },
  ]) {
    assert.throws(() => readDesktopRelease(envelope({ ...release, ...change }), publicKey, release.target, '0.1.0'))
  }
  const tampered = JSON.parse(envelope().toString()) as { payload: string; signature: string }
  tampered.payload = Buffer.from(JSON.stringify({ ...release, url: 'https://attacker.example.test/client.dmg' })).toString('base64')
  assert.throws(() => readDesktopRelease(Buffer.from(JSON.stringify(tampered)), publicKey, release.target, '0.1.0'), /signature/)
  const otherKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  assert.throws(() => readDesktopRelease(envelope(), otherKey, release.target, '0.1.0'), /signature/)
})

void test('HTTPS redirects are bounded and cannot downgrade; manifests cannot grow without limit', async () => {
  const seen: string[] = []
  const redirect: UpdateFetch = async (url, init) => {
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'manual')
    seen.push(url)
    return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/feed' } }) : new Response(new Uint8Array(envelope()))
  }
  assert.deepEqual(await fetchReleaseEnvelope(config.url, new AbortController().signal, redirect), envelope())
  assert.equal(seen.length, 2)
  await assert.rejects(fetchReleaseEnvelope(config.url, new AbortController().signal, async () =>
    new Response(null, { status: 302, headers: { location: 'http://insecure.example.test' } })), /HTTPS/)
  await assert.rejects(fetchReleaseEnvelope(config.url, new AbortController().signal, async () =>
    new Response(null, { status: 302, headers: { location: '/loop' } })), /redirects/)
  await assert.rejects(fetchReleaseEnvelope(config.url, new AbortController().signal, async () =>
    new Response(Buffer.alloc(256 * 1024 + 1))), /256 KiB/)
  await assert.rejects(fetchReleaseEnvelope(config.url, new AbortController().signal, async () => new Response('failure', { status: 503 })), /failed/)
})

void test('streaming download verifies hash and signed size, removes failures and refuses existing files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-update-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'installer.dmg')
  const signal = new AbortController().signal
  await downloadDesktopRelease(release, path, signal, request)
  assert.deepEqual(await readFile(path), installer)
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
  await assert.rejects(downloadDesktopRelease(release, path, signal, request), /EEXIST/)
  assert.deepEqual(await readFile(path), installer)
  await rm(path)
  for (const invalid of [
    { ...release, sha256: '0'.repeat(64) }, { ...release, size: installer.length - 1 }, { ...release, size: installer.length + 1 },
  ]) {
    await assert.rejects(downloadDesktopRelease(invalid, path, signal, request), /size|SHA-256/)
    assert.deepEqual(await readdir(root), [])
  }
})

void test('cancellation waits for streaming teardown and removes the partial installer', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-update-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const entered = Promise.withResolvers<undefined>()
  const controller = new AbortController()
  const transfer = downloadDesktopRelease(release, join(root, 'partial'), controller.signal, async (_input, init) => {
    return new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(installer.subarray(0, 2))
        init?.signal?.addEventListener('abort', () => { stream.error(init.signal?.reason) }, { once: true })
        entered.resolve(undefined)
      },
    }))
  })
  const rejection = assert.rejects(transfer)
  await entered.promise
  controller.abort()
  await rejection
  assert.deepEqual(await readdir(root), [])
})

void test('native update dialogs and Runtime-before-installer ordering match owner-local expected output', async (t) => {
  const actual: unknown[] = []
  let artifact: string | undefined
  const shutdown = new DesktopShutdown(async () => {
    await updates.stop()
    actual.push('runtime-stopped')
  }, () => { actual.push('quit') }, (error) => { throw error })
  const updates = new DesktopUpdates(config, '0.1.3-alpha.1', release.target, updateMessages.en, {
    available: () => {},
    dialog: async (dialog) => { actual.push(dialog); return { response: 1 } },
    notify: (text) => { actual.push(text) },
    prepare: async (path, metadata, signal) => {
      artifact = path
      assert.deepEqual(await readFile(path), installer)
      return prepareDesktopInstaller(path, metadata, signal)
    },
    install: path => shutdown.shutdown(() => { assert.equal(path, artifact); actual.push('open-installer') }),
  }, request)
  t.after(async () => { if (artifact) await rm(dirname(artifact), { recursive: true, force: true }) })
  const first = updates.check()
  assert.equal(updates.check(), first)
  await first
  const expected = JSON.parse(await readFile(new URL('expected/desktop-update.json', import.meta.url), 'utf8')) as unknown
  assert.deepEqual(actual, expected)
  assert.deepEqual(await readFile(artifact!), installer)
})

void test('quit while the ready dialog is pending prevents installation and clears the download', async () => {
  const entered = Promise.withResolvers<undefined>()
  const answer = Promise.withResolvers<{ response: number }>()
  let path = ''
  let installs = 0
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => {},
    dialog: async (dialog) => {
      if (dialog.message === 'Version 0.2.0 is ready to install.') { entered.resolve(undefined); return answer.promise }
      return { response: 1 }
    },
    notify: () => {}, prepare: async (artifact) => { path = artifact; return artifact },
    install: async () => { installs++ },
  }, request)
  const checking = updates.check()
  await entered.promise
  await updates.stop()
  await assert.rejects(stat(path), /ENOENT/)
  answer.resolve({ response: 1 })
  await checking
  assert.equal(installs, 0)
  await updates.check()
  assert.equal(installs, 0)
})

void test('failed integrity remains retryable and never prepares or installs an artifact', async () => {
  const dialogs: UpdateDialog[] = []
  let preparations = 0
  let installs = 0
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.zh, {
    available: () => {},
    dialog: async (dialog) => { dialogs.push(dialog); return { response: 1 } }, notify: () => {},
    prepare: async (path) => { preparations++; return path }, install: async () => { installs++ },
  }, async url => new Response(url === config.url ? new Uint8Array(envelope()) : 'corrupt'))
  await updates.check()
  await updates.check()
  assert.equal(preparations, 0)
  assert.equal(installs, 0)
  assert.equal(dialogs.filter(value => value.message === updateMessages.zh.failed).length, 2)
  await updates.stop()
})

void test('unconfigured and current builds inform the user without downloading', async () => {
  for (const [settings, version, expected] of [
    [undefined, '0.1.0', updateMessages.en.unconfigured], [config, '0.2.0', 'Version 0.2.0 is up to date.'],
  ] as const) {
    const dialogs: UpdateDialog[] = []
    const updates = new DesktopUpdates(settings, version, release.target, updateMessages.en, {
      available: () => {},
      dialog: async (value) => { dialogs.push(value); return { response: 0 } }, notify: () => {},
      prepare: async () => { throw new Error('Unexpected preparation') }, install: async () => { throw new Error('Unexpected installation') },
    }, request)
    await updates.check()
    assert.equal(dialogs.length, 1)
    assert.equal(dialogs[0]?.message, expected)
    await updates.stop()
  }
})

void test('release key and signing commands emit a verifiable platform feed and refuse overwriting it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifact = join(root, 'installer.zip')
  const notes = join(root, 'notes.txt')
  const output = join(root, 'latest.json')
  await writeFile(artifact, installer)
  await writeFile(notes, release.notes)
  const tsx = createRequire(import.meta.url).resolve('tsx/cli')
  const generated = await promisify(execFile)(process.execPath, [tsx,
    fileURLToPath(new URL('../scripts/create-update-key.ts', import.meta.url)), '--directory', root])
  const keyDirectory = generated.stdout.trim()
  assert.equal(dirname(keyDirectory), root)
  const keyPath = join(keyDirectory, 'release-private.pem')
  const generatedPublicKey = (await readFile(join(keyDirectory, 'release-public.txt'), 'utf8')).trim()
  if (process.platform !== 'win32') {
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600)
    assert.equal((await stat(keyDirectory)).mode & 0o777, 0o700)
  }
  const args = [tsx,
    fileURLToPath(new URL('../scripts/sign-update.ts', import.meta.url)),
    '--artifact', artifact, '--url', 'https://downloads.example.test/installer.zip', '--target', 'win32-x64',
    '--notes', notes, '--key', keyPath, '--output', output]
  const { stdout } = await promisify(execFile)(process.execPath, args)
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.match(stdout, /Signed win32-x64 desktop release/)
  const signed = readDesktopRelease(await readFile(output), generatedPublicKey, 'win32-x64', '0.0.0')
  assert.equal(signed?.version, version)
  assert.equal(signed?.sha256, release.sha256)
  assert.equal(signed?.size, installer.length)
  assert.equal(signed?.notes, release.notes)
  await assert.rejects(promisify(execFile)(process.execPath, args), /EEXIST/)
})

void test('quit aborts an active feed read and awaits its terminal response', async () => {
  const entered = Promise.withResolvers<undefined>()
  let settled = false
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => {},
    dialog: async () => { throw new Error('No dialog after quit') }, notify: () => {},
    prepare: async () => { throw new Error('No preparation after quit') },
    install: async () => { throw new Error('No installation after quit') },
  }, async (_url, init) => {
    entered.resolve(undefined)
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { settled = true; reject(new Error('Cancelled update request')) }, { once: true })
    })
  })
  const checking = updates.check()
  await entered.promise
  await updates.stop()
  assert.equal(settled, true)
  await checking
})

void test('cancelled download settles before another check can prepare a fresh installer', async () => {
  const entered = Promise.withResolvers<undefined>()
  let transfers = 0
  let preparations = 0
  let downloaded = ''
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => {},
    dialog: async dialog => ({ response: dialog.message === 'Version 0.2.0 is available.' ? 1 : 0 }),
    notify: () => {}, prepare: async (path) => { preparations++; downloaded = path; return path },
    install: async () => { throw new Error('Installation was declined') },
  }, async (url, init) => {
    if (url === config.url) return new Response(new Uint8Array(envelope()))
    if (++transfers > 1) return new Response(new Uint8Array(installer))
    return new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        init?.signal?.addEventListener('abort', () => { stream.error(new Error('Cancelled download')) }, { once: true })
        entered.resolve(undefined)
      },
    }))
  })
  const checking = updates.check()
  await entered.promise
  updates.cancel()
  await checking
  assert.equal(preparations, 0)
  await updates.check()
  assert.equal(transfers, 2)
  assert.equal(preparations, 1)
  await assert.rejects(stat(downloaded), /ENOENT/)
  await updates.stop()
})

void test('failed installer opening stays visible after shutdown cancels update I/O', async () => {
  const dialogs: UpdateDialog[] = []
  let artifact = ''
  let quits = 0
  const shutdown = new DesktopShutdown(async () => { await updates.stop() }, () => { quits++ }, () => {})
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => {},
    dialog: async (dialog) => { dialogs.push(dialog); return { response: 1 } }, notify: () => {},
    prepare: async (path) => { artifact = path; return path },
    install: () => shutdown.shutdown(() => { throw new Error('Native open failed') }),
  }, request)
  await updates.check()
  assert.equal(dialogs.at(-1)?.message, updateMessages.en.failed)
  assert.equal(quits, 0)
  await assert.rejects(stat(artifact), /ENOENT/)
  await shutdown.shutdown()
  assert.equal(quits, 1)
})

void test('an empty published feed reports the current build without installer access', async () => {
  const dialogs: UpdateDialog[] = []
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => {},
    dialog: async (value) => { dialogs.push(value); return { response: 0 } }, notify: () => {},
    prepare: async () => assert.fail('An empty feed cannot prepare an installer'),
    install: async () => assert.fail('An empty feed cannot install'),
  }, async (url) => { assert.equal(url, config.url); return new Response(null, { status: 204 }) })
  await updates.check()
  assert.equal(dialogs[0]?.message, updateMessages.en.current.replace('{version}', '0.1.0'))
  await updates.stop()
})

void test('startup discovery publishes a verified version once without dialogs or downloads and dismissal lasts for the launch', async () => {
  const versions: Array<string | null> = []
  let requests = 0
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: (value) => { versions.push(value) },
    dialog: async () => assert.fail('Startup must not open a dialog'),
    notify: () => assert.fail('Startup must not show progress notifications'),
    prepare: async () => assert.fail('Startup must not download an installer'),
    install: async () => assert.fail('Startup must not install'),
  }, async (url) => {
    assert.equal(url, config.url)
    requests++
    return new Response(new Uint8Array(envelope()))
  })
  try {
    const first = updates.checkAtStartup()
    assert.equal(updates.checkAtStartup(), first)
    await first
    assert.equal(updates.availableVersion, release.version)
    assert.deepEqual(versions, [release.version])
    updates.dismissNotification()
    await updates.checkAtStartup()
    assert.equal(updates.availableVersion, null)
    assert.deepEqual(versions, [release.version, null])
    assert.equal(requests, 1)
  } finally { await updates.stop() }
})

void test('startup discovery is silent for unconfigured, current, empty, unreachable and invalid feeds', async () => {
  for (const [settings, version, response] of [
    [undefined, '0.1.0', () => assert.fail('Unconfigured startup cannot request')],
    [config, release.version, () => new Response(new Uint8Array(envelope()))],
    [config, '0.1.0', () => new Response(null, { status: 204 })],
    [config, '0.1.0', () => { throw new Error('Offline') }],
    [config, '0.1.0', () => new Response('invalid signature')],
    [config, '0.1.0', () => new Response(new Uint8Array(envelope({ ...release, target: 'win32-x64' })))],
  ] as const) {
    const updates = new DesktopUpdates(settings, version, release.target, updateMessages.en, {
      available: () => assert.fail('No verified newer version'),
      dialog: async () => assert.fail('No startup dialog'), notify: () => assert.fail('No startup notification'),
      prepare: async () => assert.fail('No startup download'), install: async () => assert.fail('No startup install'),
    }, async () => response())
    try {
      await updates.checkAtStartup()
      assert.equal(updates.availableVersion, null)
    } finally { await updates.stop() }
  }
})

void test('manual checks wait for startup discovery and still open the shared update interaction', async () => {
  const feed = Promise.withResolvers<Response>()
  let reads = 0
  let dialogs = 0
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => {}, notify: () => {},
    dialog: async () => { dialogs++; return { response: 0 } },
    prepare: async () => assert.fail('Download declined'), install: async () => assert.fail('Install declined'),
  }, async () => ++reads === 1 ? feed.promise : new Response(new Uint8Array(envelope())))
  const startup = updates.checkAtStartup()
  const first = updates.check()
  const second = updates.check()
  try {
    assert.equal(reads, 1)
    assert.equal(dialogs, 0)
    feed.resolve(new Response(new Uint8Array(envelope())))
    await Promise.all([startup, first, second])
    assert.equal(reads, 2)
    assert.equal(dialogs, 1)
    assert.equal(updates.availableVersion, null)
  } finally {
    feed.resolve(new Response(null, { status: 204 }))
    await updates.stop()
    await Promise.all([startup, first, second])
  }
})

void test('quit drains startup discovery and prevents a late notification or queued manual dialog', async () => {
  const entered = Promise.withResolvers<undefined>()
  let settled = false
  const updates = new DesktopUpdates(config, '0.1.0', release.target, updateMessages.en, {
    available: () => assert.fail('No notification after quit'),
    dialog: async () => assert.fail('No dialog after quit'), notify: () => assert.fail('No notification after quit'),
    prepare: async () => assert.fail('No preparation after quit'), install: async () => assert.fail('No install after quit'),
  }, async (_url, init) => {
    entered.resolve(undefined)
    return new Promise<Response>((resolve) => {
      init?.signal?.addEventListener('abort', () => { settled = true; resolve(new Response(new Uint8Array(envelope()))) }, { once: true })
    })
  })
  const startup = updates.checkAtStartup()
  const manual = updates.check()
  try {
    await entered.promise
    await updates.stop()
    await Promise.all([startup, manual])
    assert.equal(settled, true)
    assert.equal(updates.availableVersion, null)
  } finally { await updates.stop(); await Promise.all([startup, manual]) }
})
