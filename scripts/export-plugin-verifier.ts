/** Export the public ZIP verifier for another product; versions are immutable once exported. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const [version, destination] = process.argv.slice(2)
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !destination) throw new Error('Usage: export-plugin-verifier.ts <version> <output-directory> [--check]')
const out = resolve(destination), base = `arivo-plugin-package-${version}`, archive = join(out, base + '.tgz'), receipt = join(out, base + '.json')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sources: Record<string, string> = {}
for (const file of ['packages/plugin/protocol/src/index.ts', 'packages/plugin/protocol/src/types.ts', 'packages/plugin/protocol/src/archive.ts', 'packages/util/brand/src/index.ts', 'scripts/export-plugin-verifier.ts', 'LICENSE']) sources[file] = digest(await readFile(join(root, file)))
if (process.argv.includes('--check')) {
  const recorded = JSON.parse(await readFile(receipt, 'utf8')) as { sources: Record<string, string>; sha256: string }
  if (JSON.stringify(recorded.sources) !== JSON.stringify(sources) || recorded.sha256 !== digest(await readFile(archive))) throw new Error('Verifier source or artifact digest has changed; export a new version')
  console.info(`Verified immutable archive ${base}`)
} else {
  await mkdir(out, { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-verifier-export-'))
  try {
    const pkg = join(temporary, 'package'); await mkdir(pkg)
    execFileSync('pnpm', ['exec', 'esbuild', join(root, 'packages/plugin/protocol/src/archive.ts'), '--bundle', '--platform=node', '--format=esm', '--target=node22', '--minify', `--outfile=${join(pkg, 'index.mjs')}`], { cwd: join(root, 'apps/electrobun'), stdio: 'inherit' })
    // Preserve the public declaration closure without importing another repository's source.
    const declarations = [
      ['packages/plugin/protocol/lib/types/archive.d.ts', 'index.d.ts'],
      ['packages/plugin/protocol/lib/types/index.d.ts', 'protocol.d.ts'],
      ['packages/plugin/protocol/lib/types/types.d.ts', 'types.d.ts'],
      ['packages/util/brand/lib/types/index.d.ts', 'brand.d.ts'],
    ] as const
    for (const [source, target] of declarations) {
      const declaration = (await readFile(join(root, source), 'utf8'))
        .replaceAll("'./index.ts'", "'./protocol.js'")
        .replaceAll("'./types.ts'", "'./types.js'")
        .replaceAll("'@deepseek-ai/dsh-brand'", "'./brand.js'")
        .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
      await writeFile(join(pkg, target), declaration)
    }
    await copyFile(join(root, 'LICENSE'), join(pkg, 'LICENSE'))
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@arivo/plugin-package', version, type: 'module', exports: { '.': { types: './index.d.ts', default: './index.mjs' } }, dependencies: { zod: '^4.3.6' }, license: 'MIT' }) + '\n')
    execFileSync('tar', ['-czf', join(temporary, base + '.tgz'), '-C', temporary, 'package'])
    const bytes = await readFile(join(temporary, base + '.tgz'))
    await writeFile(archive, bytes, { flag: 'wx' })
    await writeFile(receipt, JSON.stringify({ name: '@arivo/plugin-package', version, sources, sha256: digest(bytes) }, null, 2) + '\n', { flag: 'wx' })
    console.info(`Exported ${base}`)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
