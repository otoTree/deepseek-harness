/** Obfuscate and record JavaScript in the Electrobun Windows application wrapper. */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { protectResources, verifyProtectedResources } from './protect-build.ts'

const wrapper = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH
if (!wrapper) throw new Error('Electrobun did not provide the Windows wrapper path')
const resources = join(wrapper, 'Resources')
const count = await protectResources(resources)
await verifyProtectedResources(resources)
console.log(`Protected ${count} first-party JavaScript modules in the Windows wrapper`)
const node = process.env.DSH_BUILD_NODE
const tsx = process.env.DSH_BUILD_TSX
const desktop = process.env.DSH_BUILD_DESKTOP
if (!node || !tsx || !desktop) throw new Error('The Windows installer build is missing its Node smoke-test paths')
execFileSync(node, [
  tsx, '--tsconfig', join(desktop, '../../tsconfig.base.json'), '--test',
  join(desktop, 'tests/keychain.test.ts'), join(desktop, 'tests/profile-smoke.test.ts'),
], {
  cwd: desktop, stdio: 'inherit',
  env: { ...process.env, DSH_DESKTOP_TEST_APP: wrapper, ENTERPRISE_TEST_KEYCHAIN: '1' },
})
