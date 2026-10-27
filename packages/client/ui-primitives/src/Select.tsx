/** Themed single-choice field with a native form value and a portaled option list. */
import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckOutline16, IconChevronDownOutline14 } from './icons/index.tsx'
import { useAnchoredPosition } from './useAnchoredPosition.ts'
import { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer.ts'
import css from './Select.module.css'

type Option = { value: string; label: string; disabled: boolean }

function text(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child)
    ? text(child.props.children) : typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint' ? String(child) : '').join('')
}

function optionsOf(children: ReactNode, disabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return []
    if (child.type === Fragment || child.type === 'optgroup') {
      return optionsOf(child.props.children, disabled || child.props.disabled === true)
    }
    const label = text(child.props.children)
    return [{ value: String(child.props.value ?? label), label, disabled: disabled || child.props.disabled === true }]
  })
}

/**
 * Replace the system dropdown while preserving single-select form events and validation.
 * @param props - Native single-select props and option/optgroup children; multiple selection is unsupported.
 * @returns A labeled combobox with keyboard navigation and a native form control hidden from assistive technology.
 */
export function Select(props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size' | 'value' | 'defaultValue'> & {
  value?: string | number | undefined
  defaultValue?: string | number | undefined
}) {
  const { children, value, defaultValue, className, id, onChange, onInvalid,
    'aria-label': label, 'aria-labelledby': labelledBy, ...nativeProps } = props
  const options = optionsOf(children)
  const [draft, setDraft] = useState(String(defaultValue ?? options[0]?.value ?? ''))
  const selected = value === undefined ? draft : String(value)
  const shown = options.find(option => option.value === selected) ?? options[0]
  const selectedIndex = shown ? options.indexOf(shown) : 0
  const [open, setOpen] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLSpanElement>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const native = useRef<HTMLSelectElement>(null)
  const listId = useId()
  const position = useAnchoredPosition({ open, anchorRef: anchor, panelRef: panel, gap: 4, margin: 12 })
  useDismissOnOutsidePointer(root, open, setOpen, panel)
  useEffect(() => {
    const form = native.current?.form
    const reset = () => { setDraft(String(defaultValue ?? optionsOf(children)[0]?.value ?? '')); setInvalid(false); setOpen(false) }
    form?.addEventListener('reset', reset)
    return () => { form?.removeEventListener('reset', reset) }
  }, [children, defaultValue])
  useEffect(() => {
    // jsdom does not implement scrolling.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (open) panel.current?.querySelector('[data-active=true]')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])
  const close = () => { setOpen(false); anchor.current?.focus() }
  const choose = (index: number) => {
    const option = options[index], field = native.current
    if (!option || option.disabled || !field || field.matches(':disabled')) return
    setDraft(option.value); setInvalid(false)
    field.value = option.value
    field.dispatchEvent(new Event('change', { bubbles: true }))
    close()
  }
  const navigate = (key: string) => {
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)
    const current = enabled.indexOf(active)
    setActive(enabled[key === 'Home' ? 0 : key === 'End' ? enabled.length - 1
      : (current + (key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length] ?? 0)
  }
  return <span className={css.root} data-control="select" ref={root}>
    <button ref={anchor} id={id} value={shown?.value ?? ''} type="button" role="combobox" className={[css.trigger, className].filter(Boolean).join(' ')}
      disabled={props.disabled} aria-label={label} aria-labelledby={labelledBy}
      aria-describedby={props['aria-describedby']} aria-required={props.required}
      aria-invalid={invalid || props['aria-invalid']} aria-expanded={open} aria-controls={listId}
      aria-activedescendant={open ? `${listId}-${active}` : undefined} aria-haspopup="listbox"
      onClick={() => { setActive(Math.max(0, selectedIndex)); setOpen(!open) }}
      onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          if (!open) {
            const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)
            setActive(event.key === 'Home' ? enabled[0] ?? 0 : event.key === 'End' ? enabled.at(-1) ?? 0 : Math.max(0, selectedIndex))
            setOpen(true)
          } else navigate(event.key)
        } else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
        else if (event.key === 'Tab') setOpen(false)
        else if ((event.key === 'Enter' || event.key === ' ') && open) { event.preventDefault(); choose(active) }
        else if (event.key.length === 1 && event.key !== ' ') {
          const next = options.findIndex(option => !option.disabled
            && option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
          if (next >= 0) { event.preventDefault(); setActive(next); setOpen(true) }
        }
      }}><span>{shown?.label}</span><IconChevronDownOutline14 /></button>
    <select {...nativeProps} ref={native} className={css.native} tabIndex={-1} aria-hidden="true"
      value={shown?.value ?? ''} onChange={(event) => { setDraft(event.currentTarget.value); onChange?.(event) }}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); anchor.current?.focus(); onInvalid?.(event) }}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled} />)}
    </select>
    {open && createPortal(<div ref={panel} id={listId} role="listbox" className={css.list}
      aria-label={props['aria-label']} style={{ ...position, minWidth: anchor.current?.getBoundingClientRect().width,
        visibility: position === null ? 'hidden' : 'visible' }}>
      {options.map((option, index) => <div key={`${option.value}-${index}`} id={`${listId}-${index}`} role="option" data-value={option.value}
        aria-selected={option.value === shown?.value} data-active={index === active} aria-disabled={option.disabled} className={css.option}
        onPointerMove={() => { if (!option.disabled) setActive(index) }} onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { choose(index) }}><span>{option.label}</span>{option.value === shown?.value ? <IconCheckOutline16 /> : null}</div>)}
    </div>, document.body)}
  </span>
}
