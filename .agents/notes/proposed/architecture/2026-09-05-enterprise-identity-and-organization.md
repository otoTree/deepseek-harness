# Agent Note: Enterprise identity and organization model

Status: proposed

English | [中文](2026-09-05-enterprise-identity-and-organization.zh.md)

## Problem

The commercial platform must support individual sign-up, enterprise departments, subsidiaries, teams, billing, and private deployment without maintaining separate user and tenant models. If sessions, plugins, usage, or permissions are attached directly to a user, ownership and delegated administration become ambiguous and the open and private editions drift apart.

## Proposal

- Treat `Account` as a human or service identity. Every business operation runs in an `Organization` context and records its opaque `organization_id`.
- Represent a personal space as a `Organization(kind: team)` with one membership. It is not a separate workspace table; the same subscription and quota machinery applies.
- Connect identities with `Membership`; bind roles with `RoleBinding` at organization or `OrgUnit` scope. Model departments, subsidiaries, teams, projects, and cost centers as a single extensible `OrgUnit` tree.
- Bind `Subscription` to the Organization. Server-side entitlement evaluation controls seats, model usage, runtimes, plugins, storage, and limits; clients cannot grant themselves access.
- Identify browser and desktop installations with `RuntimeInstallation`, and require registration, heartbeat, policy refresh, and revocation under the organization.
- In `open` deployments, registration may create a team or accept an invitation. In `private` deployments, one pre-provisioned enterprise Organization exists and public organization creation is disabled. Both modes use the same records and protocols; only policy differs.
- On every request, the service resolves the authenticated Account, selected Organization, membership, role scope, subscription, and runtime policy before authorizing or metering the operation.

## Implementation evidence

The [enterprise API](../../../../apps/api/README.md) implements the initial Better Auth and PostgreSQL organization model. Transaction-local organization selection and forced RLS isolate business tables; the runtime account cannot bypass RLS. Membership changes lock the organization while enforcing seat limits and protecting the last distinct active Owner. Department-scoped bindings are stored, but department delegation is not implemented.

The [database tests](../../../../apps/api/tests/identity.test.ts) exercise cross-tenant rejection, concurrent seat admission, invitation replay and revocation, duplicate Owner bindings, administrator conversation-read auditing, single-use PKCE codes, runtime revocation, and append-only session leases. A built-bundle test starts the named DSH profile on an OS-assigned loopback port and awaits shutdown. This evidence does not establish desktop feature parity or real-provider correctness.

This proposal remains active because the native client, remote DSH providers, delegated role evaluation, and complete commercial entitlement machinery are incomplete. The [platform proposal](2026-09-05-enterprise-agent-platform.md) retains ownership of execution placement and plugin governance; neither proposal is fully superseded or archived.

## Alternatives considered

- Separate personal-user and enterprise-user schemas: rejected because migrations, permissions, billing, and feature parity would diverge.
- `user.company_id` or `user.department_id`: rejected because users can belong to multiple units and scopes need delegated roles and history.
- A private-edition identity implementation: rejected because it would create incompatible deployment behavior and upgrade paths.
- Client-selected organization and permissions: rejected because a compromised or stale client could bypass server policy.
- A standalone `PersonalWorkspace` entity: rejected because a one-member team Organization provides the same product behavior with fewer concepts.

## Acceptance criteria

- A newly registered Account must join an existing Organization or create a team Organization before using business features.
- The same session, plugin, usage, audit, and billing records work for personal teams, enterprises, and private deployments.
- An Organization can contain nested OrgUnits and memberships with multiple scoped role bindings.
- Server requests fail closed when organization context, membership, entitlement, runtime registration, or policy revision is missing or revoked.
- Organization transfer, member removal, retention, export, and deletion preserve auditability and do not orphan billable or security-relevant records.

## Risks

The organization tree and scoped roles increase authorization complexity; central policy evaluation and deny-by-default tests are required. Account discovery and invitations can expose membership information; minimize enumeration and require verified addresses. Private deployments may lag SaaS schema versions; use the same migrations and compatibility tests. A single-member team can be mistaken for an individual account in UX; label the organization kind explicitly while keeping storage unified.
