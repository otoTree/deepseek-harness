import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { taskConfigSchema, decodeTaskOutcome, resolveTaskParameters, taskReservation, calculateTaskCost, seedanceRequest } from '../src/model-task-rules.ts'

const config = () => taskConfigSchema.parse({ baseUrl: 'https://provider.example/v1', driver: 'crl-seedance-v1', upstreamModel: 'seedance-2-0',
  submit: { path: '/videos/generations' }, query: { method: 'GET', path: '/tasks/{{providerTaskId}}' },
  parameters: { duration: { type: 'integer', minimum: 4, maximum: 15, specialValues: [-1], default: 5 },
    resolution: { type: 'string', values: ['480p', '720p'], default: '480p' }, ratio: { type: 'string', default: '16:9' },
    withAudio: { type: 'boolean' }, generate_audio: { type: 'boolean' }, watermark: { type: 'boolean', default: false } },
  reserve: { quantityPath: 'settings.duration', microsCnyPerUnit: '1000000', quantityOverrides: { '-1': 15 } },
  response: { status: 'status', statusValues: {}, usage: [] } })

void test('published Seedance templates validate every scheme and preserve automatic duration', async () => {
  const template = JSON.parse(await readFile(new URL('../../../docs/developer/model-platform-seedance.examples.json', import.meta.url), 'utf8')) as {
    provenance: { actualCrlPricesVerified: boolean; referenceWireFormatVerified: boolean }
    videoReferencePublicationPatch: { configuration: { referenceMapping: unknown } }
    operations: { key: string; publication: { configuration: unknown; prices: Record<string, string> } }[]
  }
  assert.equal(template.provenance.actualCrlPricesVerified, false)
  assert.equal(template.provenance.referenceWireFormatVerified, false)
  assert.deepEqual(template.operations.map(item => item.key), ['gateway-seedance-2-0-fast-tezan-video', 'gateway-seedance-2-5-video', 'sd2.0-xu'])
  for (const [index, entry] of template.operations.entries()) {
    const rules = taskConfigSchema.parse(entry.publication.configuration)
    const parameters = resolveTaskParameters(rules, { duration: -1 })
    assert.equal(taskReservation(rules, parameters, 1), index === 1 ? 45_000_000 : 15_000_000)
    assert.equal(seedanceRequest(rules, { prompt: 'Ocean at sunset' }, parameters).duration, -1)
    assert.equal(rules.upstreamModel, ['seedance-2-0', 'seedance-2-5', 'doubao-seedance-2-0-260128'][index])
    assert.equal(rules.pollIntervalMs, 30_000)
    assert.equal(rules.timeoutMs, 300_000)
    assert.equal(Object.keys(rules.referenceMapping).length, 0)
    const referenced = taskConfigSchema.parse({
      ...rules, referenceMapping: template.videoReferencePublicationPatch.configuration.referenceMapping,
    })
    const content = seedanceRequest(referenced, { prompt: 'Ocean', references: [{ kind: 'video', url: 'https://media.example/reference.mp4' }] }, parameters).content
    assert.deepEqual(content, [{ type: 'text', text: 'Ocean' }, { type: 'video_url', video_url: { url: 'https://media.example/reference.mp4' }, role: 'reference_video' }])
    assert.equal(rules.parameters.ratio.values!.includes('adaptive'), index !== 2)
    assert.throws(() => calculateTaskCost({ complete: true, items: [{ key: 'completion_tokens', unit: 'token', quantity: '1', source: 'usage.completion_tokens', final: true }] }, entry.publication.prices))
  }
})

void test('Seedance submit accepts id-only responses and ordered task-id fallbacks', () => {
  for (const body of [{ id: 'a' }, { task_id: 'a' }, { data: { id: 'a' } }]) {
    assert.deepEqual(decodeTaskOutcome(config(), body, true), { status: 'processing', providerTaskId: 'a', results: [], usage: { complete: false, items: [] } })
  }
  assert.equal(decodeTaskOutcome(config(), { id: 'first', task_id: 'second' }, true).providerTaskId, 'first')
  assert.throws(() => decodeTaskOutcome(config(), {}, true), /unmapped/)
})

void test('Seedance rejects completed responses without a valid video and maps failure terminals', () => {
  for (const status of ['completed', 'succeeded', 'success']) {
    assert.equal(decodeTaskOutcome(config(), { status }, false).error?.code, 'provider_output_invalid')
    assert.equal(decodeTaskOutcome(config(), { status, content: { video_url: 'javascript:bad' } }, false).status, 'failed')
  }
  for (const status of ['failed', 'error', 'cancelled', 'canceled', 'expired']) {
    assert.ok(['failed', 'cancelled'].includes(decodeTaskOutcome(config(), { status }, false).status))
  }
})

void test('automatic duration reserves the configured maximum and preserves the provider sentinel and audio precedence', () => {
  const rules = config()
  const parameters = resolveTaskParameters(rules, { duration: -1, withAudio: false, generate_audio: true })
  assert.equal(taskReservation(rules, parameters, 1), 15_000_000)
  const request = seedanceRequest(rules, { prompt: 'Ocean at sunset' }, parameters)
  assert.equal(request.duration, -1)
  assert.equal(request.generate_audio, false)
  assert.equal(request.resolution, '480p')
  assert.equal(taskReservation(rules, resolveTaskParameters(rules, {}), 1), 5_000_000)
  for (const value of [3, 16, '-1', 5.5]) assert.throws(() => resolveTaskParameters(rules, { duration: value }))
  assert.throws(() => resolveTaskParameters(rules, { extra: 1 }), /Unsupported/)
  assert.throws(() => seedanceRequest(rules, { prompt: 'x', references: [{ kind: 'video', url: 'https://asset.example/video' }] }, parameters), /not configured/)
})

void test('completion tokens are charged once, zero is valid, and malformed usage cannot become free', () => {
  const response = { status: 'completed', content: { video_url: 'https://asset.example/video.mp4' }, usage: { completion_tokens: 151078, total_tokens: 151078 } }
  const outcome = decodeTaskOutcome(config(), response, false)
  assert.equal(outcome.usage?.items.length, 1)
  assert.equal(calculateTaskCost(outcome.usage, { completion_tokens: '46000000' }), 6_949_588)
  const zero = decodeTaskOutcome(config(), { ...response, usage: { completion_tokens: 0 } }, false)
  assert.equal(calculateTaskCost(zero.usage!, { completion_tokens: '46000000' }), 0)
  for (const invalid of [-1, 'bad', true, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    const value = decodeTaskOutcome(config(), { ...response, usage: { completion_tokens: invalid } }, false)
    assert.throws(() => calculateTaskCost(value.usage!, { completion_tokens: '46000000' }))
  }
  assert.equal(decodeTaskOutcome(config(), { ...response, usage: {} }, false).usage?.complete, false)
})

void test('overlapping total and completion usage paths are rejected at configuration load', () => {
  assert.throws(() => taskConfigSchema.parse({ ...config(), driver: 'template-v1', response: {
    status: 'status', statusValues: { completed: 'succeeded' }, usage: [
      { key: 'total', unit: 'token', path: 'usage.total_tokens' }, { key: 'completion', unit: 'token', path: 'usage.completion_tokens' },
    ],
  } }), /overlap/)
})
