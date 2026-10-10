# Agent Note: Enterprise local provisioning repairs tenant roots

Status: implemented

English | [中文](2026-10-04-enterprise-local-provisioning-repair.zh.md)

## Problem

The local database could contain an installation marker and a deployment row while its root organization or tenant access records were incomplete. The API then rejected organization plugin requests before the force-remove operation could revoke a release.

## Decision

`enterprise:start` runs the provisioner with `--if-needed`. A fresh local deployment uses the fixed root organization required by the Desktop profile. An existing deployment keeps its account and organization identity; the provisioner repairs a missing root reference, root organization, root unit, active administrator membership, owner role, unit assignment, subscription, or wallet in one advisory-locked transaction. An existing deployment without a platform administrator fails with an explicit error instead of selecting or replacing an account.

## Alternatives considered

**Keep refusing every existing deployment.** Rejected because a marked local database can be partially initialized after an interrupted setup, and refusing it leaves the API unable to enter the tenant needed for recovery.

**Delete and recreate the local organization.** Rejected because installations, users, and Runtime records may already reference the organization; repair preserves those durable identities.

**Guess a replacement administrator.** Rejected because selecting an account without an explicit platform-admin record could grant tenant authority to the wrong user.

## Consequences

The local start command repairs the incomplete state that caused plugin force removal to return access errors, while preserving existing development data. The repair path is idempotent and bounded to the deployment root selected by the deployment row. A deployment with no administrator remains an actionable provisioning error and requires explicit repair rather than silent account adoption.

## Testing

The provisioner TypeScript check passes. `enterprise:provision -- --if-needed` repairs the current local database, and the live API accepts organization overview, catalog, upload, install, and force-remove requests after the repair. Enterprise Client, Host, and plugin-runtime focused suites pass.
