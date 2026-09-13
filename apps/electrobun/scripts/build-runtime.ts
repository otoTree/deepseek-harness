/** Compile the built dsh CLI into the desktop application's bundled runtime. */
import { execFileSync } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The enterprise desktop runtime is built for Apple Silicon macOS')
const source = resolve(process.cwd(), '../cli/lib/bin.js')
const output = resolve(process.cwd(), 'build/dsh')
await access(source, constants.R_OK)
await mkdir(dirname(output), { recursive: true })
execFileSync('bun', ['build', '--compile', source, '--outfile', output], { stdio: 'inherit' })
await access(output, constants.X_OK)
