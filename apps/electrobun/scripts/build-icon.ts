/** Generate the macOS iconset from the repository's product icon. */
import { execFileSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

if (process.platform !== 'darwin') throw new Error('The desktop icon build requires macOS')

const source = resolve(process.cwd(), '../web/public/favicon.svg')
const output = resolve(process.cwd(), 'build/icon.iconset')
const icons = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
] as const

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
for (const [name, size] of icons) {
  execFileSync('/usr/bin/sips', [
    '-s', 'format', 'png',
    '-z', String(size), String(size),
    source,
    '--out', resolve(output, name),
  ], { stdio: 'ignore' })
}

console.log(`Generated ${icons.length} macOS icon files in ${output}`)
