/** Prepare an isolated local dsh profile; never edit a personal Harness home. */
import { mkdirSync, existsSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const profile = join(root, '.artifacts/enterprise/home/profiles/enterprise-api')
mkdirSync(join(profile, 'node_modules/@deepseek-ai'), { recursive: true, mode: 0o700 })
const manifest = {
  name: 'enterprise-api-profile',
  private: true,
  type: 'module',
  dependencies: { '@deepseek-ai/dsh-enterprise-api': 'file:' + join(root, 'apps/api') },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-enterprise-api'], patchReload: 'startup' } },
}
for (const [name, contents] of [
  ['package.json', JSON.stringify(manifest, null, 2) + '\n'],
  ['cordis.patch.yml', '[]\n'],
]) {
  const path = join(profile, name)
  if (existsSync(path) && readFileSync(path, 'utf8') !== contents)
    throw new Error('Refusing to overwrite modified profile file: ' + path)
  if (!existsSync(path)) writeFileSync(path, contents, { flag: 'wx', mode: 0o600 })
}
const link = join(profile, 'node_modules/@deepseek-ai/dsh-enterprise-api')
if (!existsSync(link)) symlinkSync(join(root, 'apps/api'), link, 'dir')
if (realpathSync(link) !== realpathSync(join(root, 'apps/api')))
  throw new Error('Enterprise profile points at another package')
console.log('Prepared isolated enterprise-api profile.')
