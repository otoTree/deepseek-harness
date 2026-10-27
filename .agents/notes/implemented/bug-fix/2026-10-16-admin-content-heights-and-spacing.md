# Agent Note: Admin panels use content heights and shared spacing

Status: implemented

English | [中文](2026-10-16-admin-content-heights-and-spacing.zh.md)

## Problem

Short Admin panels acquire large blank areas when Grid stretches them beside long tables. Page-specific metric sizes and negative vertical margins also obscure the relationship between sections. A viewport-height navigation background leaves the lower part of a long page uncovered.

## Decision

Admin content panels align at the top and grow with their content. Page-level metric cards share a 128px minimum height, reduced to 112px at widths up to 720px. Controls have a 36px minimum; table actions use 32px on desktop and primary actions use 44px on phones. Cards use 20px padding, reduced to 16px on phones, with 24px section spacing. Wrapped text can increase these minimum heights. Mobile header actions wrap, and form tracks and inputs stay within their panel.

Charts retain space for their plots. Tabs and wide tables scroll inside their own containers. Dialogs constrain their height to the viewport and scroll their contents without widening the page.

Admin reading surfaces use 13px body text with 20px line height, 12px labels with 18px line height, 15px section headings with 23px line height, and 25px page headings with 38px line height. At widths up to 720px page headings use 23px with 34px line height. Data metrics and metadata keep task-specific sizes. Noto Sans SC provides interface copy and Space Grotesk provides metric numerals.

The shell owns a full-page dark sidebar background and an inner sticky navigation container with a 100dvh height and independent scrolling. Shell layout selectors address its direct main and aside children, so nested workspace elements retain their own layout. Mobile navigation uses the existing drawer, and its closed state hides links from keyboard navigation. The [reference alignment](../architecture/2026-09-30-enterprise-admin-reference-alignment.md) continues to own the light canvas and overview data presentation.

## Alternatives considered

**Force every card to the same height.** Equal heights help compare metrics of the same kind, but a short upload form and a long release table carry different amounts of information. Stretching them wastes space and hides the end of the form.

**Remove every minimum height.** Charts need a readable plot and the editor needs a useful editing area. Content panels can shrink without removing these task-specific minima.

## Consequences

Short panels can end above adjacent long tables. Shared sizes keep comparable controls and metrics consistent without constraining wrapped content. The sidebar has two distinct responsibilities: page-height background coverage and viewport-height navigation scrolling. Browser geometry and screenshots remain Admin-owned evidence under `output/playwright/admin-layout/`; CSS text assertions cannot establish rendered spacing or scroll behavior.
