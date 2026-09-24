# Agent Note: Enterprise cloud drive uses ID-scoped storage and navigation

Status: implemented

English | [中文](2026-09-23-enterprise-cloud-drive.zh.md)

## Problem

The enterprise client had a plugin-market surface but no shared navigation contract for a cloud drive. A path-based file UI would also make authorization and pagination ambiguous.

## Decision

The cloud drive is a `main.surface` selected by `MainNavigation`, with a sidebar action in the enterprise client. The surface keeps the current session mounted and returns to it only through the existing session-list open paths. Drive requests use opaque space and node IDs, server-side tenant checks, immutable version metadata tables, and a cursor derived from the stable `(name, id)` ordering.

The implementation stores bytes behind signed MinIO/S3 URLs and keeps immutable versions, descriptions, upload sessions, edit sessions, audit facts, and space quotas in the enterprise database. Host Agent tools and the Electrobun bridge accept only opaque IDs; the WebView never receives persistent credentials. Directory, search, and recycle-bin results use query-bound cursors, and text editing creates a new version.

New uploads reserve a server-generated node ID and select the first available name in the destination directory. A duplicate keeps its extension and receives a numeric suffix such as `(1)`; existing-node version uploads retain the node's name. An advisory transaction lock serializes name selection per directory, and active uncommitted upload sessions count as occupied names.

## Alternatives considered

**Reject duplicate names with a conflict.** Rejected because ordinary file-manager uploads should not require a manual rename and the product must not overwrite an existing node.

**Rename in the client after upload.** Rejected because the client cannot safely choose a name under concurrent uploads and would create an object before its final metadata is known.

**Generate the node ID only at commit time.** Rejected because the signed object key is created earlier; reserving the ID in the upload session keeps the object, version, and node identity consistent.

## Consequences

The single `main.surface` slot remains valid because one enterprise dispatcher renders either marketplace or drive from the surface discriminant. Session opening remains the only return-to-conversation interaction, while file permissions are recalculated from the current tenant and organization role for every API request.
