# Agent Note: Admin panels use content heights and shared spacing

Status: implemented

English | [中文](2026-10-16-admin-content-heights-and-spacing.zh.md)

## Problem

Short Admin panels acquire large blank areas when Grid stretches them beside long tables. Page-specific metric sizes and negative vertical margins also obscure the relationship between sections. A viewport-height navigation background leaves the lower part of a long page uncovered.

## Decision

Admin content panels align at the top and grow with their content. Page-level metric cards share a 126px minimum height, reduced to 100px at widths up to 560px. Ordinary controls have a 36px minimum; table actions use 32px on desktop and 36px on phones, while primary actions use 44px on phones. Cards use 20px padding, reduced to 16px on phones. Sections use 24px spacing and parallel cards use 20px spacing. These are minimum sizes; wrapped text can increase the height. Usage metrics size their numbers to the available card width without splitting digits. Mobile header actions wrap onto a separate row, and identity forms constrain their Grid tracks and inputs to the panel width.

Charts retain space for their plots. The sync textarea retains a 610px desktop minimum, a 420px minimum at widths up to 720px, and vertical resizing; its enclosing panel and side cards follow their content. Separate overview Grid rows have an explicit section gap. Tabs and wide tables scroll inside their own containers.

Admin reading surfaces use a shared type scale: 14px body text with 21px line height, 13px labels and table cells with 20px line height, 12px metadata with 18px line height, 18px section headings with 26px line height, and 32px page headings with 40px line height. At widths up to 800px page headings use 26px with 34px line height; at widths up to 560px they use 24px with 32px line height. Responsive title sizes are assigned through the shared variables so page selectors cannot override the breakpoint. Data metrics, status badges, navigation labels, and the code editor keep their task-specific sizes.

The shell owns a full-page dark sidebar background and an inner sticky navigation container with a 100dvh height and independent scrolling. Shell layout selectors address its direct main and aside children, so nested workspace elements retain their own layout. Mobile navigation uses the existing drawer, and its closed state hides links from keyboard navigation. The [reference alignment](../architecture/2026-09-30-enterprise-admin-reference-alignment.md) continues to own the light canvas and overview data presentation.

## Alternatives considered

**Force every card to the same height.** Equal heights help compare metrics of the same kind, but a short upload form and a long release table carry different amounts of information. Stretching them wastes space and hides the end of the form.

**Remove every minimum height.** Charts need a readable plot and the editor needs a useful editing area. Content panels can shrink without removing these task-specific minima.

## Consequences

Short panels can end above adjacent long tables. Shared sizes keep comparable controls and metrics consistent without constraining wrapped content. The sidebar has two distinct responsibilities: page-height background coverage and viewport-height navigation scrolling. Browser geometry and screenshots remain Admin-owned evidence under `output/playwright/admin-layout/`; CSS text assertions cannot establish rendered spacing or scroll behavior.
