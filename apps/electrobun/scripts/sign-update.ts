/** Sign a platform-specific release feed with an offline Ed25519 private key. */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { desktopReleaseSchema } from '../src/update-manifest.ts'

const { values } = parseArgs({ options: {
  artifact: { type: 'string' }, url: { type: 'string' }, target: { type: 'string' },
  notes: { type: 'string' }, key: { type: 'string' }, output: { type: 'string' },
} })
if (!values.artifact || !values.url || !values.target || !values.notes || !values.key || !values.output) {
  throw new Error('Usage: sign:update --artifact <installer> --url <https-url> --target <darwin-arm64|win32-x64> --notes <text-file> --key <private-pem> --output <manifest-json>')
}
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const key = createPrivateKey(await readFile(values.key))
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Release signing requires an Ed25519 private key')
const hash = createHash('sha256')
for await (const chunk of createReadStream(values.artifact)) hash.update(chunk)
const release = desktopReleaseSchema.parse({
  format: 1, identifier: 'ai.deepseek.harness.enterprise', version, target: values.target,
  url: values.url, sha256: hash.digest('hex'), size: (await stat(values.artifact)).size,
  notes: await readFile(values.notes, 'utf8'),
})
const payload = Buffer.from(JSON.stringify(release))
const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') }
await writeFile(values.output, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx' })
console.log(`Signed ${release.target} desktop release ${release.version}: ${values.output}`)
