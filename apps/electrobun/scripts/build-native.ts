/** Compile the native credential helper for the desktop host. */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileWindowsNative } from './compile-windows-native.ts'

const output = fileURLToPath(new URL('../build/native/', import.meta.url))
mkdirSync(output, { recursive: true })
if (process.platform === 'darwin' && process.arch === 'arm64') {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'Security',
    fileURLToPath(new URL('../native/keychain.swift', import.meta.url)), '-o', output + 'keychain'], { stdio: 'inherit' })
} else if (process.platform === 'win32' && process.arch === 'x64') {
  compileWindowsNative(fileURLToPath(new URL('../native/keychain-windows.c', import.meta.url)),
    output + 'keychain.exe', ['bcrypt.lib', 'crypt32.lib'])
} else {
  throw new Error('The desktop native build supports Apple Silicon macOS and x64 Windows hosts')
}
