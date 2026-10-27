/** Task tabs keep inactive forms mounted so switching views retains drafts. */
import { useId, useState, type ReactNode } from 'react'
import css from './TabGroup.module.css'

/**
 * Render a keyboard-accessible tab list and persistent panels.
 * @param props - Localized group name and panels in navigation order; unavailable panels must be omitted.
 * @returns A tab list with roving focus and one visible panel.
 */
export function TabGroup(props: { label: string; tabs: readonly { id: string; label: ReactNode; content: ReactNode }[] }) {
  const prefix = useId()
  const [chosen, setChosen] = useState(props.tabs[0]?.id)
  const selected = props.tabs.some(tab => tab.id === chosen) ? chosen : props.tabs[0]?.id
  return <div className={css.root}>
    <div role="tablist" aria-label={props.label} className={css.tabs} onKeyDown={(event) => {
      const index = props.tabs.findIndex(tab => tab.id === selected)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % props.tabs.length
          : event.key === 'ArrowLeft' ? (index - 1 + props.tabs.length) % props.tabs.length : undefined
      if (next === undefined) return
      event.preventDefault()
      const tab = props.tabs[next]
      if (tab) { setChosen(tab.id); document.getElementById(`${prefix}-${tab.id}-tab`)?.focus() }
    }}>{props.tabs.map(tab => <button key={tab.id} id={`${prefix}-${tab.id}-tab`} type="button" role="tab"
        aria-selected={selected === tab.id} aria-controls={`${prefix}-${tab.id}-panel`} tabIndex={selected === tab.id ? 0 : -1}
        onClick={() => { setChosen(tab.id) }}>{tab.label}</button>)}</div>
    {props.tabs.map(tab => <div key={tab.id} id={`${prefix}-${tab.id}-panel`} role="tabpanel"
      aria-labelledby={`${prefix}-${tab.id}-tab`} hidden={tab.id !== selected} className={css.panel}>{tab.content}</div>)}
  </div>
}
