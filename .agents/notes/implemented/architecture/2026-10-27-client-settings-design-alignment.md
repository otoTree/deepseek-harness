# Agent Note: Retained desktop designs use shared feature owners

Status: implemented

English | [中文](2026-10-27-client-settings-design-alignment.zh.md)

## Problem

Desktop settings, plugin browsing and account entry need the hierarchy of the retained product designs while preserving native authentication, persisted preferences and plugin lifecycle ownership. Copying reference examples into runtime data would misrepresent available capabilities.

## Decision

The [retained Figma design](https://www.figma.com/design/PNrSdRjstOIGuE720lfv14?node-id=34-10) guides settings, enterprise administration, marketplace, cloud drive, triggers and account entry. Conversation and Workbench designs are outside this implementation scope.

The [settings shell](../../../../packages/client/ui-settings-general/README.md) owns searchable section navigation, breadcrumbs and General card grouping. Search filters localized contributed labels while retaining the active section. The [theme plugin](../../../../packages/client/ui-theme/README.md) owns appearance previews and semantic surface roles. The [enterprise feature](../../../../packages/client/ui-enterprise/README.md) owns market navigation and cards, drive navigation and trigger tables. The exact marketplace illustration is bundled with the Client, so rendering does not depend on Figma availability.

Arivo reuses these registered market and trigger components through the [product adapters](2026-10-26-product-plugin-market.md); product capabilities retain control over publishing scopes and cloud sources. The [shared appearance decision](2026-10-24-arivo-shared-appearance.md) owns distribution palette overrides. The [Admin canvas decision](2026-09-30-enterprise-admin-reference-alignment.md) independently owns Admin brightness and density.

## Alternatives considered

**Copy the reference screens into a separate application.** A second application would separate design acceptance from the desktop's actual authentication, settings and installation workflows.

**Populate the marketplace with reference examples.** Example cards cannot establish that a plugin is published, authorized or installable; runtime cards derive from the real catalog.

## Consequences

Feature slots, native account transport and existing mutation handlers retain their owners. Narrow navigation remains reachable; dense trigger tables scroll inside their content region. Locale dictionaries own visible and accessible copy. Browser regressions cover search without section switching, upload navigation, form reachability and page overflow alongside existing persistence and lifecycle cases. Packaged platform validation remains separate from browser acceptance.
