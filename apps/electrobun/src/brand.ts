/** Product names for desktop bundles, installer artifacts and legacy update packages. */
import { resolveDesktopDistribution } from './distribution/config.ts'

const enterprise = resolveDesktopDistribution('zhiyu')
const legacyInstallerName = enterprise.legacyInstallerNames[0]
if (legacyInstallerName === undefined) throw new Error('Zhiyu must retain its released legacy installer name')
export const desktopBrand = {
  name: enterprise.name,
  artifactPrefix: enterprise.artifactPrefix,
  legacyInstallerName,
} as const
