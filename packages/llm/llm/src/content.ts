/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock, MediaAttachmentRef, ModelModality, VideoAudioMode } from './types.ts'
import type { Message } from './message.ts'
import type {
  AttachmentStore, FileAttachmentRef, ImageAttachmentRef, ImageMediaType, RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Execution-world path that model tools can use to read one normalized attachment. */
export interface ImageAttachmentAccess {
  /** Absolute path to immutable normalized bytes; callers must treat it as read-only. */
  readonlyPath: string
}

/**
 * Resolve current execution-world access for one durable image reference.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when unavailable.
 */
export type ImageAttachmentAccessResolver = (ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined

/**
 * Bridge one attachment provider's host object location into the mounted
 * tool execution world. The consumer supplies the current filesystem
 * provider's mapping without making attachment or LLM definitions depend on it.
 * @param attachments - provider that owns the normalized attachment object.
 * @param mapHostPath - map one absolute host path into the current tool execution world.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when either provider exposes no mapping.
 * @throws an attachment error when the durable reference is invalid.
 */
export function resolveImageAttachmentAccess(
  attachments: AttachmentStore,
  mapHostPath: (hostPath: string) => string | undefined,
  ref: ImageAttachmentRef,
): ImageAttachmentAccess | undefined {
  const hostPath = attachments.imageHostPath(ref)
  if (hostPath === undefined) return undefined
  const readonlyPath = mapHostPath(hostPath)
  return readonlyPath === undefined ? undefined : { readonlyPath }
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

function imageIdentity(ref: ImageAttachmentRef): string {
  return ref.name === undefined
    ? String(ref.attachmentId)
    : `${quoted(ref.name)} (${ref.attachmentId})`
}

function extension(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return assertNever(mediaType, 'image extension')
  }
}

function normalizedAccessText(ref: ImageAttachmentRef, access: ImageAttachmentAccess): string {
  return ` Normalized copy (read-only; may be resized or re-encoded): ${quoted(access.readonlyPath)} (${ref.width}x${ref.height}px, ${ref.mediaType}).`
    + ' Source dimensions, format, and byte size may differ.'
    + ` Copy to a writable path ending in ${extension(ref.mediaType)} before editing.`
}

/**
 * Stable text shown to a model that cannot accept one durable image reference.
 * @param ref - durable normalized attachment omitted from the request.
 * @param access - optional path resolved for the current tool execution world.
 * @returns deterministic text-only handle with an available tool recovery path.
 */
export function textOnlyImageText(
  ref: ImageAttachmentRef,
  access?: ImageAttachmentAccess,
): string {
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  const identity = `Image ${ref.name === undefined ? '' : `${quoted(ref.name)} `}(sha256:${digest}) is attached, but this model cannot view it directly.`
  if (access === undefined) {
    return `[${identity} No readable path is available in the current execution environment. Report that limitation if the image contents are needed; do not claim to have inspected it.]`
  }
  return `[${identity}${normalizedAccessText(ref, access)} Use an available tool that can inspect this path and return a textual analysis. If no such tool is available, report that limitation; do not claim to have inspected the image.]`
}

/**
 * Stable model-facing handle for one exact request image. Identity comes from
 * the occurrence's own durable reference: request versions are prepared per
 * attachment id, so one shared version may serve occurrences whose display
 * names differ.
 * @param ref - the occurrence's durable normalized attachment.
 * @param version - exact request-image dimensions shown beside the text.
 * @param access - optional path resolved for the current tool execution world.
 * @returns attachment handle and request-image dimensions.
 */
export function requestImageHandleText(
  ref: ImageAttachmentRef,
  version: Pick<RequestImageAttachment, 'width' | 'height'>,
  access?: ImageAttachmentAccess,
): string {
  const preview = `Image ${imageIdentity(ref)}; request preview ${version.width}x${version.height}px.`
  return access === undefined
    ? `${preview} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`
    : preview + normalizedAccessText(ref, access)
}

/**
 * Stable per-image placeholder for a request-limit omission.
 * @param ref - durable normalized attachment omitted from this request.
 * @param access - optional provider-resolved path for model tools.
 * @returns identity, normalized metadata, and the available recovery path.
 */
export function offloadedImageText(
  ref: ImageAttachmentRef,
  access?: ImageAttachmentAccess,
): string {
  const identity = `image omitted to fit request image limits; ${imageIdentity(ref)}.`
  if (access === undefined) {
    return `[${identity} No local normalized image path is available; ask the user to attach it again if needed.]`
  }
  return `[${identity}${normalizedAccessText(ref, access)}]`
}

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one recursive image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

/**
 * True when typed model content contains a file block, walking nested
 * tool-result content on the same recursion every file policy shares.
 * @param content - typed model content blocks.
 * @returns whether any nested block is a file.
 */
export function contentHasFile(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'file'
    || (block.type === 'tool-result' && contentHasFile(block.content)))
}

/**
 * Map a verified stored-file MIME type to a model input modality.
 * @param ref - Durable file reference with an optional verified MIME type.
 * @returns Native input modality, or `undefined` for a generic unsupported file.
 */
export function fileMediaKind(ref: FileAttachmentRef): 'video' | 'audio' | 'document' | undefined {
  const mediaType = ref.mediaType?.toLowerCase()
  if (mediaType?.startsWith('video/')) return 'video'
  if (mediaType?.startsWith('audio/')) return 'audio'
  if (mediaType === 'application/pdf' || mediaType === 'application/json' || mediaType === 'application/xml'
    || mediaType?.startsWith('text/') || mediaType?.startsWith('application/vnd.ms-')
    || mediaType?.startsWith('application/vnd.openxmlformats-officedocument.')) return 'document'
  return undefined
}

/**
 * Test whether content contains provider-native video, audio, or document input.
 * @param content - Content tree to inspect recursively through tool results.
 * @returns Whether any native non-image media block is present.
 */
export function contentHasMedia(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'video' || block.type === 'audio' || block.type === 'document'
    || (block.type === 'tool-result' && contentHasMedia(block.content)))
}

