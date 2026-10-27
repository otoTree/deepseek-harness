/** Native folder selection registers the same directory with the original Workspace owner. */
import { basename } from 'node:path'
import { z } from 'zod'

/** Native-only metadata; paths are never accepted from iframe messages or model arguments. */
export interface ArivoProjectFolder { projectId: string; title: string; path: string }
export interface ArivoFolderHost {
  projectFolderSession(scope?: string): Promise<{
    protocolVersion: number
    conversationModel?(projectId: string, signal: AbortSignal): Promise<{ provider: 'arivo'; model: string } | null>
    cloud?(projectId: string): Promise<{ cloudWorkspaceId: string; cloudProjectId: string } | null>
    get(projectId: string): Promise<ArivoProjectFolder | null>
    bind(projectId: string, path: string): Promise<ArivoProjectFolder>
    resolve(path: string): Promise<ArivoProjectFolder | null>
    create?(input: ProjectCreation, path: string | null, signal: AbortSignal): Promise<{
      cancelled: boolean
      folder: ArivoProjectFolder | null
      project: unknown
    }>
    recover?(commandId: string, signal: AbortSignal): Promise<{ cancelled: boolean; folder: ArivoProjectFolder | null; project: unknown }>
    dispose(): void
  }>
}
const projectCreation = z.object({ commandId: z.uuid(), title: z.string().trim().min(1).max(160), synopsis: z.string().max(5000),
  cloudWorkspaceId: z.uuid(), cloudProjectId: z.uuid().optional(), folderMode: z.enum(['new', 'existing']) }).strict()
type ProjectCreation = z.infer<typeof projectCreation>
export const folderRequestSchema = z.object({ version: z.literal(1), operation: z.enum(['get', 'bind', 'conversation', 'create', 'recover']),
  projectId: z.uuid().optional(), conversationId: z.uuid().optional(), creation: projectCreation.optional(), commandId: z.uuid().optional(),
  scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict()

/** Capture account authority before opening the chooser and dispose it after registry acknowledgement.
 * @param input - Strict wire request without a filesystem path.
 * @param host - Account-fenced public plugin service.
 * @param select - Original native chooser.
 * @param register - Original Workspace Registry's durable create operation.
 * @param signal - Owning authenticated request lifetime.
 * @returns folder display metadata, cancellation, or no existing registration.
 */
export async function projectFolderRequest(input: unknown, host: ArivoFolderHost,
  select: (signal: AbortSignal) => Promise<string | null>,
  register: (path: string, title: string) => Promise<{ id: string }>, signal: AbortSignal) {
  const request = folderRequestSchema.parse(input)
  signal.throwIfAborted()
  const handle = await host.projectFolderSession(request.scope)
  try {
    if (handle.protocolVersion !== 1) throw new Error('PROJECT_FOLDER_UNAVAILABLE')
    if (request.operation === 'create' || request.operation === 'recover') {
      if (!handle.create || !handle.recover) throw new Error('PROJECT_FOLDER_UNAVAILABLE')
      const result = request.operation === 'create'
        ? await handle.create(projectCreation.parse(request.creation), await select(signal), signal)
        : await handle.recover(z.uuid().parse(request.commandId), signal)
      signal.throwIfAborted()
      if (result.folder) await register(result.folder.path, result.folder.title)
      return { ...result, folder: result.folder ? { projectId: result.folder.projectId, name: basename(result.folder.path) } : null }
    }
    const projectId = z.uuid().parse(request.projectId)
    let folder = await handle.get(projectId)
    if (!folder && request.operation === 'bind') {
      const path = await select(signal)
      signal.throwIfAborted()
      if (path === null) return { cancelled: true as const, folder: null }
      folder = await handle.bind(projectId, path)
    }
    // Idempotent registration also repairs an interrupted registry acknowledgement.
    if (!folder && request.operation === 'conversation') throw new Error('PROJECT_FOLDER_REQUIRED')
    let model: { provider: 'arivo'; model: string } | null | undefined
    if (request.operation === 'conversation') {
      if (!request.conversationId || !handle.conversationModel) throw new Error('PROJECT_MODEL_REQUIRED')
      model = await handle.conversationModel(projectId, signal)
      signal.throwIfAborted()
    }
    const workspace = folder ? await register(folder.path, folder.title) : undefined
    return { cancelled: false as const, folder: folder ? { projectId: folder.projectId, name: basename(folder.path), ...(request.operation === 'conversation' && workspace ? { workspaceId: workspace.id, model } : {}) } : null }
  } finally { handle.dispose() }
}

/** Resolve only a directory supplied by the original Workspace Registry.
 * @param host - Current account's native plugin handle.
 * @param path - Header-validated workspace directory, never an iframe path.
 * @returns Bound project identity; missing registrations reject instead of opening another project.
 */
export async function projectForWorkspace(host: ArivoFolderHost, path: string): Promise<string> {
  const handle = await host.projectFolderSession()
  try {
    if (handle.protocolVersion !== 1) throw new Error('PROJECT_FOLDER_UNAVAILABLE')
    const folder = await handle.resolve(path)
    if (!folder) throw new Error('PROJECT_FOLDER_REQUIRED')
    return folder.projectId
  } finally { handle.dispose() }
}

/** Check a newly assembled Agent request against its folder's immutable cloud billing binding.
 * @param host - Current account's native folder service.
 * @param path - Trusted original Session working directory.
 * @param route - Explicit Arivo request route; never overrides a persisted model step.
 * @returns Completion if unbound or if the project's cloud billing IDs match.
 */
export async function assertProjectModelRoute(host: ArivoFolderHost, path: string,
  route: { cloudWorkspaceId: string; cloudProjectId: string }): Promise<void> {
  const handle = await host.projectFolderSession()
  try {
    if (handle.protocolVersion !== 1 || !handle.cloud) throw new Error('PROJECT_MODEL_UNAVAILABLE')
    const folder = await handle.resolve(path)
    if (!folder) return
    const cloud = await handle.cloud(folder.projectId)
    if (!cloud || cloud.cloudWorkspaceId !== route.cloudWorkspaceId || cloud.cloudProjectId !== route.cloudProjectId) {
      throw new Error('PROJECT_MODEL_SCOPE_MISMATCH')
    }
  } finally { handle.dispose() }
}
