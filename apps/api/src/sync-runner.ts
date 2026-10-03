/** Run a directory script in a bounded child process with an SDK-only surface. */
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

/** One bounded page emitted by a directory script. */
export interface SyncScriptPage {
  items: unknown[]
  nextCursor?: string | null
  total?: number
}

/** Canonical directory entities or a paged entity response. */
export interface SyncScriptResult { users?: unknown[] | SyncScriptPage; organizations?: unknown[] | SyncScriptPage; memberships?: unknown[] | SyncScriptPage; groups?: unknown[] | SyncScriptPage; [key: string]: unknown }
export interface SyncScriptInput { source: string; input: Record<string, unknown>; timeoutMs?: number; maxOutputBytes?: number }

const forbidden = /(?:\b(?:process|require|global|Buffer|eval|Function)\b|(?:node:)?(?:fs|net|tls|child_process|worker_threads|node:fs)(?:['"`]|\b))/u

/** Execute a script and return a preview payload. The worker has no database or network SDK. */
export function runSyncScript(input: SyncScriptInput): Promise<SyncScriptResult> {
  if (forbidden.test(input.source)) return Promise.reject(new Error('Script uses a forbidden runtime capability'))
  const compiled = transformSync(input.source, { loader: 'ts', format: 'cjs', platform: 'node', target: 'node22' }).code
  const worker = fork(fileURLToPath(new URL('./sync-script-worker.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 5_000, 100), 30_000)
  const maxOutputBytes = Math.min(Math.max(input.maxOutputBytes ?? 256_000, 1_024), 1_000_000)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error: Error | undefined, value?: SyncScriptResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.kill('SIGKILL')
      error ? reject(error) : resolve(value ?? {})
    }
    const timer = setTimeout(() => finish(new Error('Script execution timed out')), timeoutMs)
    worker.on('message', (message: unknown) => {
      const encoded = JSON.stringify(message)
      if (encoded.length > maxOutputBytes) return finish(new Error('Script output exceeds the configured limit'))
      if (!message || typeof message !== 'object') return finish(new Error('Script returned an invalid result'))
      const result = message as { ok?: boolean; value?: SyncScriptResult; error?: string }
      if (result.ok && result.value) finish(undefined, result.value)
      else finish(new Error(result.error ?? 'Script failed'))
    })
    worker.on('error', error => finish(error instanceof Error ? error : new Error('Script worker failed')))
    worker.send({ code: compiled, input: input.input })
  })
}
