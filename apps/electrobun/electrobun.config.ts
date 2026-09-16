import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'deepseek-harness-enterprise',
    identifier: 'ai.deepseek.harness.enterprise',
    version: '0.1.0',
  },
  build: {
    // Cottontail 0.5.0 segfaults before loading the entrypoint on current
    // Apple Silicon/macOS. Bun is supported by Electrobun and starts the same
    // main-process module without that native runtime crash.
    mainProcess: 'bun',
    bun: { entrypoint: 'src/index.ts' },
    copy: {
      'build/frontend': 'frontend',
      'build/native/keychain': 'native/keychain',
      'build/dsh': 'dsh',
      // The compiled runtime still resolves profile bundles from an install
      // anchor.  Ship the CLI manifest at that anchor in packaged builds.
      '../../apps/cli/package.json': 'runtime/package.json',
      '../../packages/llm/llm-files/lib/index.js': 'plugins/llm-files.js',
      'lib/gateway-provider.js': 'plugins/gateway-provider.js',
      'lib/session-provider.js': 'plugins/session-provider.js',
      'lib/enterprise-sandbox.js': 'plugins/enterprise-sandbox.js',
      '../../packages/client/ui-enterprise/package.json': 'plugins/enterprise-client/package.json',
      '../../packages/client/ui-enterprise/lib/index.js': 'plugins/enterprise-client/lib/index.js',
      '../../packages/client/ui-enterprise/lib/index.js.map': 'plugins/enterprise-client/lib/index.js.map',
      '../../packages/client/ui-enterprise/lib/client.js': 'plugins/enterprise-client/lib/client.js',
      '../../packages/client/ui-enterprise/lib/client.js.map': 'plugins/enterprise-client/lib/client.js.map',
      '../../packages/client/ui-enterprise-account/package.json': 'plugins/enterprise-account/package.json',
      '../../packages/client/ui-enterprise-account/lib/index.js': 'plugins/enterprise-account/lib/index.js',
      '../../packages/client/ui-enterprise-account/lib/client.js': 'plugins/enterprise-account/lib/client.js',
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  // Closing the only window hides the UI but leaves the authenticated local
  // Agent running. The explicit Enterprise menu action performs an orderly
  // application quit when the user wants to stop background work.
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig
