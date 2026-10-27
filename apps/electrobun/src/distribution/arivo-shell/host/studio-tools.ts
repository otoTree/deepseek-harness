/** Original Harness tool registry delegates creative operations to the bundled local Host. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { arivoStepCommand } from './language-mapping.ts'
import { registerCanvasTools } from './canvas-tools.ts'

/** Register one model-visible tool through the startup-owned registry and execution adapter. */
export type ArivoStudioToolRegistrar = (
  name: string, description: string, properties: Record<string, JsonSchemaNode>, required: string[],
  request: (args: Record<string, unknown>, commandId: string) => unknown, write?: boolean) => void

/** Versioned native API, consumed without importing the independent plugin's source. */
export interface ArivoStudioToolHost {
  studioSessionForFolder?(path: string): Promise<{
    protocolVersion: number
    request(input: unknown, signal: AbortSignal): Promise<unknown>
    dispose(): void
  }>
  studioSession(): Promise<{ protocolVersion: number; request(input: unknown, signal: AbortSignal): Promise<unknown>; dispose(): void }>
}
const id: JsonSchemaNode = { type: 'string', description: 'Exact local UUID returned by Arivo tools, never a cloud ID.' }
const revision: JsonSchemaNode = { type: 'integer', description: 'Current local revision. Read again on conflict; never guess.' }
const project = { projectId: id }, episode = { ...project, episodeId: id }
const text = (maxLength: number): JsonSchemaNode => ({ type: 'string', description: `At most ${maxLength} characters.` })
const fields = {
  title: text(255),
  durationMs: { type: 'integer', description: '4000–30000 milliseconds, whole seconds.' },
  sceneHeading: text(1000), dialogue: text(10000), videoPrompt: text(10000),
  shotSize: text(100), cameraAngle: text(100), cameraMovement: text(100),
} satisfies Record<string, JsonSchemaNode>
const shotFields: JsonSchemaNode = { type: 'object', additionalProperties: false, properties: fields, required: Object.keys(fields) }

/** Register lifecycle-owned tools for normal and delegated Harness Agents.
 * @param ctx - Startup context owning policy, registrations and Session logs.
 * @param host - Verified creative plugin's native service.
 */
