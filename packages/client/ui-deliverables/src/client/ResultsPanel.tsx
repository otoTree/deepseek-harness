import { LinkIcon, classifyLinkPath } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename, producedForClosing } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ResultsPanel.module.css'

/** A unique file produced in the current Session, with its first owning Turn. */
export interface SessionResult {
  readonly path: string
  readonly turn: number
}

/**
 * Collect the existing per-Turn deliverables into Session order.
 * @param timeline - Chat timeline for the current Session.
 * @returns Unique produced paths in first-seen Turn and tool order.
 */
export function collectDeliverables(timeline: ConversationTimelineSnapshot): readonly SessionResult[] {
  const results: SessionResult[] = []
  const seen = new Set<string>()
  for (const turnNumber of timeline.turnOrder) {
    const turn = timeline.turns.get(turnNumber)
    if (turn === undefined) continue
    for (const path of producedForClosing(turn.data.get('deliverables'))) {
      if (seen.has(path)) continue
      seen.add(path)
      results.push({ path, turn: turnNumber })
    }
  }
  return results
}

/** Results panel props assembled by the keyed Workbench slot. */
export type ResultsPanelProps =
  & PropsRuntime<'workbench.panel', 'results'>
  & PropsLocale<typeof NS>

/** Render all file deliverables observed in the current Session. */
export function ResultsPanel(props: ResultsPanelProps) {
  const results = collectDeliverables(props.useChat(snapshot => snapshot.timeline))
  return (
    <div className={css.root} data-results-panel>
      <div className={css.heading}>
        <div className={css.title}>{props.t('results.title')}</div>
        {results.length > 0 && <div className={css.count}>{props.t('results.count', { count: String(results.length) })}</div>}
      </div>
      {results.length === 0
        ? <div className={css.empty}>{props.t('results.empty')}</div>
        : (
          <ul className={css.list}>
            {results.map(result => (
              <li key={result.path} className={css.item}>
                <button
                  type="button"
                  className={css.file}
                  title={result.path}
                  aria-label={props.t('results.openInFiles', { name: result.path })}
                  onClick={() => { if (props.openFile) void props.openFile(result.path) }}
                >
                  <LinkIcon kind={classifyLinkPath(result.path)} className={css.icon} />
                  <span className={css.name}>{basename(result.path)}</span>
                  <span className={css.path}>{result.path}</span>
                </button>
                <span className={css.turn}>{props.t('results.turn', { turn: String(result.turn) })}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
