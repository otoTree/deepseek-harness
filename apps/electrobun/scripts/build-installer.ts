/** Build an isolated, protected macOS DMG or Windows installer archive. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { protectResources, verifyProtectedResources } from './protect-build.ts'
import base from './desktop-config.ts'
import { homedir } from 'node:os'
import { runPnpm } from './run-pnpm.ts'

if (!((process.platform === 'darwin' && process.arch === 'arm64')
  || (process.platform === 'win32' && process.arch === 'x64'))) {
  throw new Error('Local desktop installers support Apple Silicon macOS and x64 Windows build hosts')
}
const desktop = fileURLToPath(new URL('..', import.meta.url))
const repository = resolve(desktop, '../..')
const { version } = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')) as { version: string }
const run = (command: string, args: string[], cwd = desktop): void => {
  const env = { ...process.env, HUTCH_NO_UPDATE_CHECK: '1' }
  if (command === 'pnpm') runPnpm(args, { cwd, env })
  else execFileSync(command, args, { cwd, stdio: 'inherit', env })
}

run('pnpm', ['run', 'enterprise:build'], repository)
for (const step of ['build:frontend', 'build:plugins', 'build:native', 'build:icon']) {
  run('pnpm', ['run', step])
}
run('pnpm', ['exec', 'tsx', 'scripts/build-runtime.ts', '--release'])

const work = join(desktop, 'build/local-installer')
await mkdir(work, { recursive: true })
const project = await mkdtemp(join(work, 'project-'))
try {
  await symlink(join(desktop, 'node_modules'), join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  // macOS reuses its immutable SDK projection; Windows prepares a host-native projection in this isolated project.
  if (process.platform === 'darwin') {
    await mkdir(join(project, '.hutch'))
    for (const entry of ['devkit', 'dependencies.lock']) {
      await cp(join(desktop, '.hutch', entry), join(project, '.hutch', entry), { recursive: true })
    }
  }
  const packageManifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name: 'dsh-local-installer', private: true, type: 'module',
    dependencies: { electrobun: packageManifest.dependencies.electrobun },
  }) + '\n')
  const copy: Record<string, string> = Object.fromEntries(Object.entries(base.build.copy)
    .filter(([source, target]) => !source.endsWith('.map') && !target.startsWith('plugins/enterprise-account/'))
    .map(([source, target]) => [resolve(desktop, source), target]))
  delete copy[join(desktop, process.platform === 'win32' ? 'build/dsh.exe' : 'build/dsh')]
  delete copy[join(desktop, 'build/runtime-tree/node_modules')]
  delete copy[resolve(desktop, '../cli/package.json')]
  copy[join(work, `inputs/${process.platform === 'win32' ? 'dsh.exe' : 'dsh'}`)] = process.platform === 'win32' ? 'dsh.exe' : 'dsh'
  copy[join(work, `inputs/${process.platform === 'win32' ? 'node.exe' : 'node'}`)] = process.platform === 'win32' ? 'node.exe' : 'node'
  copy[join(work, 'inputs/NODE_LICENSE')] = 'NODE_LICENSE'
  copy[join(work, 'inputs/runtime')] = 'runtime'
  copy[join(work, 'inputs/runtime-tree/node_modules')] = 'node_modules'
  copy[join(repository, 'LICENSE')] = 'LICENSE'
  copy[join(repository, 'THIRD_PARTY_NOTICES.md')] = 'THIRD_PARTY_NOTICES.md'
  await mkdir(join(project, 'scripts'))
  await cp(join(desktop, 'scripts/protect-wrapper.ts'), join(project, 'scripts/protect-wrapper.ts'))
  await cp(join(desktop, 'scripts/protect-build.ts'), join(project, 'scripts/protect-build.ts'))
  if (process.platform === 'win32') {
    await mkdir(join(project, 'assets'))
    await cp(join(desktop, 'assets/desktop-icon.png'), join(project, 'assets/desktop-icon.png'))
  }
  const config = {
    ...base,
    build: {
      ...base.build,
      bun: { ...base.build.bun, entrypoint: join(desktop, 'src/index.ts'), minify: true, sourcemap: false,
        define: { 'process.env.DSH_DESKTOP_PACKAGED': '"1"' } },
      copy,
      ...(process.platform === 'darwin' ? {
        mac: { ...base.build.mac, icons: join(desktop, 'build/icon.iconset'), codesign: false, notarize: false, createDmg: false },
      } : {}),
    },
    ...(process.platform === 'win32' ? { scripts: { postWrap: 'scripts/protect-wrapper.ts' }, release: { generatePatch: false } } : {}),
  }
  await writeFile(join(project, 'electrobun.config.ts'), `export default ${JSON.stringify(config, null, 2)}\n`)
  const electrobun = join(dirname(createRequire(import.meta.url).resolve('electrobun/package.json')), 'bin/electrobun.cjs')
  const bun = execFileSync('bun', ['--print', 'process.execPath'], { encoding: 'utf8' }).trim()
  const hutchHome = process.env.HUTCH_HOME ?? process.env.DASH_HOME ?? join(homedir(), '.hutch')
  if (process.platform === 'win32') {
    execFileSync(process.execPath, [electrobun, 'prepare'], {
      cwd: project, stdio: 'inherit', env: { ...process.env, HUTCH_NO_UPDATE_CHECK: '1', COTTONTAIL_BINARY: bun },
    })
  }
  const devkit = JSON.parse(await readFile(join(project, '.hutch/devkit/package.json'), 'utf8')) as { version: string }
  const projection = JSON.parse(await readFile(join(project, '.hutch/devkit/projection.json'), 'utf8')) as {
    target: { os: string; arch: string }
  }
  if (projection.target.os !== (process.platform === 'win32' ? 'win' : 'macos')
    || projection.target.arch !== (process.arch === 'x64' ? 'x64' : 'arm64')) {
    throw new Error('Prepare the Electrobun win-x64 devkit before building the Windows installer')
  }
  // Hutch's configuration and bundle helpers use Bun-compatible APIs; avoid the crashing Cottontail runtime.
  const buildArguments = ['build', process.platform === 'win32' ? '--env=stable' : '--env=dev']
  const buildEnvironment = {
    ...process.env,
    HUTCH_NO_UPDATE_CHECK: '1',
    COTTONTAIL_BINARY: bun,
    DSH_BUILD_NODE: process.execPath,
    DSH_BUILD_TSX: createRequire(import.meta.url).resolve('tsx/cli'),
    DSH_BUILD_DESKTOP: desktop,
    HUTCH_ELECTROBUN_DEVKIT_ROOT: join(hutchHome, 'releases/electrobun', devkit.version,
      process.platform === 'win32' ? 'win-x64' : 'macos-arm64'),
  }
  execFileSync(process.execPath, [electrobun, ...buildArguments], {
    cwd: project, stdio: 'inherit', env: {
      ...buildEnvironment,
    },
  })
  if (process.platform === 'win32') {
    const artifactRoot = join(project, 'artifacts')
    const setupArchiveName = `${base.app.name}-Setup.zip`
    const candidates: string[] = []
    async function findSetupArtifacts(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await findSetupArtifacts(path)
        else if (entry.name === setupArchiveName) candidates.push(path)
      }
    }
    await findSetupArtifacts(artifactRoot)
    if (candidates.length !== 1) throw new Error(`Expected one ${setupArchiveName} under ${artifactRoot}`)
    const output = join(desktop, 'artifacts/local')
    await mkdir(output, { recursive: true })
    const archive = join(output, `deepseek-harness-enterprise-${version}-windows-x64-local.zip`)
    await cp(candidates[0]!, archive)
    const hash = createHash('sha256').update(await readFile(archive)).digest('hex')
    await writeFile(archive + '.sha256', `${hash}  ${archive.slice(dirname(archive).length + 1)}\n`)
    run('pnpm', ['exec', 'tsx', 'scripts/verify-installer.ts', archive])
    console.log(`Local Windows installer: ${archive}\nSHA-256: ${hash}`)
  } else {
    // Dev staging preserves loose resources. Release staging archives them before protection can inspect them.
    const built = join(project, 'build/dev-macos-arm64/deepseek-harness-enterprise-dev.app')
    const bundle = join(project, 'deepseek-harness-enterprise.app')
    await rename(built, bundle)
    const resources = join(bundle, 'Contents/Resources')
    const metadata = JSON.parse(await readFile(join(resources, 'build.json'), 'utf8')) as Record<string, unknown>
    await writeFile(join(resources, 'build.json'), JSON.stringify({ ...metadata, buildEnvironment: 'stable' }) + '\n')
    await writeFile(join(resources, 'version.json'), JSON.stringify({
      version, hash: 'local', channel: 'stable', name: base.app.name, identifier: base.app.identifier, baseUrl: '',
    }) + '\n')
    run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleName ${base.app.name}`, join(bundle, 'Contents/Info.plist')])
    run('pnpm', ['exec', 'tsx', 'scripts/smoke-installer.ts', bundle])
    const count = await protectResources(resources)
    console.log(`Protected ${count} first-party JavaScript modules`)
    await verifyProtectedResources(resources)
    run('pnpm', ['exec', 'tsx', 'scripts/verify-build.ts', bundle])
    run('pnpm', ['exec', 'tsx', 'scripts/smoke-installer.ts', bundle])
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle])
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle])
    const output = join(desktop, 'artifacts/local')
    await mkdir(output, { recursive: true })
    const image = join(output, `deepseek-harness-enterprise-${version}-macos-arm64-local.dmg`)
    const imageRoot = join(project, 'image')
    await mkdir(imageRoot)
    run('/usr/bin/ditto', [bundle, join(imageRoot, 'deepseek-harness-enterprise.app')])
    await symlink('/Applications', join(imageRoot, 'Applications'))
    run('/usr/bin/hdiutil', ['create', '-volname', 'DeepSeek Harness Enterprise', '-srcfolder', imageRoot, '-format', 'UDZO', '-ov', image])
    run('/usr/bin/hdiutil', ['verify', image])
    const hash = createHash('sha256').update(await readFile(image)).digest('hex')
    await writeFile(image + '.sha256', `${hash}  ${image.slice(dirname(image).length + 1)}\n`)
    console.log(`Local installer: ${image}\nSHA-256: ${hash}`)
  }
} finally {
  await rm(project, { recursive: true, force: true })
}
