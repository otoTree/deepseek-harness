/* oxlint-disable @stylistic/max-len -- Tool schemas mirror the enterprise wire contract. */
/** Host-side Agent tools for the enterprise cloud drive. Credentials never enter tool arguments. */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ObjectValueSchemaSpec, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { DesktopKeychain } from './keychain.ts'

export const name = 'enterprise-drive-tools'
export const inject = ['tools']
export const Config = z.object({ apiUrl: z.url(), organizationId: z.uuid(), keychainHelper: z.string().refine(isAbsolute), keychainAccount: z.string().min(1), maxBytes: z.number().int().positive().max(512 * 1024 * 1024).default(16 * 1024 * 1024) }).strict()
type Settings = z.infer<typeof Config>
const credential = z.object({ apiOrigin: z.url(), organizationId: z.uuid(), token: z.string().min(32), leaseUntil: z.iso.datetime() }).loose()
type Request = (path: string, init?: RequestInit) => Promise<Response>

class DriveClient {
  private readonly settings: Settings
  private readonly keychain: DesktopKeychain
  private readonly request: Request

  constructor(input: Settings) {
    this.settings = Config.parse(input)
    this.keychain = new DesktopKeychain(this.settings.keychainHelper)
    this.request = async (path, init) => {
      const raw = await this.keychain.get(this.settings.keychainAccount)
      if (!raw) throw new Error('Enterprise credential is unavailable')
      const auth = credential.parse(JSON.parse(raw))
      if (auth.organizationId !== this.settings.organizationId || auth.apiOrigin !== new URL(this.settings.apiUrl).origin) throw new Error('Enterprise credential does not match drive organization')
      if (Date.parse(auth.leaseUntil) <= Date.now()) throw new Error('Enterprise credential has expired')
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${auth.token}`)
      const response = await fetch(new URL(`/v1/organizations/${this.settings.organizationId}/${path}`, this.settings.apiUrl), { ...init, headers })
      if (!response.ok) throw new Error(await response.text())
      return response
    }
  }

  async json(path: string, init?: RequestInit): Promise<unknown> { return (await this.request(path, init)).json() }

  async write(spaceId: string, parentId: string | null, name: string, bytes: Uint8Array, contentType: string, baseVersionId?: string, fileId?: string): Promise<unknown> {
    if (bytes.byteLength > this.settings.maxBytes) throw new Error('Drive write exceeds configured tool limit')
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const session = await this.json('drive/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId, parentId, name, size: bytes.byteLength, contentType, checksum, ...(fileId === undefined ? {} : { nodeId: fileId }) }) }) as { uploadUrl: string; uploadId: string }
    const uploaded = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: Buffer.from(bytes) })
    if (!uploaded.ok) throw new Error('Drive object upload failed')
    return this.json('drive/uploads/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: session.uploadId, ...(baseVersionId === undefined ? {} : { baseVersionId }) }) })
  }

  async read(nodeId: string): Promise<unknown> {
    const info = await this.json(`drive/files/${encodeURIComponent(nodeId)}/download`) as { url: string; versionId: string; checksum: string }
    const response = await fetch(info.url)
    if (!response.ok) throw new Error('Drive object download failed')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > this.settings.maxBytes) throw new Error('Drive read exceeds configured tool limit')
    return { ...info, bytes: Buffer.from(bytes).toString('base64'), size: bytes.byteLength }
  }
}

const jsonOutput: { schema: ObjectValueSchemaSpec; render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{ type: 'text'; text: string }] } = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const idParams: ParameterSchemaSpec = { space_id: { type: 'string', required: true }, parent_id: { type: 'string' }, cursor: { type: 'string' } }
const value = (args: Record<string, unknown>, key: string): string | undefined => typeof args[key] === 'string' ? args[key] : undefined

/** Register the ID-scoped cloud-drive tools for the current Agent. */
export function apply(ctx: Context, input: Settings): void {
  const drive = new DriveClient(input)
  const register = (toolName: string, description: string, parameters: ParameterSchemaSpec, execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>): void => { ctx.tools.register(defineTool<ParameterSchemaSpec, ObjectValueSchemaSpec>({ name: toolName, description, parameters, output: jsonOutput, execute: args => execute(args as Record<string, unknown>).then(value => value as Record<string, never>) })) }
  register('list_folder', 'List an authorized cloud-drive folder using a cursor.', idParams, args => drive.json(`drive/files?spaceId=${encodeURIComponent(value(args, 'space_id') ?? '')}&parentId=${encodeURIComponent(value(args, 'parent_id') ?? '')}${value(args, 'cursor') ? `&cursor=${encodeURIComponent(value(args, 'cursor') ?? '')}` : ''}`) as Promise<Record<string, unknown>>)
  register('search_files', 'Search authorized files by name, type, and active descriptions.', { space_id: { type: 'string', required: true }, query: { type: 'string', required: true }, cursor: { type: 'string' } }, args => drive.json(`drive/search?spaceId=${encodeURIComponent(value(args, 'space_id') ?? '')}&query=${encodeURIComponent(value(args, 'query') ?? '')}${value(args, 'cursor') ? `&cursor=${encodeURIComponent(value(args, 'cursor') ?? '')}` : ''}`) as Promise<Record<string, unknown>>)
  register('read_file', 'Read an authorized file version as bounded base64 content.', { file_id: { type: 'string', required: true } }, args => drive.read(value(args, 'file_id') ?? '') as Promise<Record<string, unknown>>)
  register('write_file', 'Write a new immutable file version with an optional version precondition.', { space_id: { type: 'string', required: true }, file_id: { type: 'string' }, parent_id: { type: 'string' }, name: { type: 'string', required: true }, content_base64: { type: 'string', required: true }, content_type: { type: 'string', required: true }, base_version_id: { type: 'string' } }, (args) => {
    const encoded = value(args, 'content_base64') ?? ''
    const bytes = Buffer.from(encoded, 'base64')
    return drive.write(value(args, 'space_id') ?? '', value(args, 'parent_id') ?? null, value(args, 'name') ?? '', bytes, value(args, 'content_type') ?? 'application/octet-stream', value(args, 'base_version_id'), value(args, 'file_id')) as Promise<Record<string, unknown>>
  })
  register('create_folder', 'Create an authorized folder by space and parent IDs.', { ...idParams, name: { type: 'string', required: true } }, args => drive.json('drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId: value(args, 'space_id'), parentId: value(args, 'parent_id') ?? null, name: value(args, 'name') }) }) as Promise<Record<string, unknown>>)
  register('move_file', 'Move an authorized file or folder by IDs.', { file_id: { type: 'string', required: true }, parent_id: { type: 'string' }, base_version_id: { type: 'string' } }, args => drive.json(`drive/files/${encodeURIComponent(value(args, 'file_id') ?? '')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: value(args, 'file_id'), parentId: value(args, 'parent_id') ?? null, baseVersionId: value(args, 'base_version_id') ?? null }) }) as Promise<Record<string, unknown>>)
  register('rename_file', 'Rename an authorized file or folder by ID.', { file_id: { type: 'string', required: true }, name: { type: 'string', required: true }, base_version_id: { type: 'string' } }, args => drive.json(`drive/files/${encodeURIComponent(value(args, 'file_id') ?? '')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: value(args, 'file_id'), name: value(args, 'name'), baseVersionId: value(args, 'base_version_id') ?? null }) }) as Promise<Record<string, unknown>>)
  register('create_file_description', 'Create a version-bound file description.', { file_id: { type: 'string', required: true }, version_id: { type: 'string' }, type: { type: 'string', required: true }, content: { type: 'string', required: true }, source: { type: 'string', required: true } }, args => drive.json('drive/descriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: value(args, 'file_id'), versionId: value(args, 'version_id') ?? null, type: value(args, 'type'), content: value(args, 'content'), source: value(args, 'source') }) }) as Promise<Record<string, unknown>>)
  register('list_file_descriptions', 'List active descriptions for an authorized file.', { file_id: { type: 'string', required: true } }, args => drive.json(`drive/files/${encodeURIComponent(value(args, 'file_id') ?? '')}/descriptions`) as Promise<Record<string, unknown>>)
  register('update_file_description', 'Update a description with an optimistic timestamp precondition.', { description_id: { type: 'string', required: true }, file_id: { type: 'string', required: true }, type: { type: 'string', required: true }, content: { type: 'string', required: true }, base_updated_at: { type: 'string' } }, args => drive.json(`drive/descriptions/${encodeURIComponent(value(args, 'description_id') ?? '')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: value(args, 'file_id'), versionId: null, type: value(args, 'type'), content: value(args, 'content'), source: 'agent', ...(value(args, 'base_updated_at') === undefined ? {} : { baseUpdatedAt: value(args, 'base_updated_at') }) }) }) as Promise<Record<string, unknown>>)
  register('supersede_file_description', 'Mark an authorized description as superseded.', { description_id: { type: 'string', required: true } }, args => drive.json(`drive/descriptions/${encodeURIComponent(value(args, 'description_id') ?? '')}/supersede`, { method: 'POST' }) as Promise<Record<string, unknown>>)
}
