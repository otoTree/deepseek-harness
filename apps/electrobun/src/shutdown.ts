/** Vetoes native quit until the desktop's owned runtime has stopped. */

/** Synchronous response accepted by Electrobun's before-quit event. */
export interface DesktopQuitEvent {
  response: { allow: boolean } | undefined
}

/** Coordinates native quit requests with asynchronous cleanup. */
export class DesktopShutdown {
  private pending: Promise<void> | undefined
  private ready = false

  constructor(
    private readonly cleanup: () => Promise<void>,
    private readonly quit: () => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Stop owned resources once, then permit the native quit sequence.
   * @param afterCleanup - Optional installer handoff, run only for this first quit request.
   * @returns Completion of cleanup, handoff and quit; failures remain retryable.
   */
  shutdown(afterCleanup?: () => void): Promise<void> {
    if (this.pending && afterCleanup) return Promise.reject(new Error('Desktop quit is already in progress'))
    return this.pending ??= Promise.resolve().then(this.cleanup).then(() => {
      afterCleanup?.()
      this.ready = true
      this.quit()
    }).catch((error: unknown) => {
      this.ready = false
      this.pending = undefined
      throw error
    })
  }

  /** Veto an early quit and request cleanup without blocking the native callback.
   * @param event - Native event whose response is consumed synchronously.
   */
  beforeQuit(event: DesktopQuitEvent): void {
    if (this.ready) return
    event.response = { allow: false }
    void this.shutdown().catch(this.onError)
  }
}