/**
 * Create the stable tool-readable fallback for media omitted by an incompatible route.
 * @param ref - Durable media reference.
 * @param kind - Media modality rejected by the route.
 * @param readonlyPath - Execution-world path of the stored copy, when resolvable.
 * @returns Deterministic text that identifies the attachment and its available recovery path.
 */
export function mediaHandleText(
  ref: MediaAttachmentRef,
  kind: Exclude<ModelModality, 'text' | 'image'>,
  readonlyPath: string | undefined,
): string {
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  const identity = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest}) is attached, but this model cannot accept native ${kind} input.`
  if (readonlyPath === undefined) {
    return `[${identity} No readable path is available in the current execution environment. Report that limitation if its contents are needed; do not claim to have inspected it.]`
  }
  return `[${identity} Verbatim read-only copy saved at ${quoted(readonlyPath)}. Use an available tool that can inspect or process this path and return a textual analysis. Copy it to a writable location before modifying it. When delegating media work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it. If no suitable tool is available, report that limitation; do not claim to have inspected the ${kind}.]`
}

/** Create the model-visible fallback for an embedded audio track omitted by a frame-only video route. */
function videoAudioHandleText(ref: MediaAttachmentRef, readonlyPath: string | undefined): string {
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  const identity = `Video ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest}) was provided for visual analysis, but this model is not guaranteed to interpret its embedded audio track.`
  if (readonlyPath === undefined) {
    return `[${identity} No readable path is available for separate audio analysis. Report that limitation if the audio matters; do not claim to have heard or transcribed it.]`
  }
  return `[${identity} Verbatim read-only copy saved at ${quoted(readonlyPath)}. Use an available tool that can inspect or extract audio from this path and return a textual analysis. If no suitable tool is available, report that limitation; do not claim to have heard or transcribed the audio.]`
}

function replaceMediaForModel(
  blocks: readonly ContentBlock[],
  modalities: readonly ModelModality[],
  videoAudioMode: VideoAudioMode,
  resolvePath: (ref: MediaAttachmentRef) => string | undefined,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if ((block.type === 'video' || block.type === 'audio' || block.type === 'document')
      && !modalities.includes(block.type)) {
      next ??= blocks.slice(0, index)
      next.push({
        type: 'text',
        text: mediaHandleText(block.attachment, block.type, resolvePath(block.attachment)),
      })
      continue
    }
    if (block.type === 'video' && videoAudioMode === 'visual-only') {
      next ??= blocks.slice(0, index)
      next.push(block, { type: 'text', text: videoAudioHandleText(block.attachment, resolvePath(block.attachment)) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceMediaForModel(block.content, modalities, videoAudioMode, resolvePath)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Replace unsupported non-image media with deterministic text while retaining supported blocks.
 * @param messages - Complete request history.
 * @param modalities - Native inputs supported by the exact model route.
 * @param videoAudioMode - Whether native video input also interprets its embedded audio track.
 * @param resolvePath - Resolve one reference's current execution-world read path.
 * @returns Original messages when unchanged, otherwise a projected request history.
 */
export function projectMediaForModel(
  messages: readonly Message[],
  modalities: readonly ModelModality[],
  videoAudioMode: VideoAudioMode,
  resolvePath: (ref: MediaAttachmentRef) => string | undefined,
): readonly Message[] {
  if (!messages.some(message => contentHasMedia(message.content))) return messages
  const projected = messages.map((message) => {
    const content = replaceMediaForModel(message.content, modalities, videoAudioMode, resolvePath)
    return content === message.content ? message : { ...message, content }
  })
  return projected.every((message, index) => message === messages[index]) ? messages : projected
}

/**
 * Stable compatibility handle for one durable file reference when the exact
 * model route cannot accept that file as provider-native media.
 * @param ref - durable verbatim file reference.
 * @param readonlyPath - execution-world path of the stored copy, when resolvable.
 * @returns deterministic handle text naming the file, its size, and its address.
 */
export function fileHandleText(ref: FileAttachmentRef, readonlyPath: string | undefined): string {
  const kind = fileMediaKind(ref)
  if (kind !== undefined) return mediaHandleText(ref as MediaAttachmentRef, kind, readonlyPath)
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`
  if (readonlyPath === undefined) {
    return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`
  }
  return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`
}

