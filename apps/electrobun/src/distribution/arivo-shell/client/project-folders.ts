/** Exact-frame native project controls. The creative iframe cannot supply a path. */
import { z } from 'zod'
const requestSchema = z.object({ version: z.literal(1), type: z.literal('arivo:project-folder'), id: z.uuid(),
  operation: z.enum(['get', 'bind', 'conversation', 'create', 'recover']), projectId: z.uuid().optional(), conversationId: z.uuid().optional(),
  commandId: z.uuid().optional(), creation: z.object({ commandId: z.uuid(), title: z.string().trim().min(1).max(160),
    synopsis: z.string().max(5000),
    cloudWorkspaceId: z.uuid(), cloudProjectId: z.uuid().optional(), folderMode: z.enum(['new', 'existing']) }).strict().optional(),
  scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict()
export type FolderRequest = Omit<z.infer<typeof requestSchema>, 'id' | 'type'>

/** Install when a verified-origin iframe mounts; duplicate concurrent requests do not reopen the chooser.
 * @param frame - Owning creative iframe.
 * @param origin - Verified loopback plugin origin.
 * @param request - Original OS authenticated RPC operation.
 * @returns disposer cancelling the request and removing the frame listener.
 */
export function installProjectFolders(frame: HTMLIFrameElement, origin: string,
  request: (input: FolderRequest, signal: AbortSignal) => Promise<unknown>): () => void {
  const controller = new AbortController()
  let pending = false
  const receive = async (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin || pending) return
    const parsed = requestSchema.safeParse(event.data)
    if (!parsed.success) return
    const { id, type: _type, ...input } = parsed.data
    pending = true
    let result: unknown
    try { result = { ok: true, value: await request(input, controller.signal) } }
    catch (error) {
      const code = error instanceof Error ? error.message : ''
      const allowed = new Set(['PROJECT_FOLDER_CONFLICT', 'PROJECT_FOLDER_INVALID', 'PROJECT_FOLDER_ACCOUNT', 'LOCAL_SCOPE_CHANGED', 'COMMAND_CONFLICT', 'CLOUD_NOT_FOUND', 'CLOUD_PERMISSION_DENIED', 'CLOUD_SIGN_IN_REQUIRED', 'CLOUD_COMMAND_EXPIRED', 'CLOUD_CONNECTION_LOST'])
      result = { ok: false, ...(allowed.has(code) ? { code } : {}) }
    }
    finally { pending = false }
    if (!controller.signal.aborted) frame.contentWindow?.postMessage({ version: 1, type: 'arivo:project-folder-result', id, result }, origin)
  }
  const received = (event: MessageEvent) => { void receive(event) }
  window.addEventListener('message', received)
  return () => { controller.abort(); window.removeEventListener('message', received) }
}
