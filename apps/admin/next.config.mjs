import { fileURLToPath } from 'node:url'

/** Trace workspace imports into the self-contained production server. */
export default {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
}
