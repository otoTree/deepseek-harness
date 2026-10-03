/** Cloud workspace sandbox service contract with a fail-closed in-memory adapter. */
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'

export const workspaceId = z.string().uuid().brand<'WorkspaceId'>()
export const workspaceCreate = z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(1).max(120), image: z.string().trim().min(1).max(120).default('dsh-base') }).strict()
export const workspaceLease = z.object({ leaseId: z.string().uuid(), expiresAt: z.iso.datetime() }).strict()
export type Workspace = { id: string; organizationId: string; name: string; image: string; status: 'stopped' | 'starting' | 'running' | 'failed'; leaseId?: string; leaseUntil?: string }
export interface WorkspaceBackend {
  create(input: z.infer<typeof workspaceCreate>): Promise<Workspace>
  list(organizationId: string): Promise<Workspace[]>
  start(id: string): Promise<Workspace>
  stop(id: string): Promise<Workspace>
  destroy(id: string): Promise<void>
  lease(id: string): Promise<z.infer<typeof workspaceLease>>
}
/** Memory backend for API contract tests; production deployments inject an E2B backend. */
export class MemoryWorkspaceBackend implements WorkspaceBackend {
  private readonly workspaces = new Map<string, Workspace>()
  async create(input: z.infer<typeof workspaceCreate>): Promise<Workspace> { const workspace: Workspace = { id: randomUUID(), ...input, status: 'stopped' }; this.workspaces.set(workspace.id, workspace); return workspace }
  async list(organizationId: string): Promise<Workspace[]> { return [...this.workspaces.values()].filter(item => item.organizationId === organizationId) }
  async start(id: string): Promise<Workspace> { return this.update(id, { status: 'running' }) }
  async stop(id: string): Promise<Workspace> {
    const current = this.workspaces.get(id)
    if (!current) throw new Error('WORKSPACE_NOT_FOUND')
    const { leaseId: _leaseId, leaseUntil: _leaseUntil, ...withoutLease } = current
    const next: Workspace = { ...withoutLease, status: 'stopped' }
    this.workspaces.set(id, next)
    return next
  }
  async destroy(id: string): Promise<void> { this.workspaces.delete(id) }
  async lease(id: string): Promise<z.infer<typeof workspaceLease>> { const expiresAt = new Date(Date.now() + 60_000).toISOString(); const leaseId = randomUUID(); this.update(id, { status: 'running', leaseId, leaseUntil: expiresAt }); return { leaseId, expiresAt } }
  private update(id: string, patch: Partial<Workspace>): Workspace { const current = this.workspaces.get(id); if (!current) throw new Error('WORKSPACE_NOT_FOUND'); const next = { ...current, ...patch }; this.workspaces.set(id, next); return next }
}
/** Create the cloud workspace HTTP surface. Authentication and tenant checks belong to the API gateway. */
export function createSandboxApplication(backend: WorkspaceBackend = new MemoryWorkspaceBackend()): Hono {
  const app = new Hono()
  app.get('/health', c => c.json({ service: 'sandbox', status: 'ok' }))
  app.post('/v1/workspaces', async c => c.json(await backend.create(workspaceCreate.parse(await c.req.json())), 201))
  app.get('/v1/organizations/:organizationId/workspaces', async c => c.json(await backend.list(c.req.param('organizationId'))))
  app.post('/v1/workspaces/:id/start', async c => c.json(await backend.start(workspaceId.parse(c.req.param('id')))))
  app.post('/v1/workspaces/:id/stop', async c => c.json(await backend.stop(workspaceId.parse(c.req.param('id')))))
  app.post('/v1/workspaces/:id/lease', async c => c.json(await backend.lease(workspaceId.parse(c.req.param('id')))))
  app.delete('/v1/workspaces/:id', async (c) => { await backend.destroy(workspaceId.parse(c.req.param('id'))); return c.json({ deleted: true }) })
  return app
}
/** Backward-compatible alias for callers that used the prototype constructor. */
export const createSandboxPrototype = createSandboxApplication
