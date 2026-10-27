/** Bundled native managers may remove only their registered product in an isolated home. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execute = promisify(execFile)
void test('macOS bundled uninstallers reject another app and preserve the other product in both removal modes', {
  skip: (!process.env.ARIVO_TEST_APP || !process.env.ZHIYU_TEST_APP) && 'Set ARIVO_TEST_APP and ZHIYU_TEST_APP', timeout: 30000,
}, async (t) => {
  const sources = [process.env.ARIVO_TEST_APP, process.env.ZHIYU_TEST_APP]
  assert.ok(sources[0]); assert.ok(sources[1])
  const root = await mkdtemp(join(tmpdir(), 'arivo-uninstall-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const selected of [0, 1]) for (const deleteData of [false, true]) {
    const home = join(root, `${selected}-${deleteData}`)
    const env = { HOME: home, PATH: '/usr/bin:/bin' }
    const products = []
    for (const [index, source] of sources.entries()) {
      assert.ok(source)
      const app = join(home, 'Applications', `${index}.app`)
      const resources = join(app, 'Contents/Resources')
      await mkdir(resources, { recursive: true })
      for (const file of ['version.json', 'uninstall']) await cp(join(source, 'Contents/Resources', file), join(resources, file))
      await cp(join(source, 'Contents/Info.plist'), join(app, 'Contents/Info.plist'))
      const metadata = JSON.parse(await readFile(join(resources, 'version.json'), 'utf8')) as { identifier: string; channel: string }
      const data = join(home, 'Library/Application Support', metadata.identifier, metadata.channel)
      await mkdir(data, { recursive: true })
      await writeFile(join(data, 'sentinel'), 'preserved')
      await execute(join(resources, 'uninstall'), ['--bootstrap-install', data, '--quiet'], { env })
      products.push({ app, data, manager: join(data, 'uninstall') })
    }
    const own = products[selected]!
    const other = products[1 - selected]!
    const manifest = join(own.data, '.electrobun-uninstall.json')
    const original = await readFile(manifest, 'utf8')
    const tampered = JSON.parse(original) as Record<string, unknown>
    tampered.app_bundle_path = other.app
    await writeFile(manifest, JSON.stringify(tampered))
    await assert.rejects(execute(own.manager, ['--uninstall', '--quiet'], { env }))
    assert.equal((await stat(own.app)).isDirectory(), true)
    assert.equal((await stat(other.app)).isDirectory(), true)
    await writeFile(manifest, original)
    await execute(own.manager, deleteData ? ['--quiet', '--delete-data'] : ['--uninstall', '--quiet'], { env })
    await assert.rejects(stat(own.app), { code: 'ENOENT' })
    if (deleteData) await assert.rejects(stat(own.data), { code: 'ENOENT' })
    else assert.equal(await readFile(join(own.data, 'sentinel'), 'utf8'), 'preserved')
    assert.equal((await stat(other.app)).isDirectory(), true)
    assert.equal(await readFile(join(other.data, 'sentinel'), 'utf8'), 'preserved')
    assert.equal((await stat(other.manager)).isFile(), true)
  }
})
