/** Streaming installer storage; publication metadata and permissions remain in PostgreSQL. */
import { Readable } from 'node:stream'
import { Client } from 'minio'

/** Installer objects are private until an authenticated release points to their immutable key. */
export interface DesktopArtifactStore {
  /** Copy a verified temporary installer file into a fresh object key.
   * @param key - Fresh private object key allocated for this upload attempt.
   * @param file - Verified installer file; the caller retains ownership of its cleanup.
   * @returns Completion after storage accepts the complete installer.
   */
  putFile(key: string, file: string): Promise<void>
  /** Open installer bytes without buffering the complete object.
   * @param key - Immutable object key recorded by a published release.
   * @returns Byte stream; the response consumer owns reading or cancellation.
   */
  read(key: string): Promise<ReadableStream<Uint8Array>>
  /** Remove an object whose publication failed.
   * @param key - Object key whose publication is known not to have committed.
   * @returns Completion after the unreferenced object is removed.
   */
  delete(key: string): Promise<void>
}

/** MinIO-backed installer bytes, using the enterprise deployment's private bucket. */
export class MinioDesktopArtifactStore implements DesktopArtifactStore {
  private readonly client: Client

  constructor(endpoint: string, accessKey: string, secretKey: string, private readonly bucket: string) {
    const url = new URL(endpoint)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Object storage endpoint must be an origin without credentials')
    }
    this.client = new Client({
      endPoint: url.hostname, port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:', accessKey, secretKey,
    })
  }

  async putFile(key: string, file: string): Promise<void> {
    await this.client.fPutObject(this.bucket, key, file, { 'Content-Type': 'application/octet-stream' })
  }

  async read(key: string): Promise<ReadableStream<Uint8Array>> {
    // Node and DOM declare different BYOB overloads for the same web stream implementation.
    return Readable.toWeb(await this.client.getObject(this.bucket, key)) as unknown as ReadableStream<Uint8Array>
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key)
  }
}
