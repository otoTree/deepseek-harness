/** Resume the recorded Apple submission without creating a new upload. */
import { resolve } from 'node:path'
import { resumeMacosNotarization } from './macos-notarization.ts'
import { resolveMacosSigning } from './macos-signing.ts'

if (process.platform !== 'darwin') throw new Error('Apple notarization requires macOS')
const settings = resolveMacosSigning(true, process.env)!
const image = process.argv[2]
if (!image || process.argv.length !== 3) throw new Error('Usage: notarize:installer <signed-release.dmg>')
await resumeMacosNotarization(resolve(image), settings)
