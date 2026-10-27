/** Exact-origin/frame metadata bridge and registration teardown. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { test } from 'node:test'
import { CanvasRailStore } from '../src/distribution/arivo-shell/client/canvas-rail.ts'
void test('canvas rail validates frame, nonce and metadata, routes actions, and clears on disposal',()=>{
  const target=new EventTarget(),prior=globalThis.window
  Object.assign(globalThis,{ window:target })
  try{
    const sent:{ value:unknown;origin:string }[]=[]
    const source={ postMessage:(value:unknown,origin:string)=>sent.push({ value,origin }) }
    const frame={ contentWindow:source } as unknown as HTMLIFrameElement
    const store=new CanvasRailStore(),origin='http://127.0.0.1:1234'
    let notifications=0;const unsubscribe=store.subscribe(()=>notifications++)
    const projectId=randomUUID()
    const dispose=store.bind(frame,origin,projectId),id=z.object({ id:z.uuid() }).parse(sent[0]!.value).id
    const state={ type:'arivo:canvas-state',version:1,id,projectId,busy:false,
      canvases:[{ id:randomUUID(),title:'灯塔来信' }] }
    const deliver=(data:unknown,from:unknown=source,sender=origin)=>{const event=new Event('message');Object.assign(event,{ data,source:from,origin:sender });target.dispatchEvent(event)}
    deliver(state,{},origin);deliver(state,source,'http://evil.example');deliver({ ...state,id:randomUUID() });deliver({ ...state,unexpected:true });deliver({ ...state,projectId:randomUUID() })
    assert.equal(store.snapshot(),undefined)
    deliver({ type:'arivo:canvas-ready',version:1 });assert.equal(sent.length,2)
    deliver(state);assert.equal(store.snapshot()!.state.canvases[0]!.title,'灯塔来信')
    store.snapshot()!.run('open',state.canvases[0]!.id)
    assert.deepEqual(sent.at(-1),{ value:{ type:'arivo:canvas-action',version:1,id,action:'open',canvasId:state.canvases[0]!.id },origin })
    for(const action of ['rename','delete'] as const){store.snapshot()!.run(action,state.canvases[0]!.id);assert.equal(z.object({ action:z.string() }).parse(sent.at(-1)!.value).action,action);const count=sent.length;store.snapshot()!.run(action,randomUUID());assert.equal(sent.length,count)}
    const beforeUnknown=sent.length;store.snapshot()!.run('open',randomUUID());assert.equal(sent.length,beforeUnknown)
    const old=store.snapshot()!
    deliver({ ...state,busy:true });const count=sent.length
    store.snapshot()!.run('open',state.canvases[0]!.id);old.run('create');assert.equal(sent.length,count)
    const newDispose=store.bind(frame,origin,projectId)
    const nextId=z.object({ id:z.uuid() }).parse(sent.at(-1)!.value).id
    deliver({ ...state,id:nextId });const next=store.snapshot()!
    deliver(state);assert.equal(store.snapshot(),next)
    dispose();assert.equal(store.snapshot(),next)
    old.run('create');assert.equal(store.snapshot(),next)
    newDispose();assert.equal(store.snapshot(),undefined)
    const observed=notifications;deliver(state);assert.equal(notifications,observed);unsubscribe()
  }finally{Object.assign(globalThis,{ window:prior })}
})
