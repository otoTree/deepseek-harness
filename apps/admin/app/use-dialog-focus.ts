'use client'

/** Keyboard focus ownership for the Admin's modal forms. */
import { useEffect } from 'react'

/** Trap Tab in the active modal and restore its invoking control when it closes. */
export function useDialogFocus(): void {
  useEffect(() => {
    let current: HTMLElement | undefined
    let previous: HTMLElement | undefined
    const overflow = document.body.style.overflow
    const controls = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(':is(button, a[href], input, select, textarea, summary, [tabindex="0"]):not(:disabled)'))
      .filter((element) => {
        const collapsed = element.closest('details:not([open])')
        return !element.closest('[hidden], [inert]') && !element.matches('input[type="hidden"]') &&
          (!collapsed || Boolean(collapsed.querySelector('summary')?.contains(element)))
      })
    const synchronize = () => {
      const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(element => !element.closest('[hidden]')).at(-1)
      if (dialog === current) return
      if (!dialog) {
        document.body.style.overflow = overflow
        if (previous?.isConnected) previous.focus()
        current = undefined; previous = undefined
        return
      }
      if (!current) previous = document.activeElement instanceof window.HTMLElement ? document.activeElement : undefined
      current = dialog
      document.body.style.overflow = 'hidden'
      if (!dialog.contains(document.activeElement)) {
        dialog.tabIndex = -1
        ;(controls(dialog)[0] ?? dialog).focus()
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (!current) return
      if (event.key === 'Escape') {
        const close = current.querySelector<HTMLButtonElement>('[data-dialog-close]:not(:disabled)')
        if (close) { event.preventDefault(); close.click() }
      }
      if (event.key !== 'Tab') return
      const focusable = controls(current)
      const first = focusable[0] ?? current
      const last = focusable.at(-1) ?? current
      const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last
      if (!current.contains(document.activeElement) || document.activeElement === current || atEdge) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    const observer = new window.MutationObserver(synchronize)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
    document.addEventListener('keydown', keydown)
    synchronize()
    return () => { observer.disconnect(); document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow }
  }, [])
}
