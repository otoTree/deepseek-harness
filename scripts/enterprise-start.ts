/** Start only this repository's enterprise development stack and owned children. */
import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

const root = process.cwd()
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children: ChildProcess[] = []
const withDesktop = process.argv.includes('--desktop')
let requestShutdown: (() => void) | undefined

function run(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, { cwd: root, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} exited with ${signal ?? `code ${code ?? 'unknown'}`}`))
    })
  })
}

function start(args: string[], label: string): ChildProcess {
  const env = { ...process.env }
  // The compiled desktop binary still resolves its profile bundles from the
  // workspace installation during development. The packaged app supplies a
  // read-only runtime tree; development must point at the checked-out CLI
  // manifest instead of the not-yet-packaged app/runtime anchor.
  if (label === 'enterprise desktop') {
    if (env.DSH_ENTERPRISE_INSTALL_ANCHOR === undefined) {
      env.DSH_ENTERPRISE_INSTALL_ANCHOR = join(root, 'apps', 'cli', 'package.json')
    }
    if (env.DSH_ENTERPRISE_BINARY === undefined) {
      env.DSH_ENTERPRISE_BINARY = join(root, 'apps', 'electrobun', 'scripts', 'dev-runtime')
    }
  }
  const child = spawn(pnpm, args, { cwd: root, env, stdio: 'inherit', detached: true })
  children.push(child)
  child.once('error', (error: Error) => { console.error(`${label}: ${error.message}`) })
  child.once('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') console.error(`${label} exited with ${signal ?? code ?? 'unknown status'}`)
    // Closing the Electrobun window ends the desktop child without sending a
    // signal to this detached coordinator. Treat that exit as application
    // shutdown so API/admin and their process groups do not outlive the UI.
    if (label === 'enterprise desktop') requestShutdown?.()
  })
  return child
}

function stop(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return Promise.resolve()
  return new Promise((resolve) => {
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearInterval(interval)
      resolve()
    }
    const check = (): void => {
      try {
        process.kill(-pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') finish()
      }
    }
    const interval = setInterval(check, 100)
    const timer = setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL') } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ESRCH') console.error(`Failed to force-stop child process: ${String(error)}`)
      }
      finish()
    }, 15_000)
    try { process.kill(-pid, 'SIGTERM') } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ESRCH') console.error(`Failed to stop child process: ${String(error)}`)
      if (code === 'ESRCH') finish()
    }
    check()
  })
}

/** Wait until an HTTP service accepts requests, failing instead of reporting a false-ready stack. */
async function waitForHttp(url: string, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`${label} returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms: ${String(lastError)}`)
}

/** Fail before spawning children when another process already owns an application port. */
async function assertPortAvailable(port: number, label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        reject(new Error(`${label} port 127.0.0.1:${port} is already in use; stop the existing enterprise process before retrying`))
      } else {
        reject(error)
      }
    })
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

async function main(): Promise<void> {
  // dev-runtime loads the CLI source, but its workspace and browser imports
  // resolve generated lib files. Refresh them before any service can start.
  await run(['run', 'enterprise:build'], 'enterprise workspace build')
  if (withDesktop) await run(['run', 'enterprise:build:desktop'], 'enterprise desktop build')
  if (!existsSync(join(root, '.env.enterprise'))) await run(['run', 'enterprise:infra', 'init'], 'enterprise:infra init')
  await run(['run', 'enterprise:infra', 'check'], 'enterprise:infra check')
  await run(['run', 'enterprise:infra', 'up'], 'enterprise:infra up')
  await run(['--filter', '@deepseek-ai/dsh-enterprise-api', 'db:migrate'], 'enterprise database migration')
  await run(['run', 'enterprise:provision', '--', '--if-needed'], 'enterprise provisioning')

  await assertPortAvailable(8787, 'Enterprise API')
  await assertPortAvailable(3000, 'Enterprise admin')

  start(['run', 'enterprise:api'], 'enterprise API')
  start(['run', 'enterprise:admin'], 'enterprise admin')
  await waitForHttp('http://127.0.0.1:8787/health', 'Enterprise API')
  await waitForHttp('http://127.0.0.1:3000', 'Enterprise admin')
  // The desktop runtime immediately loads the model directory and acquires
  // session leases. Start it only after both remote services can answer.
  if (withDesktop) start(['--filter', '@deepseek-ai/dsh-enterprise-desktop', 'dev:prepared'], 'enterprise desktop')

  console.log('Enterprise development stack is running.')
  console.log('Admin: http://127.0.0.1:3000')
  console.log('API:   http://127.0.0.1:8787')
  if (withDesktop) console.log('Desktop: Electrobun development window')
  console.log('Press Ctrl-C to stop the application processes. Infrastructure remains available for the next start.')

  await new Promise<void>((resolve) => {
    let stopping = false
    const shutdown = (): void => {
      if (stopping) return
      stopping = true
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      process.off('SIGHUP', shutdown)
      void Promise.all(children.map(stop)).then(() => { resolve() })
    }
    requestShutdown = shutdown
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    // Closing the terminal sends SIGHUP to this coordinator. The children are
    // detached so they can be stopped as complete process groups here; without
    // this handler they would keep listening on the application ports.
    process.once('SIGHUP', shutdown)
  })
}

main().catch((error: unknown) => {
  void Promise.all(children.map(stop)).finally(() => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
})
