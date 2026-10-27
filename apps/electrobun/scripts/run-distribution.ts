/** Pin existing enterprise commands to their released product, including nested builds. */
import { fileURLToPath } from 'node:url'
import { desktopProductEnvironment, resolveDesktopDistribution } from '../src/distribution/config.ts'
import { runPnpm } from './run-pnpm.ts'

const [id, task, ...args] = process.argv.slice(2)
const distribution = resolveDesktopDistribution(id)
const tasks = new Set([
  'dev', 'build:desktop', 'build:installer', 'build:installer:release', 'verify:installer',
  'notarize:installer', 'sign:update', 'typecheck', 'typecheck:runtime', 'test',
])
if (!task || !tasks.has(task)) throw new Error('Specify a supported desktop build, verification or development task')
if (distribution.id === 'arivo') {
  if (task !== 'build:desktop' && task !== 'build:installer' && task !== 'verify:installer') throw new Error('Arivo supports explicit native build and installer tasks')
  const verifier = process.platform === 'win32' ? 'scripts/verify-arivo-windows.ts' : 'scripts/verify-arivo.ts'
  runPnpm(['exec', 'tsx', task === 'verify:installer' ? verifier : 'scripts/build-arivo.ts', ...args, ...(task === 'build:installer' ? ['--installer'] : [])], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: desktopProductEnvironment(distribution, process.env),
  })
} else runPnpm(['run', task, ...args], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: desktopProductEnvironment(distribution, process.env),
})
