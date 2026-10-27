/** Registered sidebar contribution; all episode commands run in the owning editor. */
import { createElement, useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
export const storyRailMessages={
  zh:{ 'story.bindSource':'绑定剧本版本','story.episodes':'分集','story.create':'新建分集','story.rename':'改名','story.delete':'删除剧本','story.empty':'还没有分集','story.number':'第 {number} 集' },
  en:{ 'story.bindSource':'Bind script version','story.episodes':'Episodes','story.create':'New episode','story.rename':'Rename','story.delete':'Delete script','story.empty':'No episodes yet','story.number':'Episode {number}' },
}
export type StoryRailKey = keyof typeof storyRailMessages.en
export const storyStateSchema=z.strictObject({ type:z.literal('arivo:story-state'),version:z.literal(1),id:z.uuid(),
  projectId:z.uuid(),editor:z.enum(['script','storyboard']),selected:z.uuid().optional(),busy:z.boolean(),
  episodes:z.array(z.strictObject({ id:z.uuid(),title:z.string().min(1).max(255),number:z.number().int().min(1).max(500) })).max(500) })
type StoryState=z.infer<typeof storyStateSchema>
type Action='create'|'open'|'rename'|'delete'|'bindSource'
type Entry={ state:StoryState;run:(action:Action,episodeId?:string)=>void }
/** One active script panel publishes metadata for the sidebar registration lifetime. */
export class StoryRailStore {
  private current:Entry|undefined
  private listeners=new Set<()=>void>()
  readonly snapshot=()=>this.current
  readonly subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  /** Bind a loaded, verified-origin frame. Disposal cannot clear a newer panel. */
  bind(frame:HTMLIFrameElement,origin:string,projectId:string):()=>void {
    // The native shell is served only on the authenticated IPv4 loopback origin.
    // eslint-disable-next-line no-restricted-properties
    const id=crypto.randomUUID()
    let entry:Entry|undefined
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.contentWindow||event.origin!==origin)return
      if(z.strictObject({ type:z.literal('arivo:story-ready'),version:z.literal(1) }).safeParse(event.data).success){frame.contentWindow?.postMessage({ type:'arivo:story-connect',version:1,id },origin);return}
      const parsed=storyStateSchema.safeParse(event.data)
      if(!parsed.success||parsed.data.id!==id||parsed.data.projectId!==projectId)return
      entry={ state:parsed.data,run:(action,episodeId)=>{
        if(this.current!==entry||entry?.state.busy)return
        frame.contentWindow?.postMessage({ type:'arivo:story-action',version:1,id,action,...(episodeId?{ episodeId }:{}) },origin)
      } }
      this.current=entry;this.emit()
    }
    window.addEventListener('message',receive)
    frame.contentWindow?.postMessage({ type:'arivo:story-connect',version:1,id },origin)
    return()=>{window.removeEventListener('message',receive);if(this.current===entry){this.current=undefined;this.emit()}}
  }
  private emit(){for(const listener of this.listeners)listener()}
}
/** Render only while a loaded script editor is contributing to the workspace sidebar. */
export function StoryRail({ store,wide,t }:{ store:StoryRailStore;wide:boolean }&PropsLocale<'arivo.shell'>){
  const entry=useSyncExternalStore(store.subscribe,store.snapshot)
  if(!wide||!entry)return null
  const { state,run }=entry
  const episodes=state.episodes.map((episode)=>{
    const actions=(['rename','delete'] as const).map(action=>createElement('button',{
      key:action,type:'button',disabled:state.busy,'aria-label':`${t(`story.${action}`)} ${episode.title}`,
      onClick:()=>{ run(action,episode.id) },
    },t(`story.${action}`)))
    return createElement('article',{ key:episode.id },
      createElement('button',{ type:'button',className:'arivo-story-episode',disabled:state.busy,
        'aria-current':episode.id===state.selected?'page':undefined,onClick:()=>{ run('open',episode.id) } },
      createElement('span',null,episode.title),createElement('small',null,t('story.number',{ number:episode.number }))),
      createElement('div',{ className:'arivo-story-episode-actions' },...actions))
  })
  return createElement('section',{ className:'arivo-story-rail','aria-label':t('story.episodes'),'data-project':state.projectId },
    createElement('header',null,createElement('h2',null,t('story.episodes')),createElement('span',null,state.episodes.length),
      createElement('button',{ type:'button',disabled:state.busy,'aria-label':t('story.create'),title:t('story.create'),onClick:()=>{ run('create') } },'+')),
    state.editor==='storyboard'&&state.selected?createElement('button',{ type:'button',disabled:state.busy,onClick:()=>{run('bindSource',state.selected)} },t('story.bindSource')):null,
    createElement('div',{ className:'arivo-story-rail-list' },episodes.length?episodes:createElement('p',null,t('story.empty'))))
}
