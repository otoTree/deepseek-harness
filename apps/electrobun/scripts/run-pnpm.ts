/** Run pnpm with arguments preserved on Windows and POSIX hosts. */
import { execFileSync } from 'node:child_process'

interface PnpmInvocation {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/** Build a shell-free pnpm invocation for the active host.
 * @param args - pnpm command and arguments.
 * @param platform - Node platform identifier.
 * @param environment - Child process environment.
 * @returns Executable, arguments and environment for pnpm.
 */
export function pnpmInvocation(
  args: string[],
  platform: string,
  environment: NodeJS.ProcessEnv,
): PnpmInvocation {
  if (platform !== 'win32') return { command: 'pnpm', args, env: environment }
  return {
    command: 'powershell.exe',
    args: [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; $utf8 = New-Object System.Text.UTF8Encoding; [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; $pnpmArguments = ConvertFrom-Json $env:DSH_PNPM_ARGUMENTS; & pnpm.cmd @pnpmArguments; exit $LASTEXITCODE',
    ],
    env: { ...environment, DSH_PNPM_ARGUMENTS: JSON.stringify(args) },
  }
}

/** Execute one pnpm command without shell-parsing its arguments.
 * @param args - pnpm command and arguments.
 * @param options - working directory and child environment.
 */
export function runPnpm(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): void {
  const invocation = pnpmInvocation(args, process.platform, options.env ?? process.env)
  execFileSync(invocation.command, invocation.args, {
    cwd: options.cwd, stdio: 'inherit', env: invocation.env,
  })
}

/** Capture one pnpm command's UTF-8 output without a command shell.
 * @param args - pnpm command and arguments.
 * @param options - working directory and child environment.
 * @returns Captured standard output.
 */
export function capturePnpm(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): string {
  const invocation = pnpmInvocation(args, process.platform, options.env ?? process.env)
  return execFileSync(invocation.command, invocation.args, {
    cwd: options.cwd, encoding: 'utf8', env: invocation.env,
  })
}
