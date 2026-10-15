/** Keyless stateless Streamable HTTP MCP fixture for integration tests. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

/** Running HTTP fixture and the request headers it observed. */
export interface HttpMcpFixture {
  url: string
  authorization: Array<string | undefined>
  close: () => Promise<void>
}

/** Start a loopback MCP endpoint; cancellation fixtures share a stateful session. */
export async function startHttpMcpFixture(blocked?: { started: () => void; closed: () => void }): Promise<HttpMcpFixture> {
  const authorization: Array<string | undefined> = []
  const createMcp = (): McpServer => {
    const mcp = new McpServer(
      { name: 'http-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    mcp.registerTool('ping', { description: 'Replies pong.', inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    if (blocked !== undefined) {
      mcp.registerTool('blocked', { description: 'Waits for request cancellation.', inputSchema: {} }, async (_args, extra) => {
        await new Promise<void>((resolve) => {
          const finish = (): void => {
            extra.signal.removeEventListener('abort', finish)
            resolve()
          }
          extra.signal.addEventListener('abort', finish, { once: true })
          blocked.started()
          if (extra.signal.aborted) finish()
        })
        blocked.closed()
        return { content: [{ type: 'text', text: 'cancelled' }] }
      })
    }
    return mcp
  }
  const sessionMcp = blocked === undefined ? undefined : createMcp()
  const sessionTransport = sessionMcp === undefined ? undefined : new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  if (sessionMcp !== undefined && sessionTransport !== undefined) await sessionMcp.connect(sessionTransport as Transport)
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    authorization.push(request.headers.authorization)
    if (sessionTransport !== undefined) {
      await sessionTransport.handleRequest(request, response)
      return
    }
    const mcp = createMcp()
    const transport = new StreamableHTTPServerTransport({})
    response.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport as Transport)
    await transport.handleRequest(request, response)
  }
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP MCP fixture has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    authorization,
    close: async () => {
      await sessionMcp?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    },
  }
}