/** Replace every file occurrence, including nested tool results, with handle text. */
function replaceFilesWithHandles(
  blocks: readonly ContentBlock[],
  resolvePath: (ref: FileAttachmentRef) => string | undefined,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'file') {
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: fileHandleText(block.attachment, resolvePath(block.attachment)) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceFilesWithHandles(block.content, resolvePath)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Project durable file history into deterministic handle text for every model
 * route. Unlike images, no provider receives file blocks natively, so this
 * projection is unconditional in request assembly.
 * @param messages - complete request history.
 * @param resolvePath - resolve one reference's current execution-world read path.
 * @returns the original list without files, otherwise shallow message copies with handle text.
 */
export function projectFilesToText(
  messages: readonly Message[],
  resolvePath: (ref: FileAttachmentRef) => string | undefined,
): readonly Message[] {
  if (!messages.some(message => contentHasFile(message.content))) return messages
  return messages.map((message) => {
    const content = replaceFilesWithHandles(message.content, resolvePath)
    return content === message.content ? message : { ...message, content }
  })
}

function replaceFilesForModel(
  blocks: readonly ContentBlock[],
  modalities: readonly ModelModality[],
  fileInputPolicy: 'unsupported' | 'inline' | 'provider-files' | 'signed-url' | undefined,
  resolvePath: (ref: FileAttachmentRef) => string | undefined,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'file') {
      next ??= blocks.slice(0, index)
      const kind = fileMediaKind(block.attachment)
      if (kind !== undefined && modalities.includes(kind) && fileInputPolicy !== undefined
        && fileInputPolicy !== 'unsupported') {
        next.push({ type: kind, attachment: block.attachment as MediaAttachmentRef })
      } else {
        next.push({ type: 'text', text: fileHandleText(block.attachment, resolvePath(block.attachment)) })
      }
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceFilesForModel(block.content, modalities, fileInputPolicy, resolvePath)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Promote verified generic files to provider-native media only when the selected model declares both the modality and a transport policy.
 * @param messages - complete request history containing durable file references.
 * @param modalities - capabilities of the exact resolved model route.
 * @param fileInputPolicy - transport supported by the exact route.
 * @param resolvePath - execution-world path used by the deterministic fallback.
 * @returns projected messages without mutating durable history.
 */
export function projectFilesForModel(
  messages: readonly Message[],
  modalities: readonly ModelModality[],
  fileInputPolicy: 'unsupported' | 'inline' | 'provider-files' | 'signed-url' | undefined,
  resolvePath: (ref: FileAttachmentRef) => string | undefined,
): readonly Message[] {
  if (!messages.some(message => contentHasFile(message.content))) return messages
  return messages.map((message) => {
    const content = replaceFilesForModel(message.content, modalities, fileInputPolicy, resolvePath)
    return content === message.content ? message : { ...message, content }
  })
}

/** Base64 length of raw image bytes, including padding. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Byte accounting and quantized removal policy for one request representation. */
export interface RequestImageOffloadPolicy {
  /** Image count accepted by the route; omission leaves count unbounded. */
  maxImages?: number
  /** Accumulated image bytes accepted by the route; omission leaves bytes unbounded. */
  maxBytes?: number
  /** Number of excess images removed as one deterministic step. */
  countQuantum?: number
  /** Number of excess bytes removed as one deterministic step. */
  byteQuantum?: number
  /** Whether byte accounting uses raw file bytes or inline base64 length. */
  representation: 'raw' | 'base64'
  /** Resolve the encoded request-version length; omission uses normalized attachment bytes. */
  byteLength?: (ref: ImageAttachmentRef) => number
  /** Build the model-visible replacement for each omitted attachment. */
  placeholder: (ref: ImageAttachmentRef) => string
}

/** Collect represented image lengths in request and nested-block order. */
function collectImageLengths(
  blocks: readonly ContentBlock[],
  lengths: number[],
  policy: RequestImageOffloadPolicy,
): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      const bytes = policy.byteLength === undefined
        ? block.attachment.bytes
        : policy.byteLength(block.attachment)
      lengths.push(policy.representation === 'base64' ? base64Length(bytes) : bytes)
    } else if (block.type === 'tool-result') {
      collectImageLengths(block.content, lengths, policy)
    }
  }
}

