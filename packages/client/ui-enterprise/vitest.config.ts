import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../vitest.shared.ts'

/** Isolated jsdom configuration for the enterprise Web client component tests. */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../../tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    name: 'enterprise-client',
    environment: 'jsdom',
    execArgv: vitestExecArgv,
    include: ['tests/**/*.spec.tsx'],
    setupFiles: ['../../../scripts/test-proxy-environment.ts', '../../../scripts/test-invariants.ts'],
  },
})
