/** Resolve per-user desktop data paths without crossing platform path rules. */
import { desktopProductDataRoot, resolveDesktopDistribution } from './distribution/config.ts'

/** Return the application data directory for the requested desktop host. */
export function desktopDataRoot(
  platform: string,
  environment: NodeJS.ProcessEnv,
  home: string,
): string {
  return desktopProductDataRoot(resolveDesktopDistribution('zhiyu'), platform, environment, home)
}
