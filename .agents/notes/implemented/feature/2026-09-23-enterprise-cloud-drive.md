# Agent Note: Enterprise cloud drive uses ID-scoped storage and navigation

Status: implemented

English | [中文](2026-09-23-enterprise-cloud-drive.zh.md)

## Problem

The enterprise client had a plugin-market surface but no shared navigation contract for a cloud drive. A path-based file UI would also make authorization and pagination ambiguous.

## Decision

The cloud drive is a `main.surface` selected by `MainNavigation`, with a sidebar action in the enterprise client. The surface keeps the current session mounted and returns to it only through the existing session-list open paths. Drive requests use opaque space and node IDs, server-side tenant checks, immutable version metadata tables, and a cursor derived from the stable `(name, id)` ordering.

The implementation stores bytes behind signed MinIO/S3 URLs and keeps immutable versions, descriptions, upload sessions, edit sessions, audit facts, and space quotas in the enterprise database. Host Agent tools and the Electrobun bridge accept only opaque IDs; the WebView never receives persistent credentials. Directory, search, and recycle-bin results use query-bound cursors, and text editing creates a new version.

New uploads reserve a server-generated node ID and select the first available name in the destination directory. A duplicate keeps its extension and receives a numeric suffix such as `(1)`; existing-node version uploads retain the node's name. An advisory transaction lock serializes name selection per directory, and active uncommitted upload sessions count as occupied names.

Ownership and sharing are separate records. Nodes retain a creator and an optional organization-scoped audience; null inherits the nearest folder policy. New roots receive a private policy. Organization creators and administrators retain management access, while personal-space management stays with its owner. Recipients receive view or edit access through named members, department assignments with an explicit descendant choice, or the entire active organization. A department shortcut resolves to concrete IDs before saving. Existing organization roots retain their audience so deployment does not interrupt established access.

One database permission function serves collection predicates and direct-node authorization. Shared personal roots appear in Shared with me without moving ownership or exposing private siblings. Commit checks bind uploads to their creator and recheck current destination access. Moves preserve the effective audience and reject directory cycles. Previously issued signed URLs expire according to the configured lifetime rather than being revoked by a sharing edit.

The sharing editor follows the existing enterprise modal and form styling with semantic theme tokens. Department and member filtering retains the complete draft so hidden recipients cannot be accidentally removed by a search. The scrollable body keeps save controls reachable on narrow screens.

## Alternatives considered

**Reject duplicate names with a conflict.** Rejected because ordinary file-manager uploads should not require a manual rename and the product must not overwrite an existing node.

**Rename in the client after upload.** Rejected because the client cannot safely choose a name under concurrent uploads and would create an object before its final metadata is known.

**Generate the node ID only at commit time.** Rejected because the signed object key is created earlier; reserving the ID in the upload session keeps the object, version, and node identity consistent.

**Transfer personal files into the organization when sharing.** Rejected because access grants do not imply a change of ownership or expose the owner's other files.

**Treat an organization space as an all-member grant.** Rejected because department documents need restricted audiences even when the organization owns them. Existing broad grants are persisted explicitly rather than inferred from the space for new files.

## Consequences

The single `main.surface` slot remains valid because one enterprise dispatcher renders either marketplace or drive from the surface discriminant. Session opening remains the only return-to-conversation interaction, while file permissions are recalculated from the current tenant, saved audience, active membership and department assignments for every API request.
