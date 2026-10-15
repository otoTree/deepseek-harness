/** Protects macOS host windows from Electrobun 2.0.1 CEF guest close requests. */

interface GuestView {
  readonly renderer: 'native' | 'cef'
  readonly windowId: number
  readonly isRemoved: boolean
  on(name: string, handler: (event: unknown) => void): void
  remove(): void
}

/** Native window close request with a synchronous veto response. */
export interface NativeWindowCloseEvent {
  data: { id: number }
  response: { allow: boolean } | undefined
}

/** Consumes the parent-window close request emitted when a loaded CEF child is removed. */
export class NativeGuestCloseGuard {
  private readonly pending = new Map<number, number>()

  /** Track loaded child removal; uninitialized CEF views never request window closure.
   * @param view - Embedded view created by an electrobun-webview tag.
   */
  observe(view: GuestView): void {
    if (view.renderer !== 'cef') return
    let loaded = false
    view.on('did-commit-navigation', () => { loaded = true })
    const remove = view.remove.bind(view)
    view.remove = () => {
      if (loaded && !view.isRemoved) this.pending.set(view.windowId, (this.pending.get(view.windowId) ?? 0) + 1)
      remove()
    }
  }

  /** Veto the CEF child close request without consuming subsequent user window closes.
   * @param event - Native parent window close request.
   */
  beforeClose(event: NativeWindowCloseEvent): void {
    const count = this.pending.get(event.data.id)
    if (count === undefined) return
    if (count === 1) this.pending.delete(event.data.id)
    else this.pending.set(event.data.id, count - 1)
    event.response = { allow: false }
  }
}
