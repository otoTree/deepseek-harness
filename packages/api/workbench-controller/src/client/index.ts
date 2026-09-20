import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from './remote.ts'
import type { WorkbenchRemoteNamespace } from './remote.ts'

export type { WorkbenchRemote } from './remote.ts'
export type { WorkbenchRemoteNamespace }
export const inject = ['remote', 'remote.workbench']

declare module '@deepseek-ai/cordis' { interface Context { workbench: WorkbenchRemoteNamespace } }

/** Mount the generated Workbench Remote namespace for Client consumers. */
export function apply(ctx: Context): void { ctx.reflect.provide('workbench', ctx.remote.workbench) }
