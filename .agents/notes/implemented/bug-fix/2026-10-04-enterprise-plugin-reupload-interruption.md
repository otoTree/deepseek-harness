# Agent Note: Private plugin re-upload and bounded interruption

Status: implemented

English | [中文](2026-10-04-enterprise-plugin-reupload-interruption.zh.md)

## Problem

The package uniqueness constraint rejected a private development upload when the plugin ID and version were unchanged. A Client target could also keep reconciliation blocked when its native window close operation did not settle.

## Decision

The package route treats an identical published private upload as an idempotent response. If that same private release was revoked by force removal, the upload republishes it and clears the revocation timestamp. A changed private upload replaces the existing private release, advances installation permission revisions, revokes activations, and leaves devices to reload the new artifact. Public releases remain immutable. Client window cleanup is bounded by the existing cleanup deadline, and browser SDK relays forward their abort signal into Connection RPC. The marketplace keeps recovery actions visible while an installation has a newer release, and target preparation rows do not make an otherwise active installation appear permanently unavailable. Force removal uses an in-app confirmation; its organization route is included in Runtime-token authentication, while personal ownership remains checked against the authenticated account. Server revocation is reported independently from best-effort local Client reconciliation. Enablement, upgrade, uninstall, and force removal return after the control-plane mutation and schedule local reconciliation independently.

## Consequences

Private development packages can be rebuilt and uploaded without manually changing the version. A force-revoked private release becomes visible again when its identical package is uploaded, while changed packages replace the release. Replacements restart active installations while retaining installation data spaces. A stalled window close is recorded as cleanup failure after the deadline, but lease revocation and SDK invalidation still proceed so later reconciliation can retry cleanup. Users can still disable, uninstall, or force-remove an installation while a newer catalog release is shown. Personal force removal works through the same Runtime-token path as the other lifecycle operations. A successful server mutation remains successful when local reconciliation is stalled or unavailable; a genuine bridge failure includes its returned message in the marketplace notice.

## Testing

The enterprise identity fixture covers changed and identical same-version private uploads, republishing an identical package after force removal, organization capability responses, and personal force removal through a Runtime token. Enterprise runtime tests cover a stalled Client window close, and Client runtime tests continue to cover target reconciliation and cleanup deadlines. The enterprise Host bridge suite covers a force removal while the initial catalog read is stalled. The enterprise Web client suite covers mixed active/preparing target rows, in-app force-remove confirmation, independent server and local reconciliation outcomes, bridge error messages, and recovery controls on upgrade cards.

The dashboard also returns server-computed organization-plugin capabilities. The Web client uses those capabilities to hide non-private upload choices and disable organization installation mutations for accounts that the current policy does not authorize.

## Alternatives considered

Keeping the version uniqueness error would force every private development rebuild to change its version and would not address a stuck installation. Replacing public releases was rejected because catalog consumers rely on their digest and publication state being stable.
