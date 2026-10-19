/** Resolve the bundled DSH executable without accepting a relative or user-controlled fallback. */
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { RESOURCES_FOLDER } from 'electrobun/main/paths'

/** Return the configured or packaged absolute DSH executable. */
export async function resolveEnterpriseRuntimeBinary(configured?: string): Promise<string> {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const candidates = configured ? [configured] : [
    join(RESOURCES_FOLDER, 'app', `dsh${extension}`),
    join(RESOURCES_FOLDER, 'app', 'bin', `dsh${extension}`),
  ]
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue
    try { await access(candidate, process.platform === 'win32' ? constants.R_OK : constants.X_OK); return candidate } catch { /* try the next packaged location */ }
  }
  throw new Error('The bundled enterprise DSH runtime is not installed')
}
