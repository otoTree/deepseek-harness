/** Build configuration and version selection for authenticated desktop releases. */
import semver from 'semver'
import { desktopReleaseKey, parseSignedDesktopRelease, updateUrl, type DesktopRelease } from '@deepseek-ai/dsh-enterprise-api/desktop-release'
export { desktopReleaseSchema, updateUrl, type DesktopRelease } from '@deepseek-ai/dsh-enterprise-api/desktop-release'

/** Build-pinned feed configuration. */
export interface DesktopUpdateConfig {
  url: string
  publicKey: string
}

/** Resolve the optional feed/key pair and reject partial or invalid configuration.
 * @param url - HTTPS feed URL, absent when updates are disabled.
 * @param publicKey - Base64 SPKI DER Ed25519 public key.
 * @returns Validated configuration, or undefined when both values are absent.
 */
export function resolveDesktopUpdates(url: string | undefined, publicKey: string | undefined): DesktopUpdateConfig | undefined {
  if (!url && !publicKey) return undefined
  if (!url || !publicKey) throw new Error('Set both DSH_DESKTOP_UPDATE_URL and DSH_DESKTOP_UPDATE_PUBLIC_KEY')
  desktopReleaseKey(publicKey)
  return { url: updateUrl(url), publicKey }
}

/** Authenticate the release and select only a newer matching installer.
 * @param bytes - Bounded signed JSON envelope from the feed.
 * @param publicKey - Pinned base64 SPKI DER key.
 * @param target - Running operating system and architecture.
 * @param currentVersion - Running package version.
 * @returns Newer matching release, or undefined for equal/older versions.
 */
export function readDesktopRelease(
  bytes: Uint8Array, publicKey: string, target: string, currentVersion: string,
): DesktopRelease | undefined {
  const release = parseSignedDesktopRelease(bytes, publicKey)
  if (release.target !== target) throw new Error('Desktop release target does not match this application')
  return semver.gt(release.version, currentVersion) ? release : undefined
}
