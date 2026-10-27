/** Protected output must retain module behavior and reject source leaks or later replacement. */
import assert from 'node:assert/strict'
import { chmod, link, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { pathToFileURL } from 'node:url'
import { obfuscateJavaScript, protectResources, verifyProtectedResources } from '../scripts/protect-build.ts'

void test('protected ESM preserves imports, public properties, exports and reflective class names', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-protection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'app/node_modules/@deepseek-ai/fixture'), { recursive: true })
  const entry = join(root, 'app/entry.mjs')
  await writeFile(entry, `import { value } from './node_modules/@deepseek-ai/fixture/index.mjs'
export class ExampleService { static publicName = 'example'; answer() { return value + 1 } }
export const result = new ExampleService().answer()
export const surrogate = '\\uD800'
//# sourceMappingURL=entry.mjs.map
`)
  await writeFile(join(root, 'app/node_modules/@deepseek-ai/fixture/index.mjs'), 'export const value = 41\n')
  await writeFile(join(root, 'app/entry.mjs.map'), '{"sourcesContent":["private source"]}')
  await writeFile(join(root, 'app/private.ts'), 'private source\n')
  await writeFile(join(root, 'app/.env.local'), 'PRIVATE=example\n')
  assert.equal(await protectResources(root), 2)
  await verifyProtectedResources(root)
  const plugin = await import(pathToFileURL(entry).href) as {
    ExampleService: { name: string; publicName: string }
    result: number
    surrogate: string
  }
  assert.equal(plugin.result, 42)
  assert.equal(plugin.surrogate, '\uD800')
  assert.equal(plugin.ExampleService.name, 'ExampleService')
  assert.equal(plugin.ExampleService.publicName, 'example')
  assert.doesNotMatch(await readFile(entry, 'utf8'), /sourceMappingURL|private source/)
  for (const name of ['entry.mjs.map', 'private.ts', '.env.local']) {
    const path = join(root, 'app', name)
    await writeFile(path, 'leaked source')
    await assert.rejects(verifyProtectedResources(root), /source or debug files/)
    await rm(path)
  }
  await writeFile(entry, 'export const result = 42\n')
  await assert.rejects(verifyProtectedResources(root), /unprotected or modified/)
})

void test('protection verification rejects newly added or deleted first-party JavaScript', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-protection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const entry = join(root, 'entry.mjs')
  await writeFile(entry, 'export const value = 42\n')
  await protectResources(root)
  const unexpected = join(root, 'extra.js')
  await writeFile(unexpected, 'const secret = 42\n')
  await assert.rejects(verifyProtectedResources(root), /unprotected or modified/)
  await rm(unexpected)
  await rm(entry)
  await assert.rejects(verifyProtectedResources(root), /modules are missing/)
})

void test('protection leaves hard-linked build inputs unchanged and preserves executable permissions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-protection-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.js')
  const resources = join(root, 'Resources')
  await mkdir(resources)
  const code = 'export const value = "shared build input"\n'
  await writeFile(source, code)
  await chmod(source, 0o755)
  const mode = (await stat(source)).mode & 0o777
  const staged = join(resources, 'entry.js')
  await link(source, staged)
  await protectResources(resources)
  await verifyProtectedResources(resources)
  assert.equal(await readFile(source, 'utf8'), code)
  assert.notEqual(await readFile(staged, 'utf8'), code)
  assert.equal((await stat(staged)).mode & 0o777, mode)
})

void test('protected browser registrations remain isolated in one combo script', async () => {
  // Both factories must retain their own strings after all combo registrations.
  const fixtures = [2, 121]
  const filenames = fixtures.map(index => `app/plugins/fixture-${index}/client.js`)
  const handoffs: { id: string; factory: () => unknown }[] = []
  const values: string[] = []
  const expected = fixtures.map(index => Array.from({ length: 40 }, (_value, item) => `fixture-${index}-value-${item}`))
  const codes = await Promise.all(filenames.map((filename, index) => obfuscateJavaScript(
    `window.register('fixture-${fixtures[index]}', ${JSON.stringify(expected[index])}); window.__ModuleLoader__.load({id: 'fixture-${fixtures[index]}', factory: function () { return ${JSON.stringify(expected[index])} } });`,
    filename,
  )))
  runInNewContext(codes.map(code => `${code};\n`).join(''), {
    window: { register: (_id: string, value: unknown) => { values.push(JSON.stringify(value)) },
      __ModuleLoader__: { load: (handoff: { id: string; factory: () => unknown }) => { handoffs.push(handoff) } } },
  }, { timeout: 5_000 })
  assert.deepEqual(values, expected.map(value => JSON.stringify(value)))
  assert.deepEqual(handoffs.map(handoff => handoff.id), ['fixture-2', 'fixture-121'])
  assert.deepEqual(handoffs.map(handoff => JSON.stringify(handoff.factory())), expected.map(value => JSON.stringify(value)))
})

void test('protected browser strings execute without runtime text decoding', async () => {
  const values = Array.from({ length: 40 }, (_, index) => `中文🙂-${index}`)
  values.push('\uD800')
  const code = await obfuscateJavaScript(`window.publish(${JSON.stringify(values)})`, 'app/plugins/text/client.js')
  const observed: string[] = []
  runInNewContext(code, {
    window: { publish: (result: unknown) => { observed.push(JSON.stringify(result)) } },
    decodeURIComponent: () => { throw new Error('runtime text decoding is unavailable') },
  }, { timeout: 5_000 })
  assert.deepEqual(observed, [JSON.stringify(values)])
})
