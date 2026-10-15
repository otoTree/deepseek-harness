import { isBuiltin } from 'node:module'
import { clientBundle } from '../tsdown.client.ts'

const sharedHostModule = (specifier: string): boolean => isBuiltin(specifier)
  || specifier === '@deepseek-ai/cordis' || specifier === '@deepseek-ai/dsh-mcp-client'

export default clientBundle('@deepseek-ai/dsh-enterprise-client', ['lib/types/index.js'], {
  hostPhase: true,
  lib: {
    deps: {
      neverBundle: sharedHostModule,
      alwaysBundle: specifier => !sharedHostModule(specifier),
    },
  },
})
