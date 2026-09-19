---
description: "Install and publish Client and Host plugins from the enterprise desktop marketplace."
kind: "user-guide"
---

# Enterprise desktop plugin market

English | [中文](enterprise-plugin-market.zh.md)

The desktop enterprise profile adds **Plugin market** to the sidebar. Opening it keeps the current conversation and replaces the main content with the market; **Back to conversation** restores the session.

The first release accepts standard `.dsh-plugin.zip` packages containing built Client and/or Host bundles. Cloud targets are not supported. Select a release to inspect its version, targets, permissions, and visibility. Installation downloads and verifies the package; enabling a target is a separate confirmation.

Private uploads are visible and installable only by the creator. Organization uploads enter organization-owner or administrator review. Platform uploads enter platform-administrator review. Public releases appear in the catalog only after approval and remain unavailable after revocation.

Account synchronization carries the selected release, ordinary configuration, target state, and enabled state to another device. Keychain credentials, API keys, operating-system permissions, local paths, and shell access stay on each device. A new device can show an installed release as waiting for local authorization until the user grants the required permission.
