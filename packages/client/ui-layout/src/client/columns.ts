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

/** Resolved shell columns, including the permanent navigation rail. */
export interface AppColumns extends Columns {
  rail: number
  workbench: number
  workbenchMode: 'inline' | 'overlay'
}

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor while details is visible. */
export const CENTER_MIN = 240
/** Minimum readable conversation width in the client workbench. */
export const CONVERSATION_MIN = 560
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Permanent first-level navigation rail width. */
export const RAIL_WIDTH = 56
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

/**
 * Solve the rail, session sidebar, conversation, and Workbench widths.
 * Workbench falls back to an overlay when the two minimum content widths do
 * not fit; the stored open preference remains intact for a wider container.
 * @param viewport - width of the AppFrame container.
 * @param sidebar - session sidebar preference; zero means closed.
 * @param workbench - Workbench preference; zero means closed.
 * @returns resolved columns and the Workbench display mode.
 */
export function computeAppColumns(viewport: number, sidebar: number, workbench: number): AppColumns {
  const rail = RAIL_WIDTH
  const sessionSidebar = sidebar === 0 ? 0 : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const available = Math.max(0, viewport - rail - sessionSidebar)
  if (workbench === 0) return { rail, sidebar: sessionSidebar, center: available, details: 0, workbench: 0, workbenchMode: 'inline' }
  const maximum = Math.min(Math.floor(available * DETAILS_MAX_RATIO), available - CONVERSATION_MIN)
  if (maximum < DETAILS_MIN) return { rail, sidebar: sessionSidebar, center: available, details: 0, workbench: 0, workbenchMode: 'overlay' }
  const details = clampWidth(workbench, DETAILS_MIN, maximum)
  return { rail, sidebar: sessionSidebar, center: available - details, details, workbench: details, workbenchMode: 'inline' }
}
