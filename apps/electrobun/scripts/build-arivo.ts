/** Build an independent Arivo native bundle from a versioned first-party plugin release. */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { desktopProductEnvironment, desktopProductVersion, resolveDesktopDistribution } from '../src/distribution/config.ts'
import { verifyBundledPlugin } from '../src/distribution/bundled-plugin.ts'
import { runPnpm } from './run-pnpm.ts'
import { arivoIdentitySettings } from '../src/distribution/arivo-identity.ts'

const { values } = parseArgs({ options: { 'plugin-release': { type: 'string' }, installer: { type: 'boolean', default: false },
  'api-origin': { type: 'string' }, 'web-origin': { type: 'string' },
  'identity-request-timeout-ms': { type: 'string', default: '10000' }, 'identity-login-timeout-ms': { type: 'string', default: '180000' },
} })
if (!values['api-origin'] || !values['web-origin']) throw new Error('Arivo requires online services; provide both --api-origin and --web-origin')
const identity = arivoIdentitySettings.parse({
  apiOrigin: values['api-origin'], webOrigin: values['web-origin'],
  requestTimeoutMs: Number(values['identity-request-timeout-ms']), loginTimeoutMs: Number(values['identity-login-timeout-ms']),
})
const release = values['plugin-release']
if (!release || !isAbsolute(release)) throw new Error('Provide --plugin-release with an absolute built Arivo release directory')
if (!((process.platform === 'darwin' && process.arch === 'arm64') || (process.platform === 'win32' && process.arch === 'x64'))) {
  throw new Error('Arivo native builds require Apple Silicon macOS or Windows x64')
}
const desktop = fileURLToPath(new URL('..', import.meta.url))
const product = resolveDesktopDistribution('arivo')
const env = desktopProductEnvironment(product, process.env)
const version = desktopProductVersion(product, '')
const target = process.platform === 'darwin' ? 'darwin-arm64' : 'win32-x64'
const manifestBytes = await readFile(join(release, 'manifest.json'))
const digest = createHash('sha256').update(manifestBytes).digest('hex')
const plugin = await verifyBundledPlugin({
  distribution: product, directory: release, manifestSha256: digest, version, target, maxBytes: 128 * 1024 * 1024,
})
const build = join(desktop, 'build/distributions/arivo')
await mkdir(build, { recursive: true })
const lock = join(build, 'build.lock')
await mkdir(lock).catch(() => { throw new Error('Arivo build is already active; inspect build/distributions/arivo/build.lock before retrying') })
await writeFile(join(lock, 'pid'), `${process.pid}\n`)
const invoke = (args: string[]) => { runPnpm(args, { cwd: desktop, env }) }
let project: string | undefined
try {
  runPnpm(['exec', 'tsc', '-b', 'apps/electrobun/tsconfig.arivo-shell.host.json', 'apps/electrobun/tsconfig.arivo-shell.client.json'], { cwd: join(desktop, '../..'), env })
  runPnpm(['run', 'build:lib:client'], { cwd: join(desktop, '../..'), env })
  runPnpm(['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'], { cwd: join(desktop, '../..'), env })
  runPnpm(['run', 'build:lib:host'], { cwd: join(desktop, '../..'), env })
  invoke(['exec', 'tsx', 'scripts/build-native.ts'])
  invoke(['exec', 'tsx', 'scripts/build-runtime.ts', '--release'])
  project = await mkdtemp(join(build, 'project-'))
  await symlink(join(desktop, 'node_modules'), join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const appManifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: '@arivo/desktop-build', private: true, type: 'module',
    dependencies: { electrobun: appManifest.dependencies.electrobun } }) + '\n')
  const electrobun = join(dirname(createRequire(import.meta.url).resolve('electrobun/package.json')), 'bin/electrobun.cjs')
  const bun = execFileSync('bun', ['--print', 'process.execPath'], { encoding: 'utf8' }).trim()
  const buildEnv = { ...env, HUTCH_NO_UPDATE_CHECK: '1', COTTONTAIL_BINARY: bun }
  if (process.platform === 'darwin') {
    await mkdir(join(project, '.hutch'))
    for (const name of ['devkit', 'dependencies.lock']) await cp(join(desktop, '.hutch', name), join(project, '.hutch', name), { recursive: true })
  } else execFileSync(process.execPath, [electrobun, 'prepare'], { cwd: project, stdio: 'inherit', env: buildEnv })
  const inputs = join(build, 'local-installer/inputs')
  const stagedPlugin = join(build, 'plugin')
  await rm(stagedPlugin, { recursive: true, force: true })
  await cp(release, stagedPlugin, { recursive: true })
  // Verify the staged copy as well as the selected release; a partial copy cannot enter an installer.
  await verifyBundledPlugin({ distribution: product, directory: stagedPlugin, manifestSha256: digest,
    version: plugin.version, target, maxBytes: 128 * 1024 * 1024 })
  const shell = join(build, 'arivo-shell')
  await rm(shell, { recursive: true, force: true })
  await mkdir(shell)
  invoke(['exec', 'esbuild', 'src/distribution/arivo-shell/host/index.ts', '--bundle', '--platform=node', '--format=esm',
    `--define:ARIVO_BRAND_MARK=${JSON.stringify('data:image/png;base64,' + (await readFile(join(stagedPlugin, 'arivo-mark.png'))).toString('base64'))}`,
    '--external:@deepseek-ai/*', `--outfile=${join(shell, 'host.mjs')}`])
  // Consume only the inventoried public plugin release, including offline fonts and glow.
  const productTheme = join(build, 'arivo-product-theme.ts')
  await writeFile(productTheme, `export const ARIVO_THEME_CSS = ${JSON.stringify(await readFile(join(stagedPlugin, 'theme.css'), 'utf8'))};\nexport const ARIVO_BRAND_LOGO = ${JSON.stringify('data:image/png;base64,' + (await readFile(join(stagedPlugin, 'arivo-logo.png'))).toString('base64'))};\n`)
  const clientArgs = ['exec', 'esbuild', 'src/distribution/arivo-shell/client/index.ts', '--bundle', '--platform=browser', '--format=cjs',
    '--banner:js=window.__ModuleLoader__.load({id:"@arivo/startup-shell",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
    '--footer:js=return module.exports;}});',
    `--define:ARIVO_BRAND_MARK=${JSON.stringify('data:image/png;base64,' + (await readFile(join(stagedPlugin, 'arivo-mark.png'))).toString('base64'))}`,
    `--inject:${productTheme}`, '--external:@deepseek-ai/*', '--external:react', '--external:react-dom', `--outfile=${join(shell, 'client.js')}`]
  invoke(clientArgs)
  // Register the original public UI factory without adding an enterprise Cordis boot row.
  // Its normal build owns safe inlining and CSS; only Arivo calls registerPluginMarket.
  const marketFactory = await readFile(join(desktop, '../../packages/client/ui-enterprise/lib/client.js'), 'utf8')
  await writeFile(join(shell, 'client.js'), marketFactory + '\n' + await readFile(join(shell, 'client.js'), 'utf8'))
  await writeFile(join(shell, 'package.json'), JSON.stringify({ name: '@arivo/startup-shell', version, type: 'module',
    main: './host.mjs', exports: { '.': './host.mjs', './client': './client.js', './package.json': './package.json' },
    dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-workbench', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-ui-settings'] } },
  }) + '\n')
  const icons = join(build, 'icon.iconset')
  if (process.platform === 'darwin') {
    await mkdir(icons, { recursive: true })
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
      execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(size * scale), String(size * scale),
        join(stagedPlugin, 'arivo-mark.png'), '--out', join(icons, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' })
    }
  }
  const executable = process.platform === 'win32' ? 'dsh.exe' : 'dsh'
  const node = process.platform === 'win32' ? 'node.exe' : 'node'
  const copy = {
    [join(inputs, executable)]: executable, [join(inputs, node)]: node,
    [join(inputs, 'NODE_LICENSE')]: 'NODE_LICENSE', [join(inputs, 'runtime')]: 'runtime',
    [join(inputs, 'runtime-tree/node_modules')]: 'node_modules', [stagedPlugin]: 'plugins/arivo',
    [shell]: 'arivo-shell',
    [join(build, 'native', process.platform === 'win32' ? 'keychain.exe' : 'keychain')]: `native/${process.platform === 'win32' ? 'keychain.exe' : 'keychain'}`,
    [join(build, 'native', process.platform === 'win32' ? 'instance.exe' : 'instance')]: `native/${process.platform === 'win32' ? 'instance.exe' : 'instance'}`,
  }
  await writeFile(join(project, 'electrobun.config.ts'), `export default ${JSON.stringify({
    app: { name: product.name, identifier: product.identifier, version },
    build: { mainProcess: 'bun', bun: { entrypoint: join(desktop, 'src/distribution/arivo-index.ts'), minify: true, sourcemap: false,
      define: { 'process.env.ARIVO_BUNDLED_MANIFEST_SHA256': JSON.stringify(digest), 'process.env.ARIVO_BUNDLED_PLUGIN_VERSION': JSON.stringify(plugin.version),
        'process.env.ARIVO_IDENTITY_CONFIG': JSON.stringify(identity ? JSON.stringify(identity) : '') } },
    copy, mac: { bundleCEF: true, icons, codesign: false, notarize: false, createDmg: false },
    win: { bundleCEF: true, icon: join(stagedPlugin, 'arivo-mark.png') },
    }, runtime: { exitOnLastWindowClosed: false },
  }, null, 2)}\n`)
  const kit = JSON.parse(await readFile(join(project, '.hutch/devkit/package.json'), 'utf8')) as { version: string }
  const hutch = env.HUTCH_HOME ?? env.DASH_HOME ?? join(homedir(), '.hutch')
  execFileSync(process.execPath, [electrobun, 'build', process.platform === 'darwin' ? '--env=dev' : '--env=stable'], {
    cwd: project, stdio: 'inherit', env: { ...buildEnv, HUTCH_ELECTROBUN_DEVKIT_ROOT: join(hutch, 'releases/electrobun', kit.version,
      process.platform === 'darwin' ? 'macos-arm64' : 'win-x64') },
  })
  if (process.platform === 'darwin') {
    const app = join(build, 'Arivo.app')
    await rm(app, { recursive: true, force: true })
    await rename(join(project, 'build/dev-macos-arm64/Arivo-dev.app'), app)
    const executables = join(app, 'Contents/MacOS')
    await rename(join(executables, 'launcher'), join(executables, 'electrobun-launcher'))
    await cp(join(build, 'native/bootstrap'), join(executables, 'launcher'))
    const info = join(app, 'Contents/Info.plist')
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName Arivo', info])
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleDisplayName string Arivo', info])
    const resources = join(app, 'Contents/Resources')
    const metadata = JSON.parse(await readFile(join(resources, 'build.json'), 'utf8')) as Record<string, unknown>
    await writeFile(join(resources, 'build.json'), JSON.stringify({ ...metadata, buildEnvironment: 'stable' }) + '\n')
    await writeFile(join(resources, 'version.json'), JSON.stringify({ version, hash: digest, channel: 'stable', name: product.name,
      identifier: product.identifier, baseUrl: '' }) + '\n')
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' })
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    if (values.installer) {
      const image = join(project, 'image')
      await mkdir(image)
      execFileSync('/usr/bin/ditto', [app, join(image, 'Arivo.app')])
      await symlink('/Applications', join(image, 'Applications'))
      const artifacts = join(desktop, 'artifacts/arivo/local')
      await mkdir(artifacts, { recursive: true })
      const dmg = join(artifacts, `${product.artifactPrefix}-${version}-macos-arm64-local.dmg`)
      execFileSync('/usr/bin/hdiutil', ['create', '-volname', product.name, '-srcfolder', image, '-format', 'UDZO', '-ov', dmg], { stdio: 'inherit' })
      execFileSync('/usr/bin/hdiutil', ['verify', dmg], { stdio: 'inherit' })
      await writeFile(dmg + '.sha256', createHash('sha256').update(await readFile(dmg)).digest('hex') + '\n')
      console.log(`Arivo local installer: ${dmg}`)
    }
    console.log(`Arivo native bundle: ${app}`)
  } else {
    const artifacts = join(desktop, 'artifacts/arivo/local')
    await mkdir(artifacts, { recursive: true })
    const candidates: string[] = []
    const collect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await collect(path)
        else if (entry.name === `${product.name}-Setup.zip`) candidates.push(path)
      }
    }
    await collect(join(project, 'artifacts'))
    if (candidates.length !== 1) throw new Error('Expected exactly one Arivo Windows setup archive')
    const archive = join(artifacts, `${product.artifactPrefix}-${version}-windows-x64-local.zip`)
    await cp(candidates[0]!, archive)
    await writeFile(archive + '.sha256', createHash('sha256').update(await readFile(archive)).digest('hex') + '\n')
    invoke(['exec', 'tsx', 'scripts/verify-arivo-windows.ts', archive])
    console.log(`Arivo Windows installer: ${archive}`)
  }
} finally {
  if (project) await rm(project, { recursive: true, force: true })
  await rm(lock, { recursive: true, force: true })
}
