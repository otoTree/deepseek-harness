import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { discoverLocalPluginPackages, readLocalPluginPackage } from '../src/local-plugin-packages.ts'

void describe('local plugin workspace discovery', () => {
  void it('returns only verified dist ZIP artifacts and reads them through the same gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-local-plugins-'))
    const dist = join(root, 'enterprise.acceptance', 'dist')
    await mkdir(dist, { recursive: true })
    const source = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/plugin/acceptance/dist/enterprise-acceptance-1.0.0.dsh-plugin.zip')
    const target = join(dist, 'enterprise-acceptance-1.0.0.dsh-plugin.zip')
    await cp(source, target)
    await writeFile(join(root, 'README.md'), 'source files are ignored')
    const packages = await discoverLocalPluginPackages(root)
    assert.equal(packages.length, 1)
    assert.equal(packages[0]?.pluginId, 'enterprise.acceptance')
    assert.deepEqual([...await readLocalPluginPackage(root, target)], [...await readLocalPluginPackage(root, target)])
    await assert.rejects(() => readLocalPluginPackage(root, join(root, 'README.md')))
  })
})
