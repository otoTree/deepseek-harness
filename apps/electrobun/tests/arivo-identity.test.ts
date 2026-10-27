/** Arivo deployment settings remain explicit, non-secret and independent from enterprise composition. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arivoIdentitySettings, readArivoIdentitySettings } from '../src/distribution/arivo-identity.ts'

void test('Arivo account configuration is optional and accepts distinct Web/API origins', () => {
  assert.equal(readArivoIdentitySettings(undefined), undefined)
  assert.equal(readArivoIdentitySettings(''), undefined)
  const config = { apiOrigin: 'https://api.arivo.example', webOrigin: 'https://arivo.example', requestTimeoutMs: 10000, loginTimeoutMs: 180000 }
  assert.deepEqual(readArivoIdentitySettings(JSON.stringify(config)), config)
  assert.equal(arivoIdentitySettings.safeParse({ ...config, apiOrigin: 'http://127.0.0.1:8787' }).success, true)
  for (const apiOrigin of ['http://arivo.example', 'https://arivo.example/', 'https://u:p@arivo.example', 'https://arivo.example/path']) {
    assert.equal(arivoIdentitySettings.safeParse({ ...config, apiOrigin }).success, false)
  }
  for (const invalid of [{ ...config, webOrigin: undefined }, { ...config, accessToken: 'secret' }, { ...config, loginTimeoutMs: 0 }]) {
    assert.throws(() => readArivoIdentitySettings(JSON.stringify(invalid)))
  }
})