export function registerStudioTools(ctx: Context, host: ArivoStudioToolHost): void {
  const add: ArivoStudioToolRegistrar = (name, description, properties, required, request, write = false) => {
    const tool: ToolDefinition = {
      name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      presentCall: () => ({ card: 'generic', kind: write ? 'edit' : 'read', title: name }),
      presentResult: (_args, result) => ({ card: 'generic', title: name, content: result.content }),
      async execute(raw, exec) {
        exec.signal.throwIfAborted()
        if (!exec.agent) throw new Error('Arivo creative tools require a Harness Agent Session.')
        const commandId = arivoStepCommand(String(exec.agent.session.id), `studio:${name}:${String(exec.callId)}`)
        let handle: Awaited<ReturnType<ArivoStudioToolHost['studioSession']>> | undefined
        try {
          const cwd = exec.agent.session.header.cwd
          if (host.studioSessionForFolder) {
            if (!cwd) throw Object.assign(new Error('PROJECT_FOLDER_REQUIRED'), { code: 'PROJECT_FOLDER_REQUIRED' })
            handle = await host.studioSessionForFolder(cwd)
          } else handle = await host.studioSession()
          if (handle.protocolVersion !== 1) throw new Error('ARIVO_STUDIO_PROTOCOL_UNAVAILABLE')
          const result = await handle.request(request(raw as Record<string, unknown>, commandId), exec.signal)
          if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error('ARIVO_STUDIO_RESULT_LIMIT')
          return result
        } catch (error: unknown) {
          const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'ARIVO_STUDIO_REQUEST_FAILED'
          throw new Error(code)
        } finally { handle?.dispose() }
      },
    }
    ctx.effect(() => ctx.tools.register(tool), `arivo: ${name}`)
  }
  add('arivo_list_projects', 'List the Arivo project bound to this conversation’s folder. Local tools never execute models or charge credits.', {}, [], () => ({ type: 'projects' }))
  add('arivo_list_episodes', 'List local script episodes and draft revisions.', project, ['projectId'], args => ({ type: 'episodes', ...args }))
  add('arivo_read_script', 'Read a local script (16000 characters/page) and revision/latest saved version. Follow nextOffset to read the rest.',
    { ...episode, offset: { type: 'integer' } }, ['projectId', 'episodeId'], args => ({ type: 'script', ...args }))
  add('arivo_create_episode', 'Create a local episode with an empty script. Use the returned episode ID to write script text or create storyboard shots directly.',
    { ...project, title: text(255), synopsis: text(10000) }, ['projectId', 'title'],
    (args, commandId) => ({ type: 'createEpisode', input: { synopsis: '', ...args, commandId } }), true)
  add('arivo_write_script', 'Replace the complete local draft at its exact revision (max 64000 characters). Read the complete old draft first. Conflicts refuse to overwrite newer edits.',
    { ...episode, expectedRevision: revision, content: text(64000) }, ['projectId', 'episodeId', 'expectedRevision', 'content'],
    (args, commandId) => ({ type: 'saveScript', input: { ...args, commandId } }), true)
  add('arivo_save_script_version', 'Save an immutable local script version at the current revision. Optional for storyboard authoring: creating the first shot automatically binds an empty script when no source exists.',
    { ...episode, expectedRevision: revision }, ['projectId', 'episodeId', 'expectedRevision'],
    (args, commandId) => ({ type: 'saveVersion', input: { ...args, commandId } }), true)
  add('arivo_list_shots', 'List active local shot summaries and board revision (0 when unbound). Read existing shots before continuing their prompts. Follow nextCursor using after and the same expectedRevision.',
    { ...episode, after: { type: 'integer' }, expectedRevision: revision }, ['projectId', 'episodeId'], args => ({ type: 'shots', input: args }))
  add('arivo_read_shot', 'Read a complete local shot with its fixed script and material references.',
    { ...episode, shotId: id }, ['projectId', 'episodeId', 'shotId'], args => ({ type: 'shot', ...args }))
  add('arivo_bind_storyboard', 'Bind a saved script version to this episode’s storyboard. Read board revision first (0 if unbound). Existing shot snapshots remain fixed.',
    { ...episode, expectedRevision: revision, scriptVersionId: id }, ['projectId', 'episodeId', 'expectedRevision', 'scriptVersionId'],
    (args, commandId) => ({ type: 'storyboard', input: { ...args, commandId, kind: 'bindSource' } }), true)
  add('arivo_create_shot', 'Write one storyboard shot and its complete videoPrompt from the conversation. No script preparation or binding is required: the first shot automatically binds an empty script when unbound. For continuous authoring, write shots in order and use each returned binding.revision as the next expectedRevision; keep characters, scene, action and camera continuity. Read again on revision conflict. Does not generate image/video. Bind optional materials in the creative workspace.',
    { ...episode, expectedRevision: revision, fields: shotFields }, ['projectId', 'episodeId', 'expectedRevision', 'fields'],
    (args, commandId) => ({ type: 'storyboard', input: { ...args, commandId, kind: 'create', settings: [], previewVersionId: null } }), true)
  add('arivo_edit_shot', 'Update one storyboard shot and its complete videoPrompt at the current board revision. Read the shot first, preserve its previewVersionId and fixed materials, then use the returned binding.revision for subsequent writes. Read again on conflict; never overwrite newer user edits.',
    { ...episode, expectedRevision: revision, shotId: id, fields: shotFields, previewVersionId: { oneOf: [id, { type: 'null' }] } },
    ['projectId', 'episodeId', 'expectedRevision', 'shotId', 'fields', 'previewVersionId'],
    (args, commandId) => ({ type: 'storyboard', input: { ...args, commandId, kind: 'edit' } }), true)
  registerCanvasTools(add)
}
