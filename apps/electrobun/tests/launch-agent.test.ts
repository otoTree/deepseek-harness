/** Property lists are parsed by the platform tool, without installing a login service. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { launchAgentPlist, launchAgentLabel } from '../src/launch-agent.ts'
import { z } from 'zod'

void test('LaunchAgent rejects relative programs and XML control bytes', () => {
  assert.throws(() => launchAgentPlist('dsh', []), /absolute/)
  assert.throws(() => launchAgentPlist('/bin/dsh', ['bad\0arg']), /XML/)
})

void test('macOS parses escaped paths and throttled restart policy', { skip: process.platform !== 'darwin' }, async () => {
  const args = ['--profile', 'enterprise-desktop', 'a&b<>"\'']
  const plist = launchAgentPlist('/Applications/Enterprise Agent.app/dsh', args, { DSH_HOME: '/tmp/enterprise-home' })
  const parsed = await new Promise<string>((resolve, reject) => {
    const child = execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], (error, stdout) => {
      if (error) reject(new Error('plutil refused the generated property list', { cause: error }))
      else resolve(stdout)
    })
    child.stdin!.end(plist)
  })
  const value = z.object({ Label: z.string(), ProgramArguments: z.array(z.string()),
    EnvironmentVariables: z.object({ DSH_HOME: z.string() }),
    KeepAlive: z.object({ SuccessfulExit: z.boolean() }), ThrottleInterval: z.number(),
  }).parse(JSON.parse(parsed))
  assert.equal(value.Label, launchAgentLabel)
  assert.deepEqual(value.ProgramArguments, ['/Applications/Enterprise Agent.app/dsh', ...args])
  assert.equal(value.EnvironmentVariables.DSH_HOME, '/tmp/enterprise-home')
  assert.deepEqual(value.KeepAlive, { SuccessfulExit: false })
  assert.equal(value.ThrottleInterval, 30)
})
