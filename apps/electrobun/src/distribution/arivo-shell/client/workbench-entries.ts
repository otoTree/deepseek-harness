/** Direct creative panels use the current 32px Arivo icon system and Session project routing. */
import { createElement, useEffect } from 'react'
import type { PropsLocale, PropsRuntime, SlotIcon, SlotIconProps } from '@deepseek-ai/dsh-client-ui-slots'

/** Closed initial views supported by the separately built creative plugin. */
export const creativeViews = ['generation', 'script', 'settings', 'storyboard', 'canvas', 'assets'] as const
/** One project editor selected from Workbench Start. */
export type CreativeView = typeof creativeViews[number]
/** Typed localized creative panel labels and descriptions. */
export type CreativeKey = `creative.${CreativeView}` | `creative.${CreativeView}.description`
/** Localized Start-card copy owned by the startup shell. */
export const creativeMessages = {
  en: {
    'creative.generation': 'Generation', 'creative.generation.description': 'Generate images and videos.',
    'creative.script': 'Script', 'creative.script.description': 'Write episodes and save script versions.',
    'creative.settings': 'Story bible', 'creative.settings.description': 'Organize characters, scenes and props.',
    'creative.storyboard': 'Storyboard', 'creative.storyboard.description': 'Plan shots and their production.',
    'creative.canvas': 'Canvas', 'creative.canvas.description': 'Connect nodes and arrange your creative workflow.',
    'creative.assets': 'Asset library', 'creative.assets.description': 'Browse and manage project assets.',
  },
  zh: {
    'creative.generation': '通用生成', 'creative.generation.description': '生成图片与视频。',
    'creative.script': '剧本', 'creative.script.description': '编写分集正文，保存剧本版本。',
    'creative.settings': '设定集', 'creative.settings.description': '整理角色、场景与道具。',
    'creative.storyboard': '分镜', 'creative.storyboard.description': '规划镜头与制作内容。',
    'creative.canvas': '画布', 'creative.canvas.description': '连接节点，编排创作流程。',
    'creative.assets': '资产库', 'creative.assets.description': '浏览和管理当前项目素材。',
  },
} satisfies Record<'en' | 'zh', Record<CreativeKey, string>>

const paths: Record<CreativeView, string> = {
  generation: 'M16 5 18.6 13.4 27 16 18.6 18.6 16 27 13.4 18.6 5 16 13.4 13.4Z',
  script: 'M9 5H19L23 9V27H9Z M19 5V9H23 M12 14.5H20 M12 18.5H20 M12 22.5H17',
  settings: 'M16 5 24.5 10.2V21.8L16 27 7.5 21.8V10.2Z',
  storyboard: 'M8 14H24Q25.5 14 25.5 15.5V24.5Q25.5 26 24 26H8Q6.5 26 6.5 24.5V15.5Q6.5 14 8 14Z M6.5 14 8 8H25.5L24 14 M11.5 8.3 10 13.7 M16.5 8.3 15 13.7 M21.5 8.3 20 13.7',
  canvas: 'M8 13V8H13 M19 8H24V13 M24 19V24H19 M13 24H8V19',
  assets: 'M9 7H18Q20 7 20 9V18Q20 20 18 20H9Q7 20 7 18V9Q7 7 9 7Z M14 12H23Q25 12 25 14V23Q25 25 23 25H14Q12 25 12 23V14Q12 12 14 12Z',
}
function CreativeIcon({ view, size = 20, className }: SlotIconProps & { view: CreativeView }) {
  return createElement('svg', { width: size, height: size, className, viewBox: '0 0 32 32', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, 'data-creative-icon': view },
    createElement('path', { d: paths[view], ...(view === 'generation' ? { fill: 'currentColor', stroke: 'none' } : {}) }),
    view === 'generation' ? createElement('path', { d: 'M24 5 24.8 7.6 27.4 8.4 24.8 9.2 24 11.8 23.2 9.2 20.6 8.4 23.2 7.6Z', fill: 'currentColor', fillOpacity: 0.5, stroke: 'none' }) : null,
    view === 'settings' ? createElement('circle', { cx: 16, cy: 16, r: 2, fill: 'currentColor', stroke: 'none' }) : null)
}
function icon(view: CreativeView): SlotIcon { return props => createElement(CreativeIcon, { ...props, view }) }
const icons: Record<CreativeView, SlotIcon> = {
  generation: icon('generation'), script: icon('script'), settings: icon('settings'),
  storyboard: icon('storyboard'), canvas: icon('canvas'), assets: icon('assets'),
}

/** Publish a Start card for the contribution lifetime without opening a tab.
 * @param props - Session-scoped Workbench registration callbacks, locale and creative view.
 * @returns The matching optional tab-menu launcher.
 */
export function CreativeLauncher({ view, registerPanel, setActiveTab, sessionId, t }: PropsRuntime<'workbench.tabs'> & PropsLocale<'arivo.shell'> & { view: CreativeView }) {
  const key = `arivo.creative.${view}`
  const label = t(`creative.${view}`)
  const description = t(`creative.${view}.description`)
  useEffect(() => registerPanel({
    id: key, key, label, description, icon: icons[view], closable: true, order: 50 + creativeViews.indexOf(view),
  }), [registerPanel, key, label, description, view])
  return createElement('button', { type: 'button', className: 'arivo-workbench-creative', disabled: sessionId === undefined, onClick: () => { setActiveTab(key) } }, createElement(CreativeIcon, { view, size: 20 }), label)
}
