import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import css from './Modal.module.css'

interface ModalBaseProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
}

type ModalProps = ModalBaseProps & (
  | { headless: true; closeLabel?: never }
  | { headless?: false; closeLabel: string }
)

/**
 * Render a centered, body-portaled modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape on the topmost dialog or mask click.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.closeLabel - localized accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, etc.).
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome); mask, card, Escape, and aria-label remain.
 * Focus stays within the open dialog and returns to its opener on close.
 * @returns null when closed; otherwise the overlay tree.
 */
export function Modal({
  open, onClose, title, closeLabel, description, children, footer, className, contentClassName, headless = false,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const card = dialog.current
    const firstField = card?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled):not([aria-hidden=true]),textarea:not(:disabled),[role=combobox]:not(:disabled)')
    const firstButton = card?.querySelector<HTMLElement>('button:not(:disabled)')
    const initialFocus = firstField ?? firstButton ?? card
    if (!card?.contains(previous)) initialFocus?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]')
      if (dialogs.item(dialogs.length - 1) !== dialog.current) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll<HTMLElement>(
          ':is(button,input,select,textarea,a[href],[tabindex]):not(:disabled):not([tabindex="-1"])',
        )]
        const first = controls[0] ?? dialog.current
        const last = controls.at(-1) ?? dialog.current
        if (e.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
          e.preventDefault()
          last.focus()
        }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose])

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={dialog}
        tabIndex={-1}
        className={clsx(css.dialog, className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {headless
          ? children
          : (
            <>
              <div className={clsx(css.content, contentClassName)}>
                <div className={css.header}>
                  <h2 className={css.title}>{title}</h2>
                  <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
                    <IconCloseOutline16 size={14} />
                  </button>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={css.description}>{description}</p>
                )}
                {children !== undefined && <div className={css.body}>{children}</div>}
              </div>
              {footer !== undefined && <div className={css.footer}>{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)
}
