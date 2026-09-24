import assert from 'node:assert/strict'
import { test } from 'node:test'
import { duplicateUploadName } from '../src/drive.ts'

void test('duplicate upload names preserve extensions and stay within the database limit', () => {
  assert.equal(duplicateUploadName('report.txt', 0), 'report.txt')
  assert.equal(duplicateUploadName('report.txt', 1), 'report (1).txt')
  assert.equal(duplicateUploadName('report.txt', 2), 'report (2).txt')
  assert.equal(duplicateUploadName('README', 1), 'README (1)')
  const name = duplicateUploadName(`${'a'.repeat(255)}.txt`, 12)
  assert.equal(name.length, 255)
  assert.match(name, / \(12\)\.txt$/u)
})
