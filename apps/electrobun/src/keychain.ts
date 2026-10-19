/** Native credential-store transport; credential bytes travel only over private stdio. */
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'

/** Platform credential access through the bundled native helper. */
export class DesktopKeychain {
  constructor(private readonly helper: string) {
    if (!isAbsolute(helper)) throw new Error('Keychain helper must have an absolute path')
  }

  private async run(operation: 'set' | 'get' | 'delete', account: string, value?: string): Promise<string | undefined> {
    if (!account || account.includes('\0')) throw new Error('Keychain account is invalid')
    if (value !== undefined && (!value || Buffer.byteLength(value) > 65536)) throw new Error('Desktop credential value is invalid')
    return new Promise((resolve, reject) => {
      const child = execFile(this.helper, [operation, account], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 65536,
        env: process.platform === 'win32'
          ? {
            PATH: process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : 'C:\\Windows\\System32',
            SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
            ...(process.env.LOCALAPPDATA ? { LOCALAPPDATA: process.env.LOCALAPPDATA } : {}),
          }
          : { PATH: '/usr/bin:/bin' },
        windowsHide: process.platform === 'win32',
      }, (error, stdout) => {
        if (error) {
          if (error.code === 44 && operation === 'get') resolve(undefined)
          else reject(new Error('Desktop credential-store operation failed'))
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

  /** Read a value; only a missing credential returns undefined.
   * @param account - deployment and organization scoped account key.
   * @returns Exact stored bytes decoded as UTF-8, or absence.
   */
  get(account: string): Promise<string | undefined> { return this.run('get', account) }

  /** Remove a credential; absence is idempotent, access failures reject.
   * @param account - deployment and organization scoped account key.
   */
  async delete(account: string): Promise<void> { await this.run('delete', account) }
}
