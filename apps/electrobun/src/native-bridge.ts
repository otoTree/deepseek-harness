/* oxlint-disable @stylistic/max-len -- RPC schema declarations mirror the native bridge contract. */
import { createHash } from 'node:crypto'
import { defineElectrobunRPC, type ElectrobunRPCSchema } from 'electrobun/main/rpc'
import { openExternal, showNotification } from 'electrobun/main/utils'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pickNativeDirectory } from '@deepseek-ai/dsh-host-directory-picker-native'
import { z } from 'zod'
import { nativeNotification, validateNativeExternalUrl } from './native-bridge-policy.ts'

/** Browser-to-host requests exposed by the trusted enterprise Web UI. */
export interface EnterpriseNativeSchema extends ElectrobunRPCSchema {
  bun: {
    requests: Record<never, never>
    messages: Record<never, never>
  }
  webview: {
    requests: {
      chooseDirectory: { params: undefined; response: string | null }
      notify: { params: { title: string; body: string }; response: undefined }
      openExternal: { params: { url: string }; response: boolean }
      switchOrganization: { params: undefined; response: undefined }
      logout: { params: undefined; response: undefined }
      quit: { params: undefined; response: undefined }
      createDriveEditSession: { params: { sessionId: string; downloadUrl: string; fileName: string; versionId: string }; response: { sessionId: string; path: string; versionId: string } }
      openDriveFile: { params: { sessionId: string }; response: undefined }
      getDriveEditStatus: { params: { sessionId: string }; response: { changed: boolean; size: number; modifiedAt: number } }
      uploadDriveEdit: { params: { sessionId: string }; response: { contentBase64: string; size: number } }
      cancelDriveEditSession: { params: { sessionId: string }; response: undefined }
      closeDriveEditSession: { params: { sessionId: string }; response: undefined }
      cleanupDriveCache: { params: undefined; response: undefined }
    }
    messages: Record<never, never>
  }
}

/** Lifecycle actions owned by the desktop session rather than the WebView. */
export interface EnterpriseNativeActions {
  switchOrganization: () => void | Promise<void>
  logout: () => void | Promise<void>
  quit: () => void | Promise<void>
  drive?: DriveEditManager
}

interface DriveEditRecord { sessionId: string; path: string; versionId: string; initialSize: number; initialModifiedAt: number; initialChecksum: string }

/** Owns short-lived Office cache files and never persists object-store credentials. */
export class DriveEditManager {
  private readonly records = new Map<string, DriveEditRecord>()
  private root: string | undefined

  async create(input: { sessionId: string; downloadUrl: string; fileName: string; versionId: string }): Promise<{ sessionId: string; path: string; versionId: string }> {
    this.root ??= await mkdtemp(join(tmpdir(), 'dsh-drive-'))
    const safeName = input.fileName.replaceAll(/[^A-Za-z0-9._-]/gu, '_')
    const safeSessionId = input.sessionId.replaceAll(/[^A-Za-z0-9_-]/gu, '_')
    const path = join(this.root, `${safeSessionId}-${safeName}`)
    const response = await fetch(input.downloadUrl)
    if (!response.ok) throw new Error('Drive edit download failed')
    await writeFile(path, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 })
    const metadata = await stat(path)
    const initialChecksum = createHash('sha256').update(await readFile(path)).digest('hex')
    this.records.set(input.sessionId, { sessionId: input.sessionId, path, versionId: input.versionId, initialSize: metadata.size, initialModifiedAt: metadata.mtimeMs, initialChecksum })
    return { sessionId: input.sessionId, path, versionId: input.versionId }
  }

  open(sessionId: string): Promise<void> {
    const record = this.require(sessionId)
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', record.path] : [record.path]
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return Promise.resolve()
  }

  async status(sessionId: string): Promise<{ changed: boolean; size: number; modifiedAt: number }> {
    const record = this.require(sessionId)
    const metadata = await stat(record.path)
    if (metadata.size > 512 * 1024 * 1024) throw new Error('Drive edit exceeds maximum bridge size')
    const checksum = createHash('sha256').update(await readFile(record.path)).digest('hex')
    return { changed: checksum !== record.initialChecksum || metadata.size !== record.initialSize || metadata.mtimeMs !== record.initialModifiedAt, size: metadata.size, modifiedAt: metadata.mtimeMs }
  }

  async content(sessionId: string): Promise<{ contentBase64: string; size: number }> {
    const record = this.require(sessionId)
    const metadata = await stat(record.path)
    if (metadata.size > 512 * 1024 * 1024) throw new Error('Drive edit exceeds maximum bridge size')
    const bytes = await readFile(record.path)
    return { contentBase64: bytes.toString('base64'), size: bytes.byteLength }
  }

  async close(sessionId: string): Promise<void> { const record = this.records.get(sessionId); this.records.delete(sessionId); if (record) await rm(record.path, { force: true }) }
  async cleanup(): Promise<void> { await Promise.all([...this.records.keys()].map(sessionId => this.close(sessionId))); if (this.root) { await rm(this.root, { recursive: true, force: true }); this.root = undefined } }
  private require(sessionId: string): DriveEditRecord { const record = this.records.get(sessionId); if (!record) throw new Error('Drive edit session is unavailable'); return record }
}

/** Create the allow-listed native bridge for the enterprise window. */
export function createNativeBridge(actions: EnterpriseNativeActions) {
  const drive = actions.drive ?? new DriveEditManager()
  return defineElectrobunRPC<EnterpriseNativeSchema, 'bun'>('bun', {
    handlers: {
      requests: {},
    },
    extraRequestHandlers: {
      chooseDirectory: async () => pickNativeDirectory(new AbortController().signal),
      notify: (value: unknown) => {
        const input = nativeNotification.parse(value)
        showNotification(input)
      },
      openExternal: (value: unknown) => {
        return openExternal(validateNativeExternalUrl(value))
      },
      switchOrganization: async () => { await actions.switchOrganization() },
      logout: async () => { await actions.logout() },
      quit: async () => { await actions.quit() },
      createDriveEditSession: async (value: unknown) => drive.create(z.object({ sessionId: z.string().min(1).max(128), downloadUrl: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)), fileName: z.string().min(1).max(255), versionId: z.string().min(1) }).strict().parse(value)),
      openDriveFile: async (value: unknown) => { await drive.open(z.object({ sessionId: z.string().min(1) }).strict().parse(value).sessionId) },
      getDriveEditStatus: async (value: unknown) => drive.status(z.object({ sessionId: z.string().min(1) }).strict().parse(value).sessionId),
      uploadDriveEdit: async (value: unknown) => drive.content(z.object({ sessionId: z.string().min(1) }).strict().parse(value).sessionId),
      cancelDriveEditSession: async (value: unknown) => { await drive.close(z.object({ sessionId: z.string().min(1) }).strict().parse(value).sessionId) },
      closeDriveEditSession: async (value: unknown) => { await drive.close(z.object({ sessionId: z.string().min(1) }).strict().parse(value).sessionId) },
      cleanupDriveCache: async () => { await drive.cleanup() },
    },
  })
}
