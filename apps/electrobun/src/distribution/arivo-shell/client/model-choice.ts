/** DOM listbox for account-authorized model choices; the parent owns every catalog request. */
import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

/** Render a keyboard-accessible selector without a platform popup.
 * @param props - Localized label, immutable options and a guarded parent selection callback.
 * @returns A styled trigger and a viewport-clamped listbox while open.
 */
export function ModelChoice({ label, placeholder, items, value, disabled, onChange }: {
  label: string
  placeholder: string
  items: readonly { id: string; name: string }[]
  value: string
  disabled: boolean
  onChange: (id: string) => void
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [last, setLast] = useState(false)
  const close = (restore: boolean) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => {
    if (!open || disabled) return
    const list = popup.current, button = trigger.current
    if (!list || !button) return
    list.showPopover()
    const place = () => {
      const rect = button.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 180), innerWidth - 24)
      const below = innerHeight - rect.bottom > Math.min(list.scrollHeight, 220) || rect.top < innerHeight - rect.bottom
      const height = Math.max(40, Math.min(280, below ? innerHeight - rect.bottom - 18 : rect.top - 18))
      Object.assign(list.style, { width: `${width}px`, maxHeight: `${height}px`, left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`, top: `${below ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(list.scrollHeight, height) - 6)}px` })
    }
    place()
    const options = Array.from(list.querySelectorAll<HTMLButtonElement>('[role=option]'))
    const selected = last ? options.at(-1) : options.find(option => option.dataset.value === value) ?? options[0]
    selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest' })
    const outside = (event: PointerEvent) => {
      if (!list.contains(event.target as Node) && !button.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', place, true); window.removeEventListener('resize', place)
    }
  }, [open, disabled, items, value, last])
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'))
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    let next = current
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'ArrowDown') next = (current + 1) % options.length
    else if (event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    else return
    event.preventDefault(); options[next]?.focus()
  }
  return h('span', { className: 'arivo-model-choice' },
    h('button', { ref: trigger, type: 'button', className: 'arivo-control-button', role: 'combobox', disabled,
      'aria-label': label, 'aria-haspopup': 'listbox', 'aria-expanded': open && !disabled, 'aria-controls': id,
      onClick: () => { setLast(false); setOpen(!open) },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setLast(event.key === 'ArrowUp'); setOpen(true) }
      } }, h('span', null, items.find(item => item.id === value)?.name ?? placeholder), h('span', { 'aria-hidden': true }, '⌄')),
    open && !disabled ? createPortal(h('div', { ref: popup, id, className: 'arivo-model-popup', role: 'listbox', 'aria-label': label, popover: 'manual', onKeyDown: keyboard },
      ...[{ id: '', name: placeholder }, ...items].map(item => h('button', { key: item.id, type: 'button', role: 'option', 'data-value': item.id,
        'aria-selected': item.id === value, onClick: () => { close(true); onChange(item.id) } }, item.name, item.id === value ? h('span', { 'aria-hidden': true }, '✓') : null))), trigger.current?.closest('dialog[open]') ?? document.body) : null)
}
