import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateTaskCost, expandAdapterTemplate, readTemplatePath } from '../src/model-tasks.ts'

void test('adapter templates replace only explicit value paths', () => {
  const scope = { input: { prompt: 'A still life', count: 2 }, taskId: 'task-1' }
  assert.deepEqual(expandAdapterTemplate({ prompt: '{{input.prompt}}', n: '{{input.count}}', path: '/tasks/{{taskId}}' }, scope), {
    prompt: 'A still life', n: 2, path: '/tasks/task-1',
  })
  assert.equal(readTemplatePath(scope, 'input.missing'), undefined)
  assert.equal(expandAdapterTemplate('prompt={{input.missing}}', scope), 'prompt=')
  assert.equal(expandAdapterTemplate('{{input.missing}}', scope), undefined)
})

void test('task settlement prices token, image, and duration measures with integer CNY arithmetic', () => {
  assert.equal(calculateTaskCost({ complete: true, items: [
    { key: 'input_tokens', unit: 'token', quantity: '1000000', source: 'usage.input_tokens', final: true },
    { key: 'generated_images', unit: 'image', quantity: '2', source: 'usage.images', final: true },
    { key: 'video_seconds', unit: 'second', quantity: '1.5', source: 'usage.seconds', final: true },
  ] }, { input_tokens: '15', generated_images: '200', video_seconds: '100' }), 565)
})

void test('task settlement rejects incomplete usage and a missing frozen price', () => {
  assert.throws(() => calculateTaskCost({ complete: false, items: [] }, {}), /incomplete/u)
  assert.throws(() => calculateTaskCost({ complete: true, items: [
    { key: 'video_seconds', unit: 'second', quantity: '2', source: 'usage.seconds', final: true },
  ] }, {}), /price or quantity/u)
})
