/** Desktop data roots follow the selected operating system's path conventions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopDataRoot } from '../src/desktop-paths.ts'

void test('desktop data paths use Local AppData on Windows and Application Support on macOS', () => {
  assert.equal(
    desktopDataRoot('win32', { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' }, 'C:\\Users\\Ada'),
    'C:\\Users\\Ada\\AppData\\Local\\DeepSeek Harness',
  )
  assert.equal(
    desktopDataRoot('win32', {}, 'C:\\Users\\Ada'),
    'C:\\Users\\Ada\\AppData\\Local\\DeepSeek Harness',
  )
  assert.equal(
    desktopDataRoot('darwin', {}, '/Users/ada'),
    '/Users/ada/Library/Application Support/DeepSeek Harness',
  )
})
