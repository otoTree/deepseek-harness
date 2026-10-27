import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { DisclosureRow, IconApiOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import a11yCss from './accessibility.module.css'
import css from './GenericCommandCard.module.css'

type CommandRowState = 'running' | 'ok' | 'error'

const COMMAND_ICON = <IconApiOutline14 size={14} />
const ERROR_ICON = <StateDot state="error" />

/** Node state → row state semantic (running while unsettled; outcome kind after). */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

function leadingFor(state: CommandRowState): ReactNode {
  return state === 'error' ? ERROR_ICON : COMMAND_ICON
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
}

/**
 * Render a command summary and its lazily mounted multiline output.
 * @param props - command, locale, and optional running label.
 * @returns the command disclosure.
 */
export const GenericCommandCard = memo(function GenericCommandCard({ node, t, runningSummary }: GenericCommandCardProps) {
  const [expanded, setExpanded] = useState(false)
  const text = node.outcome?.text
  const summary = node.outcome === null
    ? runningSummary ?? t('command.running')
    : text ?? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
  // The summary already carries the settlement text, so the title is the bare
  // command name.
  const title = node.name ?? t('command.title')
  const state = stateOf(node.outcome)
  const body = text !== undefined && text.includes('\n') ? text : null
  const open = expanded && body !== null
  const toggle = useCallback(() => { setExpanded(value => !value) }, [])
  const collapsedContent = useMemo(() => (
    <>
      <span className={css.separator} aria-hidden />
      <span className={css.summary} data-error={state === 'error' || undefined}>{summary}</span>
    </>
  ), [state, summary])
  const content = useMemo(() => open
    ? <pre className={css.body} data-error={state === 'error' || undefined}>{body}</pre>
    : undefined, [body, open, state])
  return (
    <div className={css.root} data-variant="others" data-state={state}>
      {state === 'running' && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      {state === 'error' && <span className={a11yCss.visuallyHidden}>{t('row.failed')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(state)}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        collapsedContent={collapsedContent}
      >
        {content}
      </DisclosureRow>
    </div>
  )
})
