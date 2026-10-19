import test from 'node:test'
import assert from 'node:assert/strict'
import { pnpmInvocation } from '../scripts/run-pnpm.ts'

void test('pnpm invocation preserves Windows arguments through PowerShell JSON input', () => {
  const args = ['-r', 'list', '--depth', '-1', '--json', 'path with spaces', 'quote"value']
  const invocation = pnpmInvocation(args, 'win32', { PATH: 'C:\\tools' })
  assert.equal(invocation.command, 'powershell.exe')
  assert.deepEqual(JSON.parse(invocation.env.DSH_PNPM_ARGUMENTS ?? 'null'), args)
  assert.equal(invocation.args[0], '-NoLogo')
  assert.match(invocation.args.at(-1) ?? '', /pnpm\.cmd/)
})

void test('pnpm invocation uses the native executable on POSIX hosts', () => {
  const environment = { PATH: '/usr/bin' }
  const args = ['run', 'build']
  const invocation = pnpmInvocation(args, 'darwin', environment)
  assert.equal(invocation.command, 'pnpm')
  assert.deepEqual(invocation.args, args)
  assert.equal(invocation.env, environment)
})
