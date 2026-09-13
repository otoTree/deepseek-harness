import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  root: source('./frontend'),
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: source('./build/frontend'),
    emptyOutDir: true,
    rollupOptions: { input: { agent: source('./frontend/index.html'), account: source('./frontend/account.html') } },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^node:module$/, replacement: source('./frontend/src/node-module-stub.ts') },
      // The account surface is a Vite entry and is built before package lib artifacts.
      // Resolve its source face here; runtime enterprise plugins still use lib/client.js.
      {
        find: '@deepseek-ai/dsh-client-ui-enterprise-account/client',
        replacement: source('../../packages/client/ui-enterprise-account/src/client/account.tsx'),
      },
    ],
  },
  define: {
    ...clientBuildEnvironmentDefines(process.env),
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
