import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopCdpEndpoint } from '../src/browser-config.ts'
import { enterpriseProfilePatch, provisionEnterpriseProfile } from '../src/enterprise-profile.ts'

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
      driveTools: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/drive-tools.js',
      sessionPersistence: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/session.js',
      enterpriseClient: '/Applications/Enterprise Agent.app/Contents/Resources/app/plugins/client.js',
    },
  })
  const runtimeBlock = [
    '- id: web-runtime', '  config:', '    openBrowser: false', '    printUrl: true',
    '    surfaceContext: true', '    trustedHosts: []', '    distIndex:',
  ].join('\n')
  assert.ok(patch.includes(runtimeBlock))
  assert.ok(patch.includes(`- id: browser-playwright\n  config:\n    desktopCdpEndpoint: ${JSON.stringify(desktopCdpEndpoint)}\n    desktopTimeoutMs: 30000\n`))
  assert.ok(patch.includes('    mode: workspace-write\n'))
  assert.ok(patch.includes('        maxMediaBytes: 536870912\n'))
  assert.ok(patch.includes('        maxResponseChars: 16777216\n'))
  assert.ok(patch.includes('- id: agent-presets\n  config:\n    default: standard\n    roots: [{ path: "/tmp/dsh-enterprise-profile/.agent-presets", trust: user }]\n    includeShippedRoot: true\n    includeUserRoot: false\n'))
  assert.ok(!patch.includes('    - id: agent-presets'))
})

void test('provisioned organization profile retains shipped presets alongside managed plugin presets', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-enterprise-profile-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await provisionEnterpriseProfile({
    home,
    apiUrl: 'https://api.example.com',
    organizationId: '00000000-0000-4000-8000-000000000001',
    keychainHelper: '/app/keychain',
    keychainAccount: 'account',
    defaultModel: 'model',
    plugins: {
      llmFiles: '/app/llm-files.js',
      gateway: '/app/gateway.js',
      driveTools: '/app/drive-tools.js',
      sessionPersistence: '/app/session.js',
      enterpriseClient: '/app/client.js',
    },
  })
  const patch = await readFile(join(home, 'profiles', 'enterprise-desktop', 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes(`roots: [{ path: "${home}/.agent-presets", trust: user }]`))
  assert.ok(patch.includes('includeShippedRoot: true\n    includeUserRoot: false'))
})
