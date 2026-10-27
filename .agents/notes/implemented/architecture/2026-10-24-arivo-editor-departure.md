# Agent Note: Arivo editor departure before view removal

Status: implemented

English | [中文](2026-10-24-arivo-editor-departure.zh.md)

## Problem

An iframe editor's local navigation can await SQLite acknowledgement, but an outer Rail or Workbench transition removes that document without consulting its guard. A `beforeunload` warning does not protect iframe removal. A lost response can leave a durable mutation unacknowledged while its original text and command identity remain in the editor.

## Decision

The Arivo startup plugin owns departure leases. Main navigation exposes a single optional transition handler; Workbench tab/file gestures use it. The Session controller independently offers a single optional selection handler for explicit user navigation. Consumers without owners retain synchronous behavior. These hooks add no persistence, Provider work or model-visible state.

The parent asks every mounted Studio frame to prepare departure, with a fresh request id and exact target origin. The child accepts only its Host-injected parent origin and parent window, freezes editor input and open dialogs, then invokes its existing local save guard. Dirty open forms refuse departure. Only an exact current acknowledgement from the registered frame can grant departure. A missing, malformed, late or refused acknowledgement retains the old view. Deadline expiry never grants permission.

Synchronous callbacks belonging to the same input event share one preparation, so selecting a Session and returning to conversation commit together. Later intents during preparation are refused. Input freezes survive through the synchronous React commit and then release. A changed editor roster or startup disposal cancels pending navigation. Locale/appearance iframe reloads use the same coordinator. Arivo's Workbench entry waits for an addressable Session before enabling activation.

Arivo native menu quit and user window close synchronously veto native destruction, then ask the same coordinator for a retained freeze. A one-use, bounded loopback callback accepts only the current OS origin, request id and decision fields; sandboxed pages receive no general native RPC. Missing startup code, dirty dialogs, failed persistence, timeout or generation invalidation refuses shutdown. A granted freeze also makes the OS document inert, preventing late-mounted frames from accepting input, and survives through awaited runtime stop. Release restores the document’s prior inert state. Release cancels late preparation and restores input when shutdown fails. Signal-driven stop and forced termination retain their existing unprotected semantics.

## Alternatives considered

**Rely on `beforeunload`.** Iframe removal can bypass it, leaving the parent unable to distinguish a saved draft from an unacknowledged mutation.

**Store business drafts in browser storage.** That introduces a second persistence owner and complicates the Host's account epoch and SQLite revision rules. Departure instead reuses the existing Worker command and receipt.

**Guard all products unconditionally.** Enterprise consumers keep their existing synchronous behavior; only an explicit startup owner activates asynchronous coordination.

## Consequences

The startup plugin depends on the new optional selection hook in its packaged Harness. No shared dependency versions change. The independent creative plugin is consumed only as a verified release. Forced process termination, Host-authoritative account/list changes and registration teardown are not granted editor safety by these UI hooks; those lifecycle gates require their own implementation and acceptance. This decision supplements the [native browser retention decision](2026-10-16-shared-browser-page.md); it does not replace that browser's resource lifetime.
