# Agent Note: Assistant stream diagnostics

Status: implemented

English | [中文](2026-09-14-assistant-stream-diagnostics.zh.md)

## Problem

Client projections can encounter malformed compact Assistant stream records while reconstructing a session. A validation failure without its position in the stream makes the affected durable event difficult to identify.

## Decision

Assistant stream expansion keeps strict record validation and wraps failures with the record index, record type, and original validation message. The original error is retained as the cause.

## Consequences

Session projection logs identify the exact invalid record without accepting malformed data or changing stream reconstruction semantics.

## Testing

The Assistant stream suite covers indexed diagnostics and all existing malformed-record assertions.
