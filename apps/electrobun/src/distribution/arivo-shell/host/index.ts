import { registerArivoTriggers } from './triggers.ts'
import { registerPluginMarketHost, type ProductMarketSession } from '@deepseek-ai/dsh-enterprise-client'
/** First-party startup adapter between the OS shell and the verified creative plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import z from '@deepseek-ai/schemastery'
import { z as schema } from 'zod'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { ArivoLanguageAdapter } from './language-adapter.ts'
import type { ArivoLanguageConfig } from './language-adapter.ts'
import type { ArivoLanguageHost } from './language-wire.ts'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { arivoModelRoute } from './language-mapping.ts'
import { assertProjectModelRoute, folderRequestSchema, projectForWorkspace, projectFolderRequest, type ArivoFolderHost } from './project-folders.ts'
import { registerStudioTools, type ArivoStudioToolHost } from './studio-tools.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { sessionCatalogRequestSchema } from '../session-catalog-protocol.ts'
import { projectSessionCatalog } from './session-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Public startup-plugin UI operation; implementation belongs to the versioned Arivo release. */
    arivoStudio: { marketSession(): Promise<ProductMarketSession> } & ArivoLanguageHost & ArivoStudioToolHost & ArivoFolderHost & { embeddedWorkbench(parentOrigin: string, entry: { version: 1; page: 'projects' | 'tasks' | 'assets' | 'backups' | 'account' | 'settings'; language: 'en' | 'zh'; scheme: 'light' | 'dark'; projectId?: string }): string }
  }
}

declare const ARIVO_BRAND_MARK: string

/** Services provided by the original OS and the bundled creative plugin. */
export const inject = ['connection', 'webServer', 'arivoStudio', 'llm', 'sessions', 'agentDefaultModel', 'tools', 'workspaceRegistry']

/** Bounded model discovery and explicit default output controls for the Arivo distribution. */
export const Config: z<ArivoLanguageConfig & { triggerStatePath: string }> = z.object({
  triggerStatePath: z.string(),
  defaultMaxOutputTokens: z.number().step(1).min(1).max(131072).default(4096),
  catalogTimeoutMs: z.number().step(1).min(1000).max(60000).default(15000),
  maxCatalogPages: z.number().step(1).min(1).max(100).default(10),
})

const nativeFolderInput = folderRequestSchema.extend({ selectedPath: schema.string().min(1).max(32768).nullable().optional() })

const workbenchRequest = schema.strictObject({ version: schema.literal(1),
  page: schema.enum(['projects', 'tasks', 'assets', 'backups', 'account', 'settings']), language: schema.enum(['en', 'zh']),
  view: schema.enum(['generation', 'script', 'settings', 'storyboard', 'canvas', 'assets']).optional(),
  scheme: schema.enum(['light', 'dark']), sessionId: schema.string().min(1).max(256).optional(),
}).refine(input => input.sessionId === undefined || input.page === 'projects').refine(input => input.view === undefined || (input.page === 'projects' && input.sessionId !== undefined))

/** Expose the plugin pane only through the OS's authenticated local transport.
 * @param ctx - First-party startup composition.
 * @param config - Validated deployment model controls.
 */
