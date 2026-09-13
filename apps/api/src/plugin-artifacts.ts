/** Immutable plugin artifact storage seam; production deployments can bind this to MinIO. */
import { Client } from 'minio'

export interface PluginArtifactStore {
  put(key: string, artifact: string): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
}

/** MinIO-backed immutable artifacts used by the enterprise API process. */
export class MinioPluginArtifactStore implements PluginArtifactStore {
  private readonly client: Client

  constructor(endpoint: string, accessKey: string, secretKey: string, private readonly bucket: string) {
    const url = new URL(endpoint)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Object storage endpoint must be an origin without credentials')
    }
    this.client = new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      accessKey,
      secretKey,
    })
  }

  async put(key: string, artifact: string): Promise<void> {
    const body = Buffer.from(artifact)
    await this.client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': 'application/json',
    })
  }

  async get(key: string): Promise<string | null> {
    try {
      const stream = await this.client.getObject(this.bucket, key)
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
      }
      return Buffer.concat(chunks).toString('utf8')
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === 'NoSuchKey' || code === 'NotFound') return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key)
  }
}

/** Deterministic in-memory store used by development and isolated tests. */
export class MemoryPluginArtifactStore implements PluginArtifactStore {
  private readonly objects = new Map<string, string>()
  put(key: string, artifact: string): Promise<void> {
    this.objects.set(key, artifact)
    return Promise.resolve()
  }
  get(key: string): Promise<string | null> { return Promise.resolve(this.objects.get(key) ?? null) }
  delete(key: string): Promise<void> {
    this.objects.delete(key)
    return Promise.resolve()
  }
}

/** Tenant-scoped object key; callers must provide opaque organization and release IDs. */
export function pluginArtifactKey(organizationId: string, releaseId: string): string {
  return `plugins/${organizationId}/${releaseId}/artifact`
}
