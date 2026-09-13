/** Fail if the browser client reaches Node's module loader. */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the browser')
}

/** Type-only peer for the vendored loader. */
export type LoadHookContext = never
