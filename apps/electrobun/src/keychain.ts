/** Native Keychain transport; credential bytes travel only over private stdio. */
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'

/** Keychain access through the bundled Security.framework helper. */
export class DesktopKeychain {
  constructor(private readonly helper: string) {
    if (!isAbsolute(helper)) throw new Error('Keychain helper must have an absolute path')
  }

  private async run(operation: 'set' | 'get' | 'delete', account: string, value?: string): Promise<string | undefined> {
    if (!account || account.includes('\0')) throw new Error('Keychain account is invalid')
    if (value !== undefined && (!value || Buffer.byteLength(value) > 65536)) throw new Error('Keychain value is invalid')
    return new Promise((resolve, reject) => {
      const child = execFile(this.helper, [operation, account], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 65536,
        env: { PATH: '/usr/bin:/bin' },
      }, (error, stdout) => {
        if (error) {
          if (error.code === 44 && operation !== 'set') resolve(undefined)
          else reject(new Error('macOS Keychain operation failed'))
        } else resolve(stdout)
      })
      child.stdin?.on('error', () => {
        // Early helper rejection can close stdin; the execFile callback owns its result.
      })
      child.stdin?.end(value ?? '')
    })
  }

  /** Store a value without putting it in argv, the environment, or a disk file.
   * @param account - deployment and organization scoped account key.
   * @param value - private serialized runtime credential.
   */
  async set(account: string, value: string): Promise<void> { await this.run('set', account, value) }

  /** Read a value; only errSecItemNotFound returns undefined.
   * @param account - deployment and organization scoped account key.
   * @returns Exact stored bytes decoded as UTF-8, or absence.
   */
  get(account: string): Promise<string | undefined> { return this.run('get', account) }

  /** Remove a credential; absence is idempotent, access failures reject.
   * @param account - deployment and organization scoped account key.
   */
  async delete(account: string): Promise<void> { await this.run('delete', account) }
}
