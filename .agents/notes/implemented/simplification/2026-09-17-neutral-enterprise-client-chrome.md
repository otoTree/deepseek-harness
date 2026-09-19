# Agent Note: Neutral client chrome

Status: implemented

English | [中文](2026-09-17-neutral-enterprise-client-chrome.zh.md)

## Problem

The default and official client chrome presented the DeepSeek fish in the sidebar and New Session hero, described the blank state as “Into the Unknown,” and labeled an active model turn “Deep diving.” Those marks and phrases made a deployment-specific identity part of shared product state. The enterprise client uses AgentOS as its name and needs neutral action language that describes what the interface is doing.

## Decision

The sidebar shell has no fallback mark, and the official brand plugin registers only the AgentOS name. The New Session hero removes the `conversation.hero.brand.mark` slot and its animated fish fallback, then renders the localized neutral headline “How can I help?” / “有什么可以帮你？”. The running-turn status uses “Processing...” / “处理中...”. Deployment-owned packages may still occupy the sidebar's independent mark slot when their product requires an icon, but the shared and official compositions do not.

This decision supersedes the shipped [hero fish hover morph](../feature/2026-08-12-hero-fish-hover-swim-morph.md). That interaction solved the earlier request for a visibly animated mark, but a mark is no longer part of the New Session hero.

## Alternatives considered

**Keep the fish but remove its animation.** A static fish would still present the same deployment-specific identity, so it would not satisfy the neutral client requirement.

**Replace the fish with another default icon.** No generic icon communicates useful state beside the AgentOS name or neutral blank-state prompt. Leaving the space empty avoids introducing another decorative identity.

**Change only the enterprise assembly.** The stale-client failure showed that shared client bundles and official-brand occupants can preserve old chrome across rebuilds. Removing the defaults at their owning packages makes every supported composition explicit.

## Consequences

The sidebar and New Session hero no longer display a product icon in the official enterprise client. The hero loses the hover morph and its brand-mark extension point; reintroducing hero artwork requires a new explicit product decision rather than occupying a dormant slot. Localized tests cover the neutral headline and running status, and the official-brand tests require the sidebar mark slot to remain empty.
