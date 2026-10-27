/** Compile the native credential helper for the desktop host. */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { desktopProductDirectories, resolveDesktopDistribution } from '../src/distribution/config.ts'
import { compileWindowsNative } from './compile-windows-native.ts'

const distribution = resolveDesktopDistribution(process.env.DSH_DESKTOP_DISTRIBUTION)
const output = fileURLToPath(new URL(`../${desktopProductDirectories(distribution).build}/native/`, import.meta.url))
const defines = distribution.id === 'arivo' ? ['ARIVO_STUDIO'] : []
mkdirSync(output, { recursive: true })
if (process.platform === 'darwin' && process.arch === 'arm64') {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'Security', ...defines.flatMap(symbol => ['-D', symbol]),
    fileURLToPath(new URL('../native/keychain.swift', import.meta.url)), '-o', output + 'keychain'], { stdio: 'inherit' })
} else if (process.platform === 'win32' && process.arch === 'x64') {
  compileWindowsNative(fileURLToPath(new URL('../native/keychain-windows.c', import.meta.url)),
    output + 'keychain.exe', ['bcrypt.lib', 'crypt32.lib'], defines)
} else {
  throw new Error('The desktop native build supports Apple Silicon macOS and x64 Windows hosts')
}
if (distribution.id === 'arivo') {
  const source = fileURLToPath(new URL('../native/arivo-instance.c', import.meta.url))
  if (process.platform === 'win32') compileWindowsNative(source, output + 'instance.exe')
  else {
    execFileSync('/usr/bin/xcrun', ['clang', '-Os', '-Wall', '-Wextra', '-Werror', source, '-o', output + 'instance'], { stdio: 'inherit' })
    execFileSync('/usr/bin/xcrun', ['clang', '-Os', '-Wall', '-Wextra', '-Werror',
      fileURLToPath(new URL('../native/arivo-bootstrap.c', import.meta.url)), '-o', output + 'bootstrap'], { stdio: 'inherit' })
  }
}
