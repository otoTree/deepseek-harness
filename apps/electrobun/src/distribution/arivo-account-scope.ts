/** Account-directory selection for the Arivo supervisor; no browser-provided scope is accepted. */
import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/** Non-secret, native/Host protocol identifier; an account digest is not an authorization credential. */
export const arivoAgentScope = z.string().regex(/^(?:device|[a-f0-9]{64})$/u)

/** Select a private Agent home while preserving the existing anonymous home.
 * @param root - Product-owned runtime directory, separate from enterprise storage.
 * @param scope - Scope emitted by the verified native-credential owner.
 * @returns Checked directory for all DSH persistence and workspace defaults.
 */
export async function arivoAgentHome(root: string, scope: string): Promise<string> {
  const id = arivoAgentScope.parse(scope)
  const paths = id === 'device' ? [root] : [root, join(root, 'accounts'), join(root, 'accounts', id), join(root, 'accounts', id, 'agent')]
  for (const path of paths) {
    await mkdir(path, { recursive: true, mode: 0o700 })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()
      || (process.platform !== 'win32' && (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))) {
      throw new Error('Arivo Agent home must be a private, owned directory without links')
    }
  }
  return id === 'device' ? root : join(root, 'accounts', id, 'agent')
}
