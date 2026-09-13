# Enterprise Identity and Organization Design

English | [中文](enterprise-identity-and-organization.zh.md)

## Summary

Every authenticated person or service is an `Account`. Every business action occurs inside an `Organization`. A newly registered person must join an existing organization or create a team organization; the product never creates a second personal data model. A team is an organization with a small membership and a team subscription. An enterprise is an organization with richer policy, organization units, and administrative controls.

This design supports two deployment modes. `open` deployments serve public SaaS and may support personal team creation, business organization creation, invitations, and configurable self-registration. `private` deployments serve one customer organization, disable public organization creation, and provision membership through an administrator, enterprise SSO, or SCIM. Both modes use the same entities, authorization rules, and data ownership chain.

## Table of Contents

- [Core model](#core-model)
- [Organization hierarchy](#organization-hierarchy)
- [Registration and membership](#registration-and-membership)
- [Deployment modes](#deployment-modes)
- [Plans and entitlements](#plans-and-entitlements)
- [Authorization and runtime identity](#authorization-and-runtime-identity)
- [Data ownership and lifecycle](#data-ownership-and-lifecycle)
- [Protocol requirements](#protocol-requirements)
- [Initial delivery](#initial-delivery)
- [Further Exploration](#further-exploration)

-----

<a id="core-model"></a>
## Core model

The model separates a person, a tenant, a hierarchy node, membership, permission, and commercial plan. These records must not be collapsed into a `user.department_id` or an account type flag.

| Entity | Meaning | Required relation |
|---|---|---|
| `Account` | A human or service identity that can authenticate | May have many memberships |
| `Organization` | A tenant, team, or enterprise billing and data boundary | Owns sessions, plugins, usage, and audit |
| `OrgUnit` | A node inside one organization hierarchy | Has one parent except the root |
| `Membership` | One account's relationship with one organization | Has an independent lifecycle |
| `RoleBinding` | A role granted to a membership in an organization scope | Points to an organization or org unit |
| `Subscription` | The plan and billing state attached to an organization | Produces server-side entitlements |
| `RuntimeInstallation` | A registered browser or desktop execution identity | Belongs to one account and organization context |

An account may belong to several organizations and may hold different roles in each. An organization may contain one member or many thousands. Personal use is represented by `Organization(kind: team)` with one owner, not by special-case session or plugin tables.

-----

<a id="organization-hierarchy"></a>
## Organization hierarchy

`OrgUnit` is a generic tree node. The initial catalog can include `root`, `subsidiary`, `branch`, `department`, `team`, `project`, and `cost_center`, while customers may define additional types. A node stores `organization_id`, `parent_id`, `unit_type`, name, status, and an ancestry representation suitable for descendant queries.

An account can belong to multiple org units through membership assignments. A user without a department remains attached to the root unit. Moving a member between units changes assignments and policy scope without changing the account or historical Session ownership.

```text
Organization
└── Root OrgUnit
    ├── Subsidiary A
    │   ├── Research
    │   └── Finance
    └── Subsidiary B
        └── Support
```

The tree is an authorization scope, not the sole source of reporting structure. Cost centers, projects, and data domains may use the same scope mechanism without adding more hard-coded columns.

-----

<a id="registration-and-membership"></a>
## Registration and membership

Registration creates an `Account` first. The account cannot create Sessions, install plugins, or consume quotas until it has an active membership.

```text
Register → Verify → Join or create → Membership → Plan → Runtime
```

An invitation names the organization, optional org unit, initial role, expiry, and inviter. Accepting it creates one membership; it never creates a second account for an existing identity. Without an invitation, the user creates a team organization and becomes its Owner. Creating a team is the default onboarding path for a public user.

Self-registration is a deployment policy with four values: `open`, `domain_restricted`, `invite_only`, and `disabled`. Email verification, rate limits, abuse detection, domain ownership, and administrator approval belong to the identity service. A matching email domain can suggest an organization, but it must not silently grant membership or administrator rights.

Membership states are `invited`, `active`, `suspended`, `removed`, and `expired`. Account states are `pending`, `active`, `suspended`, `deactivated`, and `deleted`. Removing membership revokes access to that organization while preserving account identity and historical records.

-----

<a id="deployment-modes"></a>
## Deployment modes

The deployment mode changes policy, not the data model or protocol.

| Mode | Organizations | Registration | Membership source |
|---|---|---|---|
| `open` | Personal teams and business organizations | Configurable; public SaaS may start as `open` | Self-registration, invitations, SSO, or SCIM |
| `private` | One customer enterprise organization | Public registration disabled | Initial administrator, SSO, invitations, or SCIM |

A private deployment initializes one enterprise organization, one root org unit, an Owner, and a private subscription. Later accounts must join that organization; they cannot create a second organization or personal space. A public deployment may let one account create several organizations, but each request selects exactly one active organization context.

The service must reject a request whose organization context is absent, inaccessible, suspended, or inconsistent with the authenticated account and Runtime. The client may display a selected organization, but the server recomputes authorization for every sensitive operation.

-----

<a id="plans-and-entitlements"></a>
## Plans and entitlements

Plans attach to organizations, including one-member teams. A plan controls capability limits without changing identity or storage tables.

```text
team_free → team_pro → business → enterprise → private
```

Entitlements may limit seats, Runtime installations, model usage, cloud plugin calls, Session retention, storage, custom plugins, enterprise connectors, audit retention, and support level. The server calculates effective entitlements from the plan, purchased add-ons, organization overrides, and current usage. Credits are a display and budget mechanism; the usage ledger remains authoritative for resources and currency.

Inviting a member, creating a Runtime, installing a plugin, or starting a model request performs an entitlement check at the owning service. A client-side check is only a user experience hint. When a team exceeds its plan, the service can reject the operation or require an upgrade according to the plan policy.

-----

<a id="authorization-and-runtime-identity"></a>
## Authorization and runtime identity

Roles bind to memberships and scopes. Initial roles are `Owner`, `Administrator`, and `Member`; later roles can cover security review, plugin publishing, finance, and data access without changing membership.

```text
RoleBinding(
  membership_id,
  scope_type: organization | org_unit,
  scope_id,
  role_id
)
```

Every browser or desktop client registers a `RuntimeInstallation` with account, organization, runtime kind, client version, capability declaration, policy revision, lease, and revocation state. A user can switch organizations, but the Runtime receives a new policy view and every Agent, Session, plugin call, usage event, and audit event records the selected organization and actor.

Revoking an account, membership, or Runtime prevents new work. Existing client-owned automation settles according to its local cancellation policy and reports the outcome when it reconnects. A service account has its own credentials and Runtime identities; it never inherits an interactive user's browser session.

-----

<a id="data-ownership-and-lifecycle"></a>
## Data ownership and lifecycle

The ownership chain is:

```text
Organization → OrgUnit → Membership → Runtime → Agent → Session → Tool Call → Usage → Audit
```

Every durable business record carries `organization_id`, `actor_account_id` when applicable, and creation time. Session content, plugin source, usage records, and audit records have separate retention, export, deletion, and legal-hold policies. Deleting an account or removing membership does not erase records required for organizational audit or billing.

Organization states are `pending`, `active`, `suspended`, `archived`, and `deleted`. A suspended organization rejects new work while preserving data and audit access for authorized administrators. Organization deletion is a controlled workflow that checks retention and legal hold before irreversible storage removal.

-----

<a id="protocol-requirements"></a>
## Protocol requirements

The identity service must expose language-independent operations for account authentication, registration policy, invitations, organization creation, membership changes, org unit assignments, role bindings, plan entitlements, Runtime registration, heartbeat, and revocation. Each operation must derive tenant scope from authenticated credentials and validate opaque identifiers at the service boundary.

The first wire records should include an authenticated actor, organization context, membership revision, policy revision, Runtime identity, request trace, and idempotency key where the operation has side effects. Authorization failures must identify the missing organization, membership, role, scope, or entitlement without revealing another tenant's existence.

-----

<a id="initial-delivery"></a>
## Initial delivery

Implement the shared model in this order:

1. Account authentication, email verification, sessions, and configurable registration policy.
2. Organization creation, one-member team onboarding, invitations, and private-deployment initialization.
3. Membership lifecycle, generic org unit tree, and scoped Owner/Administrator/Member roles.
4. Organization subscription, entitlements, quotas, and server-side organization context checks.
5. Browser and desktop Runtime registration, heartbeat, policy refresh, and revocation.
6. Organization and actor ownership on Session, plugin, usage, and audit records.
7. OIDC/SAML, SCIM, service accounts, and enterprise directory synchronization.

Acceptance requires that a public user can create a team, an invited user can join an existing organization, a private deployment rejects personal organization creation, a member can belong to multiple organizations, and a revoked Runtime cannot perform a new authorized operation.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise Agent platform blueprint](enterprise-agent-platform.md) — the broader runtime, plugin, governance, and commercial architecture.
- [Current identity package](../../../packages/identity/README.md) — the existing Harness-home anonymous identity and its limits.
- [API layer](../../../packages/api/README.md) — current Client-to-Host capability transport.
- [Session controller](../../../packages/api/session-controller/README.md) — current Session ownership and Remote operations.
- [Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) — decision rationale and alternatives.
