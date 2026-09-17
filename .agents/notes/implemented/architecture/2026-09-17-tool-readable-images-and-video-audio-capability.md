# Agent Note: Tool-readable images and video audio capability

Status: implemented

English | [中文](2026-09-17-tool-readable-images-and-video-audio-capability.zh.md)

## Problem

Native model modalities describe the content blocks a provider accepts. They do not describe every way an agent can obtain information from an attachment. Rejecting an image before it enters the Session prevents a text-only model from delegating the saved file to an available OCR, computer-vision, MCP, or code tool that returns text.

The `video` modality is also insufficient to describe whether a provider interprets only frames or both frames and the embedded audio track. Treating embedded audio as the standalone `audio` modality would conflate two provider guarantees and make model selectors overstate support.

## Decision

Image attachment admission is independent of the selected model's native image capability. The attachment service validates and persists the image, and the Session records its durable reference before request assembly. A native image route receives an image block. A route that explicitly omits image input receives deterministic text with the normalized attachment's current read-only execution path when both the attachment and filesystem providers expose a mapping. The text tells the model to use an available tool that returns textual analysis and to report the limitation when no such tool exists. The execution path is resolved per request and is not stored in the Session.

The built-in `read_image` tool remains restricted to native image routes because its result contains an image block. The path handle supports tools whose result is text; it does not convert a text model into a visual model or imply that such a tool is installed.

Video, audio, and document attachments use the same request-time recovery rule. Native-capable routes receive media blocks. Routes that omit a modality receive deterministic text with the current read-only execution path, allowing an available media, filesystem, code, or delegation tool to return textual analysis. When no readable path exists, the text requires the model to report that limitation. Generic `FileBlock` records and explicit media blocks share this behavior.

Model metadata carries `videoAudioMode: 'visual-only' | 'visual-and-audio'`. The stronger `visual-and-audio` guarantee is valid only for a route whose input modalities include `video`; omitted enterprise metadata resolves conservatively to `visual-only`, including routes without video input. Both values use the same provider video wire item. A `visual-only` route retains the native video block and receives an additional path handle for separate tool-based analysis of relevant embedded audio. The standalone `audio` modality continues to mean that an audio file can be submitted independently.

The LLM service owns these provider-neutral semantics. Provider adapters report exact-route metadata and serialize native inputs, the Session controller publishes it in the model catalog, and Admin plus Client surfaces configure and display it. The agent loop remains unchanged.

## Alternatives considered

**Reject images for text-only routes during prompt admission.** This guarantees that every accepted image can be sent natively, but it removes tool-based analysis before the model can select a tool and couples attachment persistence to mutable model selection.

**Allow `read_image` to run on a text-only route.** Its successful result is a durable image block, so the next request would still need native image input. Returning only metadata would claim an image-reading operation without providing visual analysis.

**Add a `video-audio` modality.** Embedded-track interpretation modifies the guarantee of one video input; it is not permission to submit an independent audio input. A separate modality would make protocol projection and UI filtering ambiguous.

## Consequences

Native and non-native media routes now share one fail-closed recovery policy. A model can inspect unsupported image, video, audio, or document input only through an available tool that can read the projected path and return text; otherwise it receives an explicit limitation. Model catalogs and selectors can distinguish frame-only video from video with embedded-audio understanding without changing OpenAI or Ark video serialization.
