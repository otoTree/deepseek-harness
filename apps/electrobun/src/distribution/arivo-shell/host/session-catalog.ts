/** Project-local model discovery uses original Session cwd and native account authority. */
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { ArivoFolderHost } from './project-folders.ts'
import { arivoModelRoute } from './language-mapping.ts'
import { sessionCatalogSchema } from '../session-catalog-protocol.ts'

/** Read one folder project's live catalog without changing defaults or querying other projects.
 * @param host - Account-fenced native folder service.
 * @param path - Trusted original Session cwd.
 * @param models - Bounded live model lookup for exactly the verified billing route.
 * @param signal - Authenticated RPC lifetime and catalog timeout.
 * @returns Project catalog, or null for an ordinary unbound Harness directory.
 */
export async function projectSessionCatalog(host: ArivoFolderHost, path: string,
  models: (model: string, signal: AbortSignal) => Promise<readonly LlmModelInfo[]>, signal: AbortSignal) {
  signal.throwIfAborted()
  const handle = await host.projectFolderSession()
  try {
    if (handle.protocolVersion !== 1 || !handle.cloud || !handle.conversationModel) throw new Error('PROJECT_MODEL_UNAVAILABLE')
    const folder = await handle.resolve(path)
    signal.throwIfAborted()
    if (!folder) return null
    const cloud = await handle.cloud(folder.projectId)
    if (!cloud) throw new Error('PROJECT_MODEL_REQUIRED')
    const selected = await handle.conversationModel(folder.projectId, signal)
    signal.throwIfAborted()
    if (!selected) throw new Error('PROJECT_MODEL_REQUIRED')
    const route = arivoModelRoute(selected.model)
    if (route.cloudWorkspaceId !== cloud.cloudWorkspaceId || route.cloudProjectId !== cloud.cloudProjectId) {
      throw new Error('PROJECT_MODEL_SCOPE_MISMATCH')
    }
    const available = await models(selected.model, signal)
    signal.throwIfAborted()
    // Recheck the captured account after network I/O, even when a source ignores cancellation.
    const current = await handle.get(folder.projectId)
    signal.throwIfAborted()
    if (!current || current.projectId !== folder.projectId || current.path !== path) throw new Error('PROJECT_FOLDER_REQUIRED')
    if (!available.some(item => item.provider === selected.provider && item.id === selected.model)) throw new Error('PROJECT_MODEL_UNAVAILABLE')
    return sessionCatalogSchema.parse({ default: selected, routableProviders: ['arivo'],
      groups: [{ id: 'arivo', name: 'Arivo', models: available.map((item) => {
        const candidate = arivoModelRoute(item.id)
        if (item.provider !== 'arivo' || candidate.cloudWorkspaceId !== cloud.cloudWorkspaceId
          || candidate.cloudProjectId !== cloud.cloudProjectId) throw new Error('PROJECT_MODEL_SCOPE_MISMATCH')
        return { id: item.id, name: item.name, inputModalities: ['text'] }
      }) }], failures: [] })
  } finally { handle.dispose() }
}
