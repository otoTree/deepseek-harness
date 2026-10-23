# Agent Note: Open registration isolates team organizations

Status: implemented

English | [中文](2026-10-22-open-registration-team-isolation.zh.md)

## Problem

A team linked beneath the platform root can inherit platform membership and roles through the company hierarchy. Directory queries that rely only on RLS can also expose ancestor members, or every organization's members when the API uses credentials that bypass RLS. Registration permission does not establish consent to join another organization.

## Decision

Open deployments create independent team roots. Membership lookup, fixed roles, custom permissions and membership/role RLS policies traverse ancestors only in private company deployments. Migration `0038_open_team_isolation` applies this rule to existing organization links without changing explicit memberships or moving customer data. A platform administrator uses the control-plane routes; platform-root membership alone grants no customer-team authority.

Account overviews, subscriptions, devices, directory members, role bindings, assignments, pending invitations and member usage explicitly select the current organization. Seat limits count only that organization. Device authorization and revocation require both the device ID and organization ID; authorization returns that organization's policy revision. Login authorizations have no device quota. Invitation acceptance reads the invited organization's subscription and root unit. Member status changes, role revocation and invitation revocation also select the current organization; final-Owner checks count only its Owners. Suspending a membership revokes only that team's runtimes.

The [identity proposal](../../proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) retains ownership of the broader account and organization model. This decision specifies its open-team isolation rule; the proposal remains active for its independent unfinished capabilities. The [deployment credential decision](../architecture/2026-10-21-enterprise-single-database-connection.md) retains its warning that privileged database accounts bypass RLS; the directory's explicit filters do not establish application-wide safety for such credentials.

## Alternatives considered

**Filter the displayed members only.** That conceals the directory symptom while inherited membership and roles still grant access to team APIs.

**Rely only on RLS.** Ancestor visibility is intentional for private companies, and supported deployment credentials can bypass RLS. Organization-local directory filters remain necessary.

**Remove hierarchy inheritance everywhere.** Private companies need the shared organization hierarchy. Deployment mode determines inheritance independently of account registration policy.

## Consequences

Existing explicit memberships remain effective; the service cannot infer which were intentional. Organization links in existing open deployments remain available to platform administration without conveying customer-team authority. The [HTTP regression](../../../../apps/api/tests/team-isolation.test.ts) upgrades an existing hierarchy and checks ordinary and superuser database accounts, cross-team denial, final-Owner protection, independent signup teams, account/subscription identity, device registration, cross-team device denial, invitation seat admission and private-company inheritance. The [Web scenario](../../../../snapshots/web/enterprise-settings/snapshot.yml) renders a team Owner in its team directory.
