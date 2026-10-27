# Agent Note: Session projection checkpoints on shutdown

Status: implemented

English | [中文](2026-10-23-session-cache-shutdown.zh.md)

## Problem

A renamed Session can close before the projection cache's interval fires. Its log retains the edit while a subsequent cold listing displays the earlier title. Independent cleanup effects can also close the storage domain while a checkpoint awaits log durability.

## Decision

The [projection cache](../../../../packages/session/session-projection-cache/src/index.ts) owns final dirty checkpoints, in-flight write completion and domain closure in one asynchronous disposer. It clears interval timers, checkpoints remaining dirty Sessions, joins admitted writes and then closes the domain. Writes preserve the log-before-cache durability order and contain failures as warnings; a failed cache write still requires a later authoritative log fold.

The Session Controller also awaits the optional listing checkpoint when accepting an explicit rename, so a subsequent cold listing can retain the title independently of teardown ordering. A failed checkpoint logs a warning without reversing the committed rename.

The [cache tests](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) cover a final edit below the interval threshold and a checkpoint blocked on log durability. The [packaged Arivo regression](../../../../apps/electrobun/tests/arivo-runtime.test.ts) checks the actual Workspace ID, live and cold titles, account separation and resumed permissions. The [browser scenario](../../../../apps/web/tests/arivo-startup.e2e.ts) uses the normal OS workspace and conversation UI to rename a settled local history fixture and reopen it after full Host replacement. The fixture makes no provider request and does not establish real-account, streaming-model or native-window acceptance.

## Alternatives considered

- Wait for the configured interval before shutdown. This adds avoidable delay and fails when shutdown precedes the interval.
- Fold every Session log for a cold list. This removes the bounded listing read and increases startup work for large histories.
- Use independent flush and domain-close effects. Cordis cleanup does not serialize their asynchronous continuations, so a flush can race closure.

## Consequences

The cache disposer waits for checkpoint writes while live projections remain available; explicit rename checkpointing preserves cold titles independently of whole-Host teardown ordering. Abrupt process loss and failed storage writes can still leave stale listing hints; opening the Session restores projections from its authoritative log. Session format, Agent execution and account ownership rules remain unchanged.
