import { verifyPluginRelease, type PluginRelease } from './plugin-verifier.ts'

/** Host callback used by the desktop runtime to register a verified plugin. */
export type PluginLoadCallback = (release: PluginRelease) => Promise<() => void> | (() => void)

/** Single gate for install, dynamic loading, tool registration and panel activation. */
export async function loadVerifiedPlugin(
  input: unknown,
  organizationId: string,
  publicKey: string,
  load: PluginLoadCallback,
): Promise<() => void> {
  const release = verifyPluginRelease(input, organizationId, publicKey)
  const disposer = await load(release)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposer()
  }
}
