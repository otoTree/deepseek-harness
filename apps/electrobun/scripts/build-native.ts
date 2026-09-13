/** Compile the credential helper for the host macOS architecture. */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('The desktop native build requires macOS')
const output = fileURLToPath(new URL('../build/native/', import.meta.url))
mkdirSync(output, { recursive: true })
execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'Security',
  fileURLToPath(new URL('../native/keychain.swift', import.meta.url)), '-o', output + 'keychain'], { stdio: 'inherit' })
