import { isBuiltin } from 'node:module'
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-enterprise-client', ['lib/types/index.js'], {
  hostPhase: true,
  lib: {
    deps: {
      neverBundle: isBuiltin,
      alwaysBundle: specifier => !isBuiltin(specifier),
    },
  },
})
