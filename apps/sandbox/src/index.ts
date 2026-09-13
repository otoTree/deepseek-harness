/** Non-executing prototype router; enterprise tools must use the DSH sandbox providers. */
import { Hono } from 'hono'
import { z } from 'zod'

/**
 * Create a prototype router without listening or executing submitted source.
 * @returns A Hono application whose execution endpoint always reports unavailable.
 */
export function createSandboxPrototype(): Hono {
  const app = new Hono()
  const status = z.object({ service: z.literal('sandbox'), status: z.literal('not_implemented') })
  app.get('/health', c => c.json(status.parse({ service: 'sandbox', status: 'not_implemented' }), 503))
  app.post('/v1/execute', c => c.json({ accepted: false, error: 'SANDBOX_ADAPTER_NOT_IMPLEMENTED' }, 503))
  return app
}
