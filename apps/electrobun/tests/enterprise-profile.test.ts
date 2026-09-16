import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enterpriseProfilePatch } from '../src/enterprise-profile.ts'

void test('desktop frontend override preserves the complete Web runtime configuration', () => {
  const patch = enterpriseProfilePatch({
    home: '/tmp/dsh-enterprise-profile',
    frontendIndex: '/Applications/Enterprise Agent.app/Contents/Resources/app/frontend/index.html',
    apiUrl: 'https://api.example.com',
    organizationId: '00000000-0000-4000-8000-000000000001',
    keychainHelper: '/Applications/Enterprise Agent.app/Contents/Resources/app/native/keychain',
    keychainAccount: 'account',
    defaultModel: 'model',
    plugins: {
      llmFiles: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/llm-files.js',
      gateway: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/gateway.js',
      sessionPersistence: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/session.js',
      enterpriseClient: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/client.js',
    },
  })
  const runtimeBlock = [
    '- id: web-runtime', '  config:', '    openBrowser: false', '    printUrl: true',
    '    surfaceContext: true', '    trustedHosts: []', '    distIndex:',
  ].join('\n')
  assert.ok(patch.includes(runtimeBlock))
})
