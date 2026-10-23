# Agent Note: Package marketplace icons with plugin releases

Status: implemented

English | [中文](2026-10-21-packaged-marketplace-icons.zh.md)

## Problem

Plugin catalog rows need release-owned artwork before a plugin is installed. Runtime slot icons cannot supply this information, and remote logo requests expose catalog browsing to external providers and fail offline.

## Decision

The optional manifest `icon` contains a bounded PNG data URL. The [protocol schema](../../../../packages/plugin/protocol/src/index.ts) checks the encoding, PNG header, dimensions and terminal chunk. The [ZIP parser](../../../../apps/api/src/plugin-package.ts) and [catalog reader](../../../../packages/client/ui-enterprise/src/wire.ts) reuse that field definition. Manifest integrity covers the image, and the [organization catalog](../../../../apps/api/src/plugins.ts) returns it only with a visible release.

The market renders the image beside the visible plugin name. Missing or undecodable artwork uses the first two name characters, and a changed image resets its failure state. Artwork is decorative and does not add duplicate accessible names. The [rail metadata decision](2026-10-04-rail-plugin-icons-and-labels.md) independently owns executable icons contributed by mounted slots; it is not superseded.

## Alternatives considered

**Fetch provider logos while browsing.** This makes availability and privacy depend on external image servers.

**Serve ZIP assets through another authenticated endpoint.** This requires a separate image authentication or proxy path for the native Host’s credentials. A bounded embedded image fits the existing catalog and its response limit.

## Consequences

Public releases require new versions to add or replace artwork. Existing releases without images remain readable. PNG excludes active SVG markup, and byte and dimension limits bound catalog growth and image size. Browser decoding still determines whether an image can render; invalid pixel data receives the name fallback. Artwork does not enter model requests or Session events.

## Verification

Protocol and ZIP tests exercise accepted PNGs, absent fields, unsupported formats, malformed headers and size limits. The API identity test uploads a ZIP and reads its exact image back through the authorized catalog. Client tests cover absent and undecodable images. The [recorded-session browser case](../../../../apps/web/tests/plugin-market-icons.e2e.ts) uses verified package metadata, loads the built Client through Loader, checks decoded images without external requests, refreshes a changed image, and pins the [visible result](../../../../snapshots/web/plugin-market-icons/icons.expected.md).
