/** Object storage seam for cloud-drive bytes. Metadata and authorization stay in Postgres. */
import { createHash } from 'node:crypto'
import { Client } from 'minio'

export interface DriveObjectMetadata {
  size: number
  contentType: string
  checksum: string
}

export interface DriveObjectStore {
  createUploadUrl(key: string, expiresSeconds: number): Promise<string>
  createDownloadUrl(key: string, expiresSeconds: number): Promise<string>
  inspect(key: string): Promise<DriveObjectMetadata>
  delete(key: string): Promise<void>
}

/** MinIO/S3 compatible implementation using server-side presigned URLs. */
export class MinioDriveObjectStore implements DriveObjectStore {
  private readonly client: Client

  constructor(
    endpoint: string,
    accessKey: string,
    secretKey: string,
    private readonly bucket: string,
  ) {
    const url = new URL(endpoint)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('Object storage endpoint must be an origin without credentials')
    this.client = new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:', accessKey, secretKey,
    })
  }

  createUploadUrl(key: string, expiresSeconds: number): Promise<string> {
    return this.client.presignedPutObject(this.bucket, key, expiresSeconds)
  }

  createDownloadUrl(key: string, expiresSeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expiresSeconds)
  }

  async inspect(key: string): Promise<DriveObjectMetadata> {
    const stat = await this.client.statObject(this.bucket, key)
    const metadata = Reflect.get(stat, 'metaData') as Record<string, string>
    const object = await this.client.getObject(this.bucket, key)
    const hash = createHash('sha256')
    for await (const chunk of object) hash.update(chunk)
    const checksum = hash.digest('hex')
    return { size: Reflect.get(stat, 'size') as number, contentType: metadata['content-type'] ?? 'application/octet-stream', checksum }
  }

  delete(key: string): Promise<void> {
    return this.client.removeObject(this.bucket, key)
  }
}

/** Deterministic store used by isolated API tests. */
export class MemoryDriveObjectStore implements DriveObjectStore {
  private readonly objects = new Map<string, DriveObjectMetadata>()

  seed(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { size: bytes.byteLength, contentType, checksum: createHash('sha256').update(bytes).digest('hex') })
  }

  createUploadUrl(key: string): Promise<string> {
    return Promise.resolve(`memory://upload/${encodeURIComponent(key)}`)
  }

  createDownloadUrl(key: string): Promise<string> {
    return Promise.resolve().then(() => {
      if (!this.objects.has(key)) throw new Error('Object does not exist')
      return `memory://download/${encodeURIComponent(key)}`
    })
  }

  inspect(key: string): Promise<DriveObjectMetadata> {
    return Promise.resolve().then(() => {
      const value = this.objects.get(key)
      if (value === undefined) throw new Error('Object does not exist')
      return value
    })
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key)
    return Promise.resolve()
  }
}

/** Server-owned object key; clients never provide this value. */
export function driveObjectKey(spaceId: string, nodeId: string, versionId: string): string {
  return `drive/${spaceId}/${nodeId}/${versionId}`
}
