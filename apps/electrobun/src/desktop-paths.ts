/** Resolve per-user desktop data paths without crossing platform path rules. */
import { posix, win32 } from 'node:path'

/** Return the application data directory for the requested desktop host. */
export function desktopDataRoot(
  platform: string,
  environment: NodeJS.ProcessEnv,
  home: string,
): string {
  // Released installations retain this directory across product renames so account and workspace data stay available.
  if (platform === 'win32') {
    const local = environment.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local')
    return win32.join(local, 'DeepSeek Harness')
  }
  return posix.join(home, 'Library', 'Application Support', 'DeepSeek Harness')
}