/** Replace the first `remaining.count` image occurrences without mutating durable messages. */
function replaceOldestImages(
  blocks: readonly ContentBlock[],
  remaining: { count: number },
  placeholder: (ref: ImageAttachmentRef) => string,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image' && remaining.count > 0) {
      remaining.count -= 1
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: placeholder(block.attachment) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceOldestImages(block.content, remaining, placeholder)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/** Replace every image occurrence, including nested tool results, for a text-only model. */
function replaceImagesForTextModel(
  blocks: readonly ContentBlock[],
  resolveAccess: ImageAttachmentAccessResolver,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image') {
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: textOnlyImageText(block.attachment, resolveAccess(block.attachment)) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceImagesForTextModel(block.content, resolveAccess)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Project durable image history into deterministic text for an exact text-only model.
 * @param messages - complete request history.
 * @param resolveAccess - resolve one reference's current execution-world read path.
 * @returns the original list without images, otherwise shallow message copies with stable tool handles.
 */
export function projectImagesForTextModel(
  messages: readonly Message[],
  resolveAccess: ImageAttachmentAccessResolver,
): readonly Message[] {
  if (!messages.some(message => contentHasImage(message.content))) return messages
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content, resolveAccess)
    return content === message.content ? message : { ...message, content }
  })
}

/**
 * Number of oldest image occurrences one request projection removes, in whole
 * count and byte quanta, once a route budget is exceeded. The result depends
 * only on the represented lengths, so provider request pricing reproduces the
 * exact serialization decision without building the projected messages.
 * @param lengths - represented byte length of every occurrence, in request order.
 * @param policy - count/byte budgets and removal quanta; unbounded when absent.
 * @returns how many leading occurrences the projection replaces with placeholders.
 */
export function offloadedImagePrefixCount(
  lengths: readonly number[],
  policy: Pick<RequestImageOffloadPolicy, 'maxImages' | 'maxBytes' | 'countQuantum' | 'byteQuantum'>,
): number {
  const total = lengths.reduce((sum, bytes) => sum + bytes, 0)
  const excessCount = policy.maxImages === undefined ? 0 : Math.max(0, lengths.length - policy.maxImages)
  const excessBytes = policy.maxBytes === undefined ? 0 : Math.max(0, total - policy.maxBytes)
  if (excessCount === 0 && excessBytes === 0) return 0
  const countQuantum = policy.countQuantum ?? 1
  const byteQuantum = policy.byteQuantum ?? 1
  const removeCount = excessCount === 0 ? 0 : Math.ceil(excessCount / countQuantum) * countQuantum
  const removeBytes = excessBytes === 0 ? 0 : Math.ceil(excessBytes / byteQuantum) * byteQuantum
  let count = 0
  let removedBytes = 0
  for (const imageBytes of lengths) {
    const byteTargetMet = removeBytes === 0
      || (byteQuantum === 1 ? removedBytes >= removeBytes : removedBytes > removeBytes)
    if (count >= removeCount && byteTargetMet) break
    removedBytes += imageBytes
    count += 1
  }
  return count
}

/**
 * Return a deterministic transient projection whose oldest images are replaced
 * in whole count and byte quanta after a route budget is exceeded. The target
 * depends only on complete durable history: at 129 one-megabyte images under
 * a 128 MiB bound with a 64 MiB quantum, the oldest 65 images are removed so
 * 64 MiB remain; that removed prefix stays fixed until total history exceeds
 * 192 MiB.
 * @param messages - complete request history, oldest first.
 * @param policy - route representation, budgets, and removal quanta.
 * @returns original messages below both bounds, otherwise shallow copies with deterministic placeholders.
 */
export function offloadRequestImagesWithPolicy(
  messages: readonly Message[],
  policy: RequestImageOffloadPolicy,
): readonly Message[] {
  const lengths: number[] = []
  for (const message of messages) collectImageLengths(message.content, lengths, policy)
  const count = offloadedImagePrefixCount(lengths, policy)
  if (count === 0) return messages
  const remaining = { count }
  return messages.map((message) => {
    const content = replaceOldestImages(message.content, remaining, policy.placeholder)
    return content === message.content ? message : { ...message, content }
  })
}
