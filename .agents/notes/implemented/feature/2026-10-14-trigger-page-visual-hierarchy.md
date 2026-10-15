# Agent Note: Trigger page visual hierarchy

Status: implemented

English | [中文](2026-10-14-trigger-page-visual-hierarchy.zh.md)

## Problem

The trigger page gave rules, the live queue, and run history equal full-width panels. When all three were empty, large repeated surfaces overwhelmed the rule-creation action and left the page visually sparse.

The rule editor presented a continuous field stack with inconsistent native control heights. Source settings, session targets, and instructions lacked clear grouping, and longer file-trigger forms could push the save action outside the viewport.

## Decision

The trigger page presents rule management first, with a compact empty state that opens the rule editor. The live queue and run history share one tab panel with visible counts. Rule enablement and Runtime listening remain separate statuses, and existing rule actions and batch recovery actions remain available in their respective views.

The editor uses the shared headless Modal with a fixed header and action footer around a scrollable form. Three numbered fieldsets group trigger conditions, execution targets, and Agent instructions. Semantic theme tokens, equal-height inputs and selects, and responsive two-column field grids maintain alignment. Prompt variables expand below the instruction field so they remain available without competing with the form.

## Alternatives considered

- **Keep three separate panels.** Rejected because empty queue and history regions take the same visual weight as rule management despite having no content.
- **Hide empty queue and history.** Rejected because the views are useful destinations even before the first event; tabs preserve their location without reserving large empty areas.
- **Keep the editor as an uninterrupted field stack.** Rejected because source-dependent settings obscure the transition from event configuration to session delivery and instructions.
- **Scroll the entire modal.** Rejected because the close and save controls must remain reachable with long file-trigger forms and short viewports.

## Consequences

Users reach rule creation directly from the empty state, while queue and history occupy one secondary region. The tab panel keeps both operational views discoverable and avoids repeating large panel backgrounds.

Editor content scrolls independently of its actions. Native form controls retain their input behavior, and field grids become a single column on narrow viewports. Component coverage exercises source and target changes, match testing, creation, editing, and cancellation.
