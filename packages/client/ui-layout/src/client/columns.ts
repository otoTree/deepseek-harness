/**
 * Pure concession-chain column solver for the three-column AppFrame.
 * The details column may occupy at most DETAILS_MAX_RATIO of the main content
 * area while CENTER_MIN remains available. A viewport that cannot fit both
 * minimums auto-closes details without rewriting its stored preference, so
 * widening the window restores it. The sidebar never concedes: its rendered
 * width is always the drag preference (or the collapsed rail). Inputs are the
 * layout store's plain width preferences (0 = closed); a closed sidebar
 * resolves to the fixed SIDEBAR_COLLAPSED control rail while closed details
 * resolve to zero width.
 * The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame. */
export interface Columns { sidebar: number; center: number; details: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor while details is visible. */
export const CENTER_MIN = 240
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Maximum share of the main content area assigned to details. */
export const DETAILS_MAX_RATIO = 0.8
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Return the current details-column ceiling.
 * @param viewport - available frame width in px.
 * @param sidebar - rendered sidebar width in px.
 * @returns maximum visible details width in px, or a value below DETAILS_MIN when details cannot fit.
 */
export function detailsMaximum(viewport: number, sidebar: number): number {
  const main = Math.max(0, viewport - sidebar)
  return Math.max(0, Math.min(Math.floor(main * DETAILS_MAX_RATIO), main - CENTER_MIN))
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const main = Math.max(0, viewport - s)
  if (details === 0) return { sidebar: s, center: main, details: 0 }
  const maximum = detailsMaximum(viewport, s)
  if (maximum < DETAILS_MIN) return { sidebar: s, center: main, details: 0 }
  const d = clampWidth(details, DETAILS_MIN, maximum)
  return { sidebar: s, center: main - d, details: d }
}
