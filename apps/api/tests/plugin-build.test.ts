import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPlugin } from '../src/plugin-build.ts'

void describe('controlled plugin build', () => {
  void it('emits deterministic artifact and SBOM metadata', async () => {
    const result = await buildPlugin({ target: 'desktop', source: 'export default 1', lockfile: '{"lockfileVersion":3}' })
    assert.deepEqual(result.findings, [])
    assert.equal(result.artifactDigest.length, 64)
    assert.equal(result.sbom.packageManager, 'npm')
  })
  void it('blocks missing lockfiles and runtime installation', async () => {
    const result = await buildPlugin({ target: 'cloud', source: 'npm install evil', lockfile: '' })
    assert.deepEqual(result.findings.filter(f => f.blocker).map(f => f.kind), ['syntax', 'vulnerability', 'runtime-install'])
  })
})
