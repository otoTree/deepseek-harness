import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { TerminalSessionId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import type { WorkbenchKey } from '../locales.ts'
import css from './panels.module.css'

type Translator = (key: WorkbenchKey) => string
interface TerminalPanelProps {
  reconnect: () => void
  t: Translator
  remote: WorkbenchRemote
  sessionId: SessionId
  terminalId: TerminalSessionId | undefined
  setTerminalId: (terminalId: TerminalSessionId | undefined) => void
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Session-owned PTY rendered as a direct terminal input and output surface. */
export function TerminalPanel({ t, reconnect, remote, sessionId, terminalId, setTerminalId }: TerminalPanelProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [resolvedId, setResolvedId] = useState<TerminalSessionId | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const listed = await remote.terminalList({ sessionId })
      if (!listed.ok) {
        if (!isAborted(controller.signal)) setError(listed.error.message)
        return
      }
      if (isAborted(controller.signal)) return
      const running = listed.value.items.filter(item => item.status.kind === 'running')
      const selected = running.find(item => item.sessionId === terminalId)
        ?? running.find(item => item.name === 'Workbench') ?? running[0]
      if (selected !== undefined) {
        if (!isAborted(controller.signal)) {
          setResolvedId(selected.sessionId as TerminalSessionId)
          setTerminalId(selected.sessionId as TerminalSessionId)
          setError(undefined)
        }
        return
      }
      const exited = listed.value.items.find(item => item.name === 'Workbench')
      if (exited !== undefined) {
        const closed = await remote.terminalClose({ sessionId, terminalId: exited.sessionId as TerminalSessionId })
        if (isAborted(controller.signal)) return
        if (!closed.ok) { setError(closed.error.message); return }
      }
      const opened = await remote.terminalOpen({ sessionId, type: 'shell', name: 'Workbench' }, controller.signal)
      if (!isAborted(controller.signal)) {
        if (opened.ok) {
          setResolvedId(opened.value.terminal.sessionId as TerminalSessionId)
          setTerminalId(opened.value.terminal.sessionId as TerminalSessionId)
          setError(undefined)
        } else setError(opened.error.message)
      }
    })().catch((failure: unknown) => {
      if (!isAborted(controller.signal)) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { controller.abort() }
  }, [remote, sessionId, setTerminalId])

  useEffect(() => {
    const terminalId = resolvedId
    const mount = mountRef.current
    if (mount === null || terminalId === undefined) return
    const followController = new AbortController()
    const style = getComputedStyle(mount)
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: false,
      fontFamily: style.fontFamily,
      fontSize: Number.parseFloat(style.fontSize),
      scrollback: 5_000,
      screenReaderMode: true,
      theme: {
        background: style.backgroundColor,
        foreground: style.color,
        cursor: style.color,
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(mount)

    let inputWrites = Promise.resolve()
    const input = terminal.onData((data) => {
      inputWrites = inputWrites.then(async () => {
        if (followController.signal.aborted) return
        const result = await remote.terminalWrite({ sessionId, terminalId, data })
        if (!result.ok) throw new Error(result.error.message)
      }).catch((failure: unknown) => {
        if (!followController.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
      })
    })

    void (async () => {
      for await (const frame of remote.terminalFollow({ sessionId, terminalId }, followController.signal)) {
        if (followController.signal.aborted) return
        if (frame.type === 'baseline') terminal.reset()
        terminal.write(frame.text)
      }
    })().catch((failure: unknown) => {
      if (!followController.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    })

    let lastSize = ''
    let resizes = Promise.resolve()
    const resize = (): void => {
      if (followController.signal.aborted || mount.clientWidth < 1 || mount.clientHeight < 1) return
      fit.fit()
      const size = `${terminal.rows}:${terminal.cols}`
      if (size === lastSize) return
      lastSize = size
      resizes = resizes.then(async () => {
        if (followController.signal.aborted) return
        const result = await remote.terminalResize({ sessionId, terminalId, rows: terminal.rows, cols: terminal.cols })
        if (!result.ok) throw new Error(result.error.message)
      }).catch((failure: unknown) => {
        if (!followController.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
      })
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
    observer?.observe(mount)
    const initialFit = requestAnimationFrame(() => {
      resize()
      terminal.focus()
    })
    const focus = (): void => { terminal.focus() }
    mount.addEventListener('pointerdown', focus)

    return () => {
      cancelAnimationFrame(initialFit)
      mount.removeEventListener('pointerdown', focus)
      observer?.disconnect()
      followController.abort()
      input.dispose()
      fit.dispose()
      terminal.dispose()
    }
  }, [remote, sessionId, resolvedId])

  return <section className={css.panel} aria-label={t('terminal')}>
    {error === undefined ? null : <div className={css.error} role="alert">{error}<button type="button" onClick={reconnect}>{t('reconnect')}</button></div>}
    <div
      ref={mountRef}
      className={css.terminalCanvas}
      role="application"
      aria-label={t('terminalInput')}
    />
  </section>
}
