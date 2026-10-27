/** Exact-origin/frame metadata bridge and registration teardown. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { test } from 'node:test'
import { StoryRailStore } from '../src/distribution/arivo-shell/client/story-rail.ts'
void test('story rail validates frame, nonce and metadata, routes actions, and clears on disposal',()=>{
  const target=new EventTarget(),prior=globalThis.window
  Object.assign(globalThis,{ window:target })
  try{
    const sent:{ value:unknown;origin:string }[]=[]
    const source={ postMessage:(value:unknown,origin:string)=>sent.push({ value,origin }) }
    const frame={ contentWindow:source } as unknown as HTMLIFrameElement
    const store=new StoryRailStore(),origin='http://127.0.0.1:1234'
    let notifications=0;const unsubscribe=store.subscribe(()=>notifications++)
    const projectId=randomUUID()
    const dispose=store.bind(frame,origin,projectId),id=z.object({ id:z.uuid() }).parse(sent[0]!.value).id
    const state={ type:'arivo:story-state',version:1,id,projectId,editor:'script',busy:false,
      episodes:[{ id:randomUUID(),title:'灯塔来信',number:1 }] }
    const deliver=(data:unknown,from:unknown=source,sender=origin)=>{const event=new Event('message');Object.assign(event,{ data,source:from,origin:sender });target.dispatchEvent(event)}
    deliver(state,{},origin);deliver(state,source,'http://evil.example');deliver({ ...state,id:randomUUID() });deliver({ ...state,unexpected:true });deliver({ ...state,projectId:randomUUID() })
    assert.equal(store.snapshot(),undefined)
    deliver({ type:'arivo:story-ready',version:1 });assert.equal(sent.length,2)
    deliver(state);assert.equal(store.snapshot()!.state.episodes[0]!.title,'灯塔来信')
    store.snapshot()!.run('rename',state.episodes[0]!.id)
    assert.deepEqual(sent.at(-1),{ value:{ type:'arivo:story-action',version:1,id,action:'rename',episodeId:state.episodes[0]!.id },origin })
    const old=store.snapshot()!
    deliver({ ...state,busy:true });const count=sent.length
    store.snapshot()!.run('delete',state.episodes[0]!.id);old.run('create');assert.equal(sent.length,count)
    dispose();assert.equal(store.snapshot(),undefined)
    const observed=notifications;deliver(state);assert.equal(notifications,observed);unsubscribe()
  }finally{Object.assign(globalThis,{ window:prior })}
})