export function apply(ctx: Context, config: ArivoLanguageConfig & { triggerStatePath: string }): void {
  registerPluginMarketHost(ctx, '/arivo-market', () => ctx.arivoStudio.marketSession())
  registerArivoTriggers(ctx, config.triggerStatePath)
  registerStudioTools(ctx, ctx.arivoStudio)
  ctx.effect(() => ctx.connection.rpc.handle('/arivo-project-folders', async (endpoint, payload, signal) => {
    try {
      if (endpoint !== 'request') throw new Error('Invalid project folder operation')
      const { selectedPath, ...input } = nativeFolderInput.parse(payload)
      return { ok: true as const, value: await projectFolderRequest(input, ctx.arivoStudio,
        () => { if (selectedPath === undefined) throw new Error('PROJECT_FOLDER_REQUIRED'); return Promise.resolve(selectedPath) }, (path, title) => ctx.workspaceRegistry.create(path, title), signal) }
    } catch (error) {
      const allowed = new Set(['PROJECT_FOLDER_CONFLICT', 'PROJECT_FOLDER_INVALID', 'PROJECT_FOLDER_ACCOUNT', 'LOCAL_SCOPE_CHANGED', 'COMMAND_CONFLICT', 'CLOUD_NOT_FOUND', 'CLOUD_PERMISSION_DENIED', 'CLOUD_SIGN_IN_REQUIRED', 'CLOUD_COMMAND_EXPIRED', 'CLOUD_CONNECTION_LOST'])
      const candidate = error instanceof Error && 'code' in error ? String(error.code) : ''
      return { ok: false as const, error: { code: allowed.has(candidate) ? candidate : 'arivo/project-folder-unavailable', message: 'Project folder could not be connected.', details: {} } }
    }
  }), 'arivo-shell: native project folder controls')
  const adapter = new ArivoLanguageAdapter(ctx.arivoStudio, ctx.sessions, config,
    () => { ctx.logger('arivo-models').warn('Arivo model stop could not be confirmed; recover its original call.') },
    () => { const selected = ctx.agentDefaultModel.currentSelection(); return selected.provider === 'arivo' ? selected.model : undefined })
  ctx.effect(() => () => adapter.close(), 'arivo-shell: close model subscriptions')
  ctx.effect(() => ctx.connection.rpc.handle('/arivo-session-models', async (endpoint, payload, signal) => {
    try {
      if (endpoint !== 'catalog') throw new Error('Invalid Session catalog operation')
      const request = sessionCatalogRequestSchema.parse(payload)
      const session = ctx.sessions.get(request.sessionId as SessionId)
      if (!session) throw new Error('PROJECT_SESSION_REQUIRED')
      const joined = AbortSignal.any([signal, AbortSignal.timeout(config.catalogTimeoutMs)])
      const value = session.header.cwd ? await projectSessionCatalog(ctx.arivoStudio, session.header.cwd,
        (model, abort) => adapter.projectModels('arivo', model, abort), joined) : null
      return { ok: true as const, value }
    } catch {
      return { ok: false as const, error: { code: 'arivo/session-models-unavailable', message: 'Project models are unavailable. Reconnect and check Project settings.', details: {} } }
    }
  }), 'arivo-shell: Session project catalogs')
  ctx.llm.registerAdapter(['arivo'], adapter)
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'arivo-shell: default model lifetime')
  ctx.inject(['sessionController'], (scope) => {
    scope.effect(() => scope.sessionController.registerDefaultModelResolver(async (path, signal) => {
      if (!path) return null
      const joined = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.catalogTimeoutMs), ...signal ? [signal] : []])
      const catalog = await projectSessionCatalog(ctx.arivoStudio, path,
        (model, abort) => adapter.projectModels('arivo', model, abort), joined)
      return catalog?.default ?? null
    }), 'arivo-shell: project conversation defaults')
  })
  ctx.on('agent/request', async (payload, next) => {
    const request = await next()
    if (request.provider !== 'arivo') throw new LlmError('Select an Arivo project and language model.', 'ARIVO_MODEL_REQUIRED')
    const path = payload.agent.session.header.cwd
    if (path) {
      try { await assertProjectModelRoute(ctx.arivoStudio, path, arivoModelRoute(request.model)) }
      catch { throw new LlmError('Select a model in this project’s cloud billing scope.', 'ARIVO_PROJECT_MODEL_REQUIRED') }
    }
    return request
  })
  ctx.effect(() => ctx.webServer.tapIndex(html => html
    .replace(/<title>[\s\S]*?<\/title>/u, '<title>Arivo</title>')
    .replace(/<div(?=[^>]*\bid="root")/u, '<div data-dsh-product-title="Arivo"')
    .replace(/<link[^>]*rel="icon"[^>]*>/u, `<link rel="icon" type="image/png" href="${ARIVO_BRAND_MARK}">`)), 'arivo-shell: boot document brand')
  ctx.effect(() => ctx.connection.rpc.handle('/arivo-studio', async (endpoint, payload) => {
    try {
      const request = workbenchRequest.parse(payload)
      if (endpoint !== 'workbench') throw new Error('Invalid Studio operation')
      const { sessionId, ...entry } = request
      let projectId: string | undefined
      if (sessionId !== undefined) {
        const workspace = ctx.workspaceRegistry.list().find(item => item.sessionIds.some(id => id === sessionId))
        if (!workspace) throw new Error('PROJECT_FOLDER_REQUIRED')
        projectId = await projectForWorkspace(ctx.arivoStudio, workspace.path)
      }
      return { ok: true as const, value: { url: ctx.arivoStudio.embeddedWorkbench(
        `http://127.0.0.1:${ctx.webServer.port}`, { ...entry, ...(projectId ? { projectId } : {}) }) } }
    } catch {
      return { ok: false as const, error: { code: 'arivo/project-folder-required', message: 'Open a conversation in a connected project folder.', details: {} } }
    }
  }), 'arivo-shell: authenticated plugin pane')
}
