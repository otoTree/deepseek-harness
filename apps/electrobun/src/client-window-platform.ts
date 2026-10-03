import { BrowserWindow } from 'electrobun/main'
import { default as electrobunEventEmitter } from 'electrobun/main/events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { ClientWindowPlatform } from '@deepseek-ai/dsh-plugin-runtime'
import type { ClientWindowDefinition, ClientWindowInstance } from '@deepseek-ai/dsh-plugin-protocol'
import { validateLocalWebUrl } from './runtime.ts'

/** Native platform callbacks needed to route a closed plugin window back to the Host registry. */
export interface ClientWindowPlatformOptions {
  readonly baseUrl: string
  readonly onClosed: (windowInstanceId: string) => void
  readonly onCreated?: (windowInstanceId: string, window: BrowserWindow) => void
}

/** Create a local HTTP command surface for the separately spawned DSH Runtime. */
export interface ClientWindowBroker {
  readonly url: string
  readonly token: string
  close(): Promise<void>
}

/** Electrobun implementation of the declarative Client window platform. */
export function createElectrobunClientWindowPlatform(options: ClientWindowPlatformOptions): ClientWindowPlatform {
  const windows = new Map<string, BrowserWindow>()
  const nativeToInstance = new Map<number, string>()
  const onClose = (event: { data: { id: number } }): void => {
    const instanceId = nativeToInstance.get(event.data.id)
    if (instanceId === undefined) return
    nativeToInstance.delete(event.data.id)
    windows.delete(instanceId)
    options.onClosed(instanceId)
  }
  electrobunEventEmitter.on('close', onClose)

  const urlFor = (instance: ClientWindowInstance, definition: ClientWindowDefinition, input: unknown): string => {
    const url = new URL(validateLocalWebUrl(options.baseUrl))
    url.searchParams.set('dshSurface', definition.surface)
    url.searchParams.set('dshShell', definition.shell)
    url.searchParams.set('dshPluginId', instance.pluginId)
    url.searchParams.set('dshContributionId', instance.contributionId)
    url.searchParams.set('dshWindowInstanceId', instance.windowInstanceId)
    url.searchParams.set('dshWindowTitleKey', definition.titleKey)
    url.searchParams.set('dshWindowInput', JSON.stringify(input ?? null))
    return url.toString()
  }

  return {
    create(instance, definition, input) {
      const bounds = definition.defaultBounds ?? { width: 960, height: 720 }
      const window = new BrowserWindow({
        title: definition.titleKey,
        url: urlFor(instance, definition, input),
        sandbox: false,
        frame: { width: bounds.width, height: bounds.height },
      })
      windows.set(instance.windowInstanceId, window)
      nativeToInstance.set(window.id, instance.windowInstanceId)
      options.onCreated?.(instance.windowInstanceId, window)
    },
    close(instance) {
      const window = windows.get(instance.windowInstanceId)
      if (window === undefined) return
      window.close()
    },
    focus(instance) {
      const window = windows.get(instance.windowInstanceId)
      if (window === undefined) throw new Error(`Unknown native plugin window: ${instance.windowInstanceId}`)
      window.activate()
    },
  }
}

/** Start the authenticated broker used by the Runtime child process. */
export async function startClientWindowBroker(options: ClientWindowPlatformOptions): Promise<ClientWindowBroker> {
  const token = randomBytes(32).toString('base64url')
  const platform = createElectrobunClientWindowPlatform(options)
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end()
      return
    }
    try {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const input = JSON.parse(body) as { op?: unknown; instance?: ClientWindowInstance; definition?: ClientWindowDefinition; input?: unknown }
      if (input.op === 'create' && input.instance && input.definition) await platform.create(input.instance, input.definition, input.input)
      else if (input.op === 'close' && input.instance) await platform.close(input.instance)
      else if (input.op === 'focus' && input.instance) await platform.focus(input.instance)
      else throw new Error('Invalid client window broker command')
      response.writeHead(204).end()
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Window broker failed' }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Client window broker did not bind loopback')
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    async close(): Promise<void> { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) },
  }
}
