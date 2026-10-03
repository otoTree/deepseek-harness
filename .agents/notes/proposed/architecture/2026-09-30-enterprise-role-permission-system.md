# Agent Note: Enterprise role permissions across administration and desktop execution

Status: proposed

English | [中文](2026-09-30-enterprise-role-permission-system.zh.md)

## Problem

The enterprise product has platform administration, organization administration, desktop Runtime identity, plugin activation, and local sandbox approval, but these mechanisms do not yet form one explicit authorization model. Existing routes mix platform flags, fixed-role lists, and permission checks. A broad role can be mistaken for device authority, a local approval can be mistaken for enterprise permission, and policy changes do not consistently invalidate Runtime views. The product also needs optional separation of duties for high-risk operations without making every ordinary action wait for another administrator.

## Proposal

Use two independent enterprise permission planes and one local consent plane. Platform roles govern deployment-wide resources without access to customer Session content. Organization roles govern tenant resources through stable permission IDs and scoped bindings. The desktop user independently controls local files, Shell, sandbox mode, and per-operation tool approval; an operation that crosses enterprise and local resources requires both decisions.

The Organization owns organization policy. Its administrators can manage the same policy from the desktop client or Web administration console through the enterprise API. The desktop client is the convenient entry for member onboarding and routine governance, with effective-role explanations, policy drafts, impact previews, and confirmation for changes. The Web console is preferred for complex role design, identity providers, billing, organization-wide data rules, and bulk changes; the platform area remains separate and Web-only. Both organization interfaces use the same API and authorization decisions. A platform operator does not become an Organization member or administrator by selecting that Organization in the console. Customer-content support requires a distinct, customer-approved, scoped, time-limited grant.

Represent system and custom roles with the same versioned role definitions and permission bindings. Bind roles at platform, Organization, or OrgUnit scope. Organization and OrgUnit bindings inherit downward, and any applicable explicit deny overrides ordinary allows. Keep final-Owner recovery, non-escalation, tenant ownership, and platform separation as system constraints that roles and denies cannot remove.

Use one server-side resolver for protected API operations. It authenticates the principal, validates active account, membership, Runtime, service, and plugin state, applies system constraints, expands scoped roles, applies deny precedence, checks entitlements, determines whether approval is required, and validates the presented policy revision. Clients may use an effective-decision view for presentation but never submit it as authority.

Allow each Organization to enable two-person approval for selected high-risk permissions and scopes. The requester must already have permission. A different authorized approver approves the exact operation digest at one policy revision for a bounded period. Execution revalidates the requester and consumes the approval once in the protected mutation's transaction. Approval does not create missing RBAC authority.

Default organization policy is least-privilege: invitations expire and create Members only; active Members can use approved models within plan limits and install approved personal plugin releases. Session content is private to its owner, and cross-member reads, organization-wide search, and exports are denied by default. Organization plugin installation, publication, approval, custom permission grants, identity-provider changes, billing mutation, and device-wide policy changes require explicit permissions; audit and billing records require explicit read grants. Policy settings can restrict or require workflows but never add role permissions or weaken platform ceilings. Role templates are onboarding bundles over fine-grained read, update, use, publish, export, approve, revoke, and delete permissions; they do not replace per-operation checks.

When the desktop is offline, user-authorized local work can continue. Enterprise models, organization data, cloud plugins, and administrative operations require current online authorization and fail closed.

## Existing foundation

The enterprise API already stores Organizations, memberships, OrgUnits, fixed role bindings, a permission catalog, versioned custom roles, custom-role permissions, and allow or deny effects. It also provides RLS tenant isolation, final-Owner checks, Runtime leases and revocation, policy revisions on heartbeat and model requests, plugin permission revisions, and audit records. The [enterprise administration foundations](../../implemented/architecture/2026-09-30-enterprise-admin-foundations.md) retain ownership of those shipped records and interfaces.

The [identity and organization proposal](2026-09-05-enterprise-identity-and-organization.md) owns account, membership, Organization, OrgUnit, subscription, and Runtime identity. This proposal narrows the unresolved authorization rules that apply to those entities. The complete target and migration are documented in the [enterprise role and permission system](../../../../docs/developer/discussion/enterprise-role-permission-system.md).

## Alternatives considered

**One universal role hierarchy across platform, organization, and desktop.** Rejected because platform operations, tenant data, and operating-system access have different authorities. Combining them lets a control-plane grant be misread as local consent or lets platform support authority expose customer content.

**Administrator-controlled desktop sandbox and local approvals.** Rejected because the person operating the device remains responsible for local files, Shell, native applications, and operating-system prompts. Enterprise policy can refuse an enterprise service operation but cannot grant or bypass local access.

**Allow-only inherited roles.** Rejected because delegated administration needs narrow exclusions without copying every parent role. Explicit deny is retained with simple global precedence among applicable bindings; system recovery constraints prevent deny-based lockout.

**Fixed roles only.** Rejected because customers need different separation of identity, security, plugin, finance, and Session duties. Stable permission IDs and custom roles provide this without adding product-specific role names to each route.

**Mandatory two-person approval for every high-risk operation.** Rejected because team and private deployments have different staffing and risk requirements. Approval is disabled by default and enabled by policy for selected permissions and scopes.

**Treat an approval as temporary permission.** Rejected because approval must not elevate a requester who lacks current RBAC authority. It only confirms one already-authorized operation with an unchanged digest, revision, and expiry.

## Acceptance criteria

- Platform and organization roles resolve in separate planes, and platform authority never grants customer Session-content access.
- An Organization Owner can manage organization policy from desktop or Web using the same organization API; a platform operator gains no organization authority from console navigation.
- Member, role, identity, Runtime, Session, model, plugin, usage, billing, audit, and approval operations have separate least-privilege permission IDs.
- New members receive Member permissions; Session export, broad Session reads, administrative policy changes, billing changes, and identity changes are denied until explicitly granted.
- Organization and OrgUnit bindings inherit downward; applicable deny overrides allow; final-Owner recovery remains possible.
- System and custom roles resolve through stable permission definitions, and custom roles cannot contain platform or local-consent authority.
- Runtime, service-account, and plugin credentials only reduce their owning principal's current authority.
- Every protected API route uses the centralized resolver and commits required audit data with its operation.
- Every authorization-affecting mutation advances the appropriate policy revision and stale Runtime requests fail before execution.
- Optional approval rejects self-approval, replay, expiry, payload or revision mismatch, and changed requester authority.
- Offline desktop behavior preserves local user-authorized work and rejects enterprise service operations.
- Focused integration tests cover cross-tenant refusal, inheritance, deny precedence, revocation, stale policy, local and enterprise intersection, and approval consumption.

## Risks

Global deny precedence is easy to explain but can surprise an administrator who expects a child allow to override a parent deny; effective-decision explanations must show the denying binding and scope. A centralized resolver becomes security-critical and requires transaction-level tests for every resource owner and list path. Policy-revision invalidation can interrupt legitimate work, so clients need explicit refresh and retry behavior without a stale-policy bypass. Optional approval adds durable state and concurrency risks; request creation, decision, consumption, mutation, and audit each need idempotency and exact ownership rules.
