# Agent Note: Enterprise Runtime reuses its Web port

Status: implemented

English | [中文](2026-09-20-enterprise-runtime-reuses-web-port.zh.md)

## Problem

The Enterprise desktop Runtime selected an operating-system port with `--port 0` on every start. A browser document that survived a Runtime restart kept requesting the old loopback origin, so the Client module loader reported a generic bundle-load failure even when the current plugin bundle was healthy.

## Decision

The organization Runtime stores the last successful Web port in its organization home and probes that port before startup. A free remembered port is passed to the DSH process; an occupied or invalid value falls back to an operating-system-assigned port. The Runtime records the newly reported port before exposing the Web URL to the desktop session. The browser loader also probes a failed bundle request with `HEAD` and reports HTTP, network, or browser-rejection details.

## Alternatives considered

**Keep selecting a random port on every start.** This leaves surviving browser documents bound to an origin that cannot recover after a restart.

**Use one repository-wide fixed port.** A global port collides with personal Web processes and concurrent organization runtimes; the organization home already provides the correct ownership scope.

**Change only the generic browser error text.** Better diagnostics would identify the failure but would not let a stale document reconnect to the same loopback origin.

## Consequences

Repeated starts of one organization normally preserve the browser origin and its authority-bound cookie. Port collisions remain safe: the Runtime falls back to a fresh port and publishes that URL to the desktop host. The remembered file contains only a port number and is scoped by the existing organization lock and home permissions.

## Verification

The Runtime lifecycle tests cover the initial random port and reuse of the reported port after a clean restart. Client module loader tests continue to cover script cleanup and load failures. Electrobun and Client module TypeScript projects typecheck successfully.
