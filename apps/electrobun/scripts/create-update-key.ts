/** Create release signing keys in a private directory outside build inputs. */
import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { directory: { type: 'string' } } })
if (!values.directory) throw new Error('Usage: keygen:update --directory <existing-secure-directory-outside-checkout>')
const directory = await mkdtemp(join(resolve(values.directory), 'dsh-release-key-'))
await chmod(directory, 0o700)
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
await writeFile(join(directory, 'release-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 })
await writeFile(join(directory, 'release-public.txt'), publicKey.export({ type: 'spki', format: 'der' }).toString('base64') + '\n', { flag: 'wx', mode: 0o600 })
console.log(directory)
