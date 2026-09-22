import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { canonicalJson } from '@deepseek-ai/dsh-enterprise-api/plugins'
import { loadVerifiedPlugin } from '../src/plugin-loader.ts'

const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex')
void describe('verified plugin loader', () => {
  void it('gates loading and makes disposal idempotent', async () => {
    const organizationId = '00000000-0000-4000-8000-000000000001'
    const manifest = { permissions: [] }
    const artifact = 'artifact'
    const release = {
      organizationId,
      pluginId: 'loader-plugin',
      version: '1.0.0',
      digest: hash(artifact),
      manifestDigest: hash(manifest),
      permissionsDigest: hash([]),
      manifest,
      artifact,
      status: 'published',
      policyRevision: 1,
    }
    let loads = 0
    let disposes = 0
    const dispose = await loadVerifiedPlugin(release, organizationId, () => { loads++; return () => { disposes++ } })
    assert.equal(loads, 1)
    await dispose(); await dispose()
    assert.equal(disposes, 1)
    await assert.rejects(() => loadVerifiedPlugin({ ...release, status: 'revoked' }, organizationId, () => () => {}))
  })
})
