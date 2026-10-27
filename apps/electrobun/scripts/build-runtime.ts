/** Prepare published CLI dependencies and the desktop runtime executable. */
import { execFileSync } from 'node:child_process'
import { access, cp, glob, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { capturePnpm, runPnpm } from './run-pnpm.ts'
import { desktopProductDirectories, resolveDesktopDistribution } from '../src/distribution/config.ts'
import { compileWindowsNative } from './compile-windows-native.ts'

if (!((process.platform === 'darwin' && process.arch === 'arm64')
  || (process.platform === 'win32' && process.arch === 'x64'))) {
  throw new Error('The enterprise desktop runtime supports Apple Silicon macOS and x64 Windows hosts')
}
const source = resolve(process.cwd(), '../cli/lib/bin.js')
const release = process.argv.includes('--release')
const product = resolveDesktopDistribution(process.env.DSH_DESKTOP_DISTRIBUTION)
const productBuild = desktopProductDirectories(product).build
const outputRoot = resolve(process.cwd(), release ? `${productBuild}/local-installer/inputs` : productBuild)
const executableName = process.platform === 'win32' ? 'dsh.exe' : 'dsh'
const output = join(outputRoot, executableName)
await access(source, constants.R_OK)
await mkdir(dirname(output), { recursive: true })
const runtimeTree = join(outputRoot, 'runtime-tree')
await rm(runtimeTree, { recursive: true, force: true })
const deploymentArgs = [
  '--filter', '@deepseek-ai/dsh', 'deploy', '--legacy', '--prod',
  '--config.node-linker=hoisted', '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true', runtimeTree,
]
const hook = join(outputRoot, 'deploy.pnpmfile.cjs')
const workspaceCopies = new Map<string, string>()
// Both development and installer profiles dynamically load the same Host plugins.
// CLI-only deployment omits their peers and produces an unlaunchable desktop bundle.
{
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { dependencies: Record<string, string> }
  const packages = JSON.parse(capturePnpm(['-r', 'list', '--depth', '-1', '--json'], {
    cwd: process.cwd(), env: process.env,
  })) as { name: string; path: string }[]
  const workspace = new Map(await Promise.all(packages.map(async entry => [entry.name,
    JSON.parse(await readFile(join(entry.path, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      files?: string[]
    },
  ] as const)))
  // Account validation and source-only desktop dependencies are bundled into the native main process.
  const selectedDependencies = product.id === 'zhiyu' ? manifest.dependencies : { '@deepseek-ai/dsh-enterprise-client': 'workspace:*' }
  const dependencies = Object.fromEntries(Object.entries(selectedDependencies).filter(([name]) =>
    name !== 'electrobun' && name !== '@deepseek-ai/dsh-client-ui-enterprise-account'
      && (!workspace.has(name) || workspace.get(name)!.files?.length),
  ))
  const pending = ['@deepseek-ai/dsh', ...Object.keys(dependencies)]
  const visited = new Set<string>()
  while (pending.length) {
    const name = pending.pop()!
    if (visited.has(name) || !workspace.has(name)) continue
    visited.add(name)
    if (name !== '@deepseek-ai/dsh') {
      dependencies[name] = 'workspace:*'
      workspaceCopies.set(name, packages.find(entry => entry.name === name)!.path)
    }
    const pkg = workspace.get(name)!
    // The enterprise client bundles API contracts; the server app is not a runtime dependency.
    const runtimeDependencies = Object.keys(pkg.dependencies ?? {}).filter(dependency =>
      name !== '@deepseek-ai/dsh-enterprise-client' || dependency !== '@deepseek-ai/dsh-enterprise-api')
    pending.push(...runtimeDependencies, ...Object.keys(pkg.peerDependencies ?? {}))
  }
  // The packaged desktop supplies workspace peers for its CLI and dynamically loaded plugins.
  await writeFile(hook, `module.exports = { hooks: { readPackage(pkg) {
    if (pkg.name === '@deepseek-ai/dsh') pkg.dependencies = { ...pkg.dependencies, ...${JSON.stringify(dependencies)} };
    if (pkg.name === '@deepseek-ai/dsh-enterprise-client') delete pkg.dependencies['@deepseek-ai/dsh-enterprise-api'];
    return pkg;
  } } };\n`)
  deploymentArgs.push(`--config.pnpmfile=${hook}`)
}
try {
  runPnpm(deploymentArgs, { cwd: process.cwd() })
} finally {
  await rm(hook, { force: true })
  // Legacy deploy records its dependency selection in workspace state, including on failure.
  runPnpm(['install', '--ignore-scripts'], { cwd: process.cwd() })
}
// Stage each selected workspace package from its published files; hoisting may omit peer roots.
for (const [name, source] of workspaceCopies) {
  const destination = join(runtimeTree, 'node_modules', name)
  await rm(destination, { recursive: true, force: true })
  await mkdir(dirname(destination), { recursive: true })
  await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
}
async function materialize(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name === '.bin') {
      await rm(path, { recursive: true, force: true })
    } else if (entry.isSymbolicLink()) {
      const source = await realpath(path)
      const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { files?: string[] }
      if (!manifest.files?.length) throw new Error(`Linked runtime package ${source} must declare published files`)
      await rm(path)
      await mkdir(path, { recursive: true })
      // Workspace links must include only published files, never local builds,
      // nested checkouts, or development dependencies from the source package.
      for await (const file of glob(['package.json', 'README*', 'LICENSE*', ...manifest.files], { cwd: source })) {
        const destination = join(path, file)
        await mkdir(dirname(destination), { recursive: true })
        await cp(join(source, file), destination, {
          recursive: true, dereference: true,
          filter: candidate => !candidate.split(sep).includes('node_modules'),
        })
      }
      await materialize(path)
    } else if (entry.isDirectory()) await materialize(path)
  }
}
// The executable runtime does not publish repository documentation links.
for (const file of await readdir(runtimeTree)) {
  if (/^README(?:\..*)?$/i.test(file)) await rm(join(runtimeTree, file))
}
await materialize(join(runtimeTree, 'node_modules'))
if (release) {
  const runtime = join(outputRoot, 'runtime')
  await rm(runtime, { recursive: true, force: true })
  await cp(join(runtimeTree, 'lib'), runtime, { recursive: true })
  await cp(resolve('../cli/package.json'), join(runtime, 'package.json'))
  // Official Node distributions avoid local runtime dependencies and match the build host's ABI.
  const distribution = `node-${process.version}-${process.platform === 'win32' ? 'win-x64' : 'darwin-arm64'}`
  const archiveName = `${distribution}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
  const origin = `https://nodejs.org/dist/${process.version}/`
  const checksumCache = join(outputRoot, '..', `SHASUMS256-${process.version}.txt`)
  let checksums: string
  if (existsSync(checksumCache)) checksums = await readFile(checksumCache, 'utf8')
  else {
    const response = await fetch(new URL('SHASUMS256.txt', origin), { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Cannot download Node checksums: ${response.status}`)
    checksums = await response.text()
  }
  const expected = checksums.split('\n').find(line => line.endsWith(`  ${archiveName}`))?.split(' ')[0]
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing official Node checksum for ${archiveName}`)
  if (!existsSync(checksumCache)) {
    const temporary = `${checksumCache}.${randomUUID()}.tmp`
    try { await writeFile(temporary, checksums, { flag: 'wx' }); await rename(temporary, checksumCache) }
    finally { await rm(temporary, { force: true }) }
  }
  const archive = join(outputRoot, '..', archiveName)
  if (!existsSync(archive)) {
    const download = await fetch(new URL(archiveName, origin), { signal: AbortSignal.timeout(120000) })
    if (!download.ok) throw new Error(`Cannot download Node runtime: ${download.status}`)
    const bytes = Buffer.from(await download.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Official Node checksum mismatch: ${archiveName}`)
    const temporary = `${archive}.${randomUUID()}.tmp`
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, archive) }
    finally { await rm(temporary, { force: true }) }
  }
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (actual !== expected) throw new Error(`Official Node checksum mismatch: ${archive}`)
  const extracted = join(outputRoot, 'node-distribution')
  await mkdir(extracted, { recursive: true })
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive -LiteralPath $env:DSH_NODE_ARCHIVE -DestinationPath $env:DSH_NODE_EXTRACTED -Force'], {
        stdio: 'inherit', env: { ...process.env, DSH_NODE_ARCHIVE: archive, DSH_NODE_EXTRACTED: extracted },
      })
      await cp(join(extracted, distribution, 'node.exe'), join(outputRoot, 'node.exe'))
      await cp(join(extracted, distribution, 'LICENSE'), join(outputRoot, 'NODE_LICENSE'))
    } else {
      execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', extracted, `${distribution}/bin/node`, `${distribution}/LICENSE`])
      await cp(join(extracted, distribution, 'bin/node'), join(outputRoot, 'node'))
      await cp(join(extracted, distribution, 'LICENSE'), join(outputRoot, 'NODE_LICENSE'))
    }
  } finally { await rm(extracted, { recursive: true, force: true }) }
  if (process.platform === 'win32') {
    compileWindowsNative(resolve('native/runtime-launcher-windows.c'), output)
  } else {
    // execv preserves the runtime's process-group ownership and signal delivery.
    execFileSync('/usr/bin/xcrun', ['clang', '-Os', '-Wall', '-Wextra', '-Werror',
      resolve('native/runtime-launcher.c'), '-o', output], { stdio: 'inherit' })
  }
} else {
  execFileSync('bun', ['build', '--compile', source, '--outfile', output], { stdio: 'inherit' })
}
await access(output, process.platform === 'win32' ? constants.R_OK : constants.X_OK)
