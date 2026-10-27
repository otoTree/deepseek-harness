/** Test-only native callback process; the product browser executes exactly the native-dispatched script. */
import { createInterface } from 'node:readline'
import { prepareArivoNativeDeparture } from '../../src/distribution/arivo-native-departure.ts'

const origin = process.argv[2]
if (!origin) throw new Error('Provide the installed OS origin')
let release: false | (() => void) = false
const lifetime = new AbortController()
process.once('SIGTERM', () => { lifetime.abort(); if (release) release(); process.exitCode = 0 })
try {
  for await (const command of createInterface({ input: process.stdin })) {
    if (command === 'prepare') {
      release = await prepareArivoNativeDeparture({ origin, timeoutMs: 5000, signal: lifetime.signal,
        execute: (script) => { process.stdout.write(JSON.stringify({ script }) + '\n') } })
      process.stdout.write(JSON.stringify({ granted: release !== false }) + '\n')
    } else if (command === 'release') {
      if (release) release()
      release = false
      process.stdout.write(JSON.stringify({ released: true }) + '\n')
    } else throw new Error('Invalid test native operation')
  }
} finally { lifetime.abort(); if (release) release() }
