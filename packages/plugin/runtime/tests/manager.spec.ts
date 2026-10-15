/** Loader composition cancellation with import and apply suspended at explicit barriers. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import { bindPluginSdk, CordisPluginManager } from '../src/index.ts'

for (const phase of ['import', 'apply'] as const) {
  void test(`removing a product during ${phase} owns the suspended child and prevents late contributions`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'market-loader-'))
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(home).href + '/'
    t.after(async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    await writeFile(join(home, 'gate.mjs'), `
      export let enter, release;
      export const started = new Promise(resolve => {enter = resolve});
      export const pending = new Promise(resolve => {release = resolve});
      export const contributions = new Set();
    `)
    const gate = await import(pathToFileURL(join(home, 'gate.mjs')).href) as {
      started: Promise<void>
      pending: Promise<void>
      release: () => void
      contributions: Set<string>
    }
    t.after(gate.release)
    await writeFile(join(home, 'provider.mjs'), 'export function apply(ctx, config) {ctx.provide("pluginSdk", config.sdk)}')
    await writeFile(join(home, 'target.mjs'), `
      import {enter, pending, contributions} from './gate.mjs';
      ${phase === 'import' ? 'enter(); await pending;' : ''}
      export async function apply(ctx) {
        ${phase === 'apply' ? 'enter(); await pending;' : ''}
        ctx.effect(() => {contributions.add('owned'); return () => contributions.delete('owned')});
      }
    `)
    const bound = bindPluginSdk({ call:async<T>() => ({}) as T, stream:async function*<T>() {yield {} as T} })
    const manager = new CordisPluginManager(ctx)
    const controller = new AbortController()
    const loading = manager.load('installed', [{ url:pathToFileURL(join(home, 'target.mjs')).href }],
      pathToFileURL(join(home, 'provider.mjs')).href, bound.sdk, controller.signal)
    const rejection = assert.rejects(loading, /cancelled/)
    await gate.started
    controller.abort(new Error('cancelled'))
    const removal = manager.remove('installed')
    gate.release()
    await rejection
    await removal
    assert.deepEqual([...ctx.loader.entries()], [])
    assert.deepEqual([...gate.contributions], [])
  })
}
