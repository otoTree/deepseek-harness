import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: '智域OS',
    short_name: '智域OS',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.png',
      sizes: '1024x1024',
      type: 'image/png',
      purpose: 'any',
    }],
  })
})

it('ships the same product icon used by the native desktop and Admin', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.png'))
  expect(favicon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(favicon.readUInt32BE(16)).toBe(1024)
  expect(favicon.readUInt32BE(20)).toBe(1024)
  expect(favicon).toEqual(await readFile(new URL('../../electrobun/assets/desktop-icon.png', import.meta.url)))
  expect(favicon).toEqual(await readFile(new URL('../../admin/app/icon.png', import.meta.url)))
})
