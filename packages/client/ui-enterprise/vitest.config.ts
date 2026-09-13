import { resolve } from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../vitest.shared.ts'

/** Isolated jsdom configuration for the enterprise Web client component tests. */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../../tsconfig.base.json'] }), standardDecoratorPlugin()],
  resolve: {
    // The enterprise admin workspace installs React 19. Keep the test
    // renderer and all JSX imports on that single instance to avoid React
    // element identity errors from mixed workspace peer resolutions.
    alias: [
      { find: /^react$/, replacement: resolve('../../node_modules/.pnpm/react@19.2.8/node_modules/react') },
      { find: /^react\/(.*)$/, replacement: resolve('../../node_modules/.pnpm/react@19.2.8/node_modules/react/$1') },
      { find: /^react-dom$/, replacement: resolve('../../node_modules/.pnpm/react-dom@19.2.8_react@19.2.8/node_modules/react-dom') },
      { find: /^react-dom\/(.*)$/, replacement: resolve('../../node_modules/.pnpm/react-dom@19.2.8_react@19.2.8/node_modules/react-dom/$1') },
    ],
  },
  test: {
    name: 'enterprise-client',
    environment: 'jsdom',
    execArgv: vitestExecArgv,
    include: ['tests/**/*.spec.tsx'],
    setupFiles: ['../../../scripts/test-proxy-environment.ts', '../../../scripts/test-invariants.ts'],
    server: {
      deps: {
        // Inline React and the renderer so Vite applies the aliases above
        // before @testing-library/react is evaluated. Externalized React 19
        // from the repository root would create a second element identity.
        inline: ['react', 'react-dom', '@testing-library/react'],
      },
    },
  },
})
