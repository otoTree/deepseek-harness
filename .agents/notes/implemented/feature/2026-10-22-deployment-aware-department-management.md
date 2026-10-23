# Agent Note: Shared department management follows deployment policy

Status: implemented

English | [中文](2026-10-22-deployment-aware-department-management.zh.md)

## Problem

A team Owner can manage invitations but has no department controls in the desktop Directory. Account entry also offers team creation for a private-company deployment, where the API rejects it. Subscription names cannot distinguish these deployment policies.

## Decision

The native account entry consumes the API's public deployment and registration policy. Open deployments offer independent team creation, while private deployments offer the provisioned company organizations and invitation entry. Disabled registration hides account creation. Registration and invitation acceptance remain separate actions; submitting an invitation immediately creates membership without a second administrator approval.

Both deployment modes use the same organization-local units and member assignments. Owners and administrators manage department hierarchy and active-member department selections through the existing APIs and the Directory's Departments tab. A member can belong to multiple departments. Root units are immutable; department deletion requires confirmation and rejects remaining child units, assignments, or scoped roles. Parent changes reject cycles and references outside the selected organization. Runtime credentials can call these APIs only within their issuing organization.

The [team-isolation decision](../bug-fix/2026-10-22-open-registration-team-isolation.md) owns membership inheritance. The [identity proposal](../../proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) remains active for department-scoped delegation and its other unfinished capabilities. The [console directory](2026-09-13-enterprise-console-organization-directory.md) retains ownership of platform administration.

## Alternatives considered

- Separate SaaS and private-company member tables would make organization switching, billing, and migration behavior diverge. Deployment policy controls entry and inheritance while the same records own membership and departments.
- Inferring company mode from an enterprise subscription would couple deployment policy to a commercial plan and mislabel independent teams.
- Automatically reassigning members during department deletion would silently change access to department-shared resources. Administrators explicitly choose each member's replacement assignments.

## Consequences

Department management does not create a billable organization or another wallet. Assignment changes affect department-based cloud-drive sharing. Department-scoped roles remain stored without granting delegated department administration. Existing explicit memberships, subscription plans, balances, and usage records retain their owners.

The [HTTP regression](../../../../apps/api/tests/team-isolation.test.ts) exercises both database credential configurations and both deployment modes. The [native account browser test](../../../../apps/web/tests/enterprise-account.e2e.ts) checks policy-driven entry against the bundled account page; its non-Session goldens remain owner-local. The [recorded Directory scenario](../../../../snapshots/web/enterprise-settings/snapshot.yml) checks department creation and member assignment through the shipped Web composition and Host bridge.
