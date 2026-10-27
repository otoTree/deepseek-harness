/** Test-only native supervisor for an installed profile; stdout carries only its private browser bootstrap. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ArivoRuntime } from '../../src/distribution/arivo-runtime.ts'

const [application, home] = process.argv.slice(2)
if (!application || !home) throw new Error('Installed application and isolated home are required')
const app = join(application, 'Contents/Resources/app')
const manifest = await readFile(join(app, 'plugins/arivo/manifest.json'))
const { version } = z.object({ version: z.string() }).parse(JSON.parse(manifest.toString()))
const runtime = new ArivoRuntime({ binary: join(app, 'dsh'), installAnchor: join(app, 'runtime/package.json'),
  home, instanceHelper: join(app, 'native/instance'), pluginDirectory: join(app, 'plugins/arivo'), shellDirectory: join(app, 'arivo-shell'),
  manifestSha256: createHash('sha256').update(manifest).digest('hex'), pluginVersion: version,
  target: 'darwin-arm64', maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000 })
try {
  const stopped = Promise.withResolvers<undefined>()
  process.once('SIGTERM', () => { stopped.resolve(undefined) }); process.once('SIGINT', () => { stopped.resolve(undefined) })
  await runtime.start()
  console.log(await runtime.agentUrl())
  await stopped.promise
} finally { await runtime.stop() }
