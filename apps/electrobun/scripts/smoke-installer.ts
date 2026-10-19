/** Exercise the packaged DSH profile and frontend outside the source checkout without API credentials. */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { runPnpm } from './run-pnpm.ts'

const bundle = process.argv[2]
if (!bundle) throw new Error('Usage: tsx scripts/smoke-installer.ts <application.app>')
runPnpm(['exec', 'tsx', '--tsconfig', '../../tsconfig.base.json', '--test', 'tests/profile-smoke.test.ts'], {
  cwd: resolve('..'), env: { ...process.env, DSH_DESKTOP_TEST_APP: resolve(bundle) },
})
