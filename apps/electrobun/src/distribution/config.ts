/** Product identities are immutable build inputs; enterprise defaults retain installed state. */
import { posix, win32 } from 'node:path'
import semver from 'semver'
import { z } from 'zod'
import zhiyu from '../../distributions/zhiyu/product.json' with { type: 'json' }
import arivo from '../../distributions/arivo/product.json' with { type: 'json' }

const segment = z.string().min(1).refine(value => !/[\\/\x00-\x1f]/u.test(value) && value !== '.' && value !== '..')
const identitySchema = z.object({
  id: z.enum(['zhiyu', 'arivo']),
  name: segment,
  identifier: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  artifactPrefix: z.string().regex(/^[a-z][a-z0-9-]*$/),
  legacyInstallerNames: z.array(segment),
  dataDirectory: segment,
  credentialService: z.string().min(1),
  launchAgentLabel: z.string().min(1),
}).strict()
const productSchema = z.discriminatedUnion('versionSource', [
  identitySchema.extend({ versionSource: z.literal('application') }).strict(),
  identitySchema.extend({
    versionSource: z.literal('distribution'), version: z.string().refine(value => semver.valid(value) === value),
  }).strict(),
])

/** Validated product configuration; values never come from cloud responses. */
export type DesktopDistribution = Readonly<Omit<z.infer<typeof identitySchema>, 'legacyInstallerNames'>> & {
  readonly legacyInstallerNames: readonly string[]
} & ({ readonly versionSource: 'application' } | { readonly versionSource: 'distribution'; readonly version: string })

function product(value: unknown): DesktopDistribution {
  const parsed = productSchema.parse(value)
  return Object.freeze({ ...parsed, legacyInstallerNames: Object.freeze(parsed.legacyInstallerNames) })
}

const products = Object.freeze({ zhiyu, arivo })

/** Resolve a product explicitly; omitted selection preserves the released enterprise product.
 * @param id - Build-owned product selector; empty or unknown values throw.
 * @returns Immutable distribution identity.
 */
export function resolveDesktopDistribution(id: string = 'zhiyu'): DesktopDistribution {
  if (id !== 'zhiyu' && id !== 'arivo') throw new Error(`Unknown desktop distribution: ${id}`)
  const selected = product(products[id])
  if (selected.id !== id) throw new Error(`Desktop distribution identity does not match its catalog key: ${id}`)
  return selected
}

/** Select an independent Arivo version without changing the enterprise package version.
 * @param distribution - Validated product identity.
 * @param applicationVersion - Existing desktop package version.
 * @returns Canonical semantic version for the selected product.
 */
export function desktopProductVersion(distribution: DesktopDistribution, applicationVersion: string): string {
  const version = distribution.versionSource === 'distribution' ? distribution.version : applicationVersion
  if (semver.valid(version) !== version) throw new Error('Desktop product version must be canonical semver')
  return version
}

/** Keep enterprise directories stable and isolate all Arivo staging and output.
 * @param distribution - Validated product identity.
 * @returns Desktop-relative build and installer roots.
 */
export function desktopProductDirectories(distribution: DesktopDistribution): { build: string; artifacts: string } {
  return distribution.id === 'zhiyu'
    ? { build: 'build', artifacts: 'artifacts' }
    : { build: `build/distributions/${distribution.id}`, artifacts: `artifacts/${distribution.id}` }
}

/** Resolve a data directory using the target OS, independent of the build host.
 * @param distribution - Validated product identity.
 * @param platform - Target Node platform.
 * @param environment - Target user environment.
 * @param home - Target user's home directory.
 * @returns Product-owned data root; neither product adopts the other's data.
 */
export function desktopProductDataRoot(
  distribution: DesktopDistribution, platform: string, environment: NodeJS.ProcessEnv, home: string,
): string {
  if (platform === 'win32') {
    return win32.join(environment.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), distribution.dataDirectory)
  }
  return posix.join(home, 'Library', 'Application Support', distribution.dataDirectory)
}

/** Pin one child build without mutating the caller's environment or bridging product services.
 * @param distribution - Explicit command-owned product identity.
 * @param environment - Parent build environment.
 * @returns A new environment with the canonical selector and unrelated product endpoints removed.
 */
export function desktopProductEnvironment(
  distribution: DesktopDistribution, environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const entries = Object.entries(environment).filter(([name]) => {
    // Windows treats environment names case-insensitively, including duplicate selector spellings.
    const key = name.toUpperCase()
    if (key === 'DSH_DESKTOP_DISTRIBUTION') return false
    return distribution.id === 'zhiyu'
      ? !key.startsWith('ARIVO_')
      : !key.startsWith('ENTERPRISE_') && !key.startsWith('DSH_ENTERPRISE_')
        && key !== 'DSH_DESKTOP_UPDATE_URL' && key !== 'DSH_DESKTOP_UPDATE_PUBLIC_KEY'
  })
  return { ...Object.fromEntries(entries), DSH_DESKTOP_DISTRIBUTION: distribution.id }
}
