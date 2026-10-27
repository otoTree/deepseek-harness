/** Arivo model and billing-project controls inside the original OS Settings slot. */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { ModelChoice } from './model-choice.ts'
import type { ArivoModelRequest, ArivoModelResponse } from '../model-protocol.ts'

/** Locale-owned copy for model controls. */
export const modelMessages = {
  en: {
    modelsTitle: 'Arivo models', modelsDescription: 'Choose the project that pays for new conversations, then select a language model.',
    modelsExisting: 'Existing conversations keep their own model and billing project. Use the conversation model menu to change them.',
    modelsWorkspace: 'Workspace', modelsProject: 'Billing project', modelsModel: 'Language model', modelsChoose: 'Choose…',
    modelsMore: 'Load more', modelsSave: 'Set default model', modelsSaved: 'Default model saved.', modelsConfigured: 'An Arivo default model is configured.',
    modelsNotConfigured: 'Choose a project and model to start using Arivo in Agent conversations.',
    modelsLoading: 'Loading model options…', modelsFailed: 'Could not load model options. Check your Arivo account connection and retry.',
    modelsEmpty: 'No available options in this page.', modelsRetry: 'Retry',
  },
  zh: {
    modelsTitle: 'Arivo 模型', modelsDescription: '选择为新对话付费的项目，再选择语言模型。',
    modelsExisting: '已有对话保留各自的模型和计费项目。可在对话的模型菜单中修改。',
    modelsWorkspace: '工作空间', modelsProject: '计费项目', modelsModel: '语言模型', modelsChoose: '请选择…',
    modelsMore: '加载更多', modelsSave: '设为默认模型', modelsSaved: '默认模型已保存。', modelsConfigured: '已配置 Arivo 默认模型。',
    modelsNotConfigured: '选择项目和模型，即可在 Agent 对话中使用 Arivo。',
    modelsLoading: '正在加载模型选项…', modelsFailed: '暂时无法加载模型选项。请检查 Arivo 账号连接后重试。',
    modelsEmpty: '本页没有可用选项。', modelsRetry: '重试',
  },
}
/** Keys added to the startup plugin's typed locale dictionary. */
export type ModelSettingsKey = keyof typeof modelMessages.en
/** Local catalog transport owned by the OS connection service. */
export interface ModelSettingsProps {
  t: (key: ModelSettingsKey) => string
  request: (input: ArivoModelRequest, signal: AbortSignal) => Promise<ArivoModelResponse>
}
type Page = Extract<ArivoModelResponse, { type: 'workspaces' }>
type Choice = Page['items'][number]
const live = (signal: AbortSignal): boolean => !signal.aborted
const empty = (): Page => ({ type: 'workspaces', items: [], nextCursor: null })

/** Render account-authorized choices and save through the original OS default-model owner.
 * @param props - Localized copy and authenticated, abortable transport.
 * @returns Product controls with explicit loading, failure, empty and saved states.
 */
export function ModelSettings({ t, request }: ModelSettingsProps) {
  const owner = useRef<AbortController | null>(null)
  const [workspaces, setWorkspaces] = useState(empty), [projects, setProjects] = useState(empty), [models, setModels] = useState(empty)
  const [workspace, setWorkspace] = useState<Choice | null>(null), [project, setProject] = useState<Choice | null>(null)
  const [model, setModel] = useState<Choice | null>(null), [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(true), [status, setStatus] = useState<ModelSettingsKey | null>(null), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); owner.current = controller
    setBusy(true); setStatus('modelsLoading'); setWorkspace(null); setProject(null); setModel(null)
    setWorkspaces(empty()); setProjects(empty()); setModels(empty())
    void Promise.all([request({ version: 1, type: 'state' }, controller.signal), request({ version: 1, type: 'workspaces' }, controller.signal)])
      .then(([state, page]) => {
        if (controller.signal.aborted) return
        if (state.type !== 'state' || page.type !== 'workspaces') throw new Error('Invalid model controls response')
        setConfigured(state.configured); setWorkspaces(page); setStatus(null)
      }).catch(() => { if (!controller.signal.aborted) setStatus('modelsFailed') })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort(); owner.current = null }
  }, [request, attempt])
  async function run(task: (signal: AbortSignal) => Promise<void | ModelSettingsKey>) {
    const signal = owner.current?.signal
    if (!signal || !live(signal) || busy) return
    setBusy(true); setStatus('modelsLoading')
    try { const next = await task(signal); if (live(signal)) setStatus(next ?? null) }
    catch { if (live(signal)) setStatus('modelsFailed') }
    finally { if (live(signal)) setBusy(false) }
  }
  async function page(input: ArivoModelRequest, signal: AbortSignal, old = empty()): Promise<Page> {
    const response = await request(input, signal)
    signal.throwIfAborted()
    if (response.type === 'state' || response.type !== input.type || (old.nextCursor && response.nextCursor === old.nextCursor)) {
      throw new Error('Invalid model page')
    }
    return { type: 'workspaces', items: [...new Map([...old.items, ...response.items].map(item => [item.id, item])).values()],
      nextCursor: response.nextCursor }
  }
  function field(label: ModelSettingsKey, choices: Page, selected: Choice | null, enabled: boolean,
    change: (item: Choice | null) => void, more: () => void) {
    return h('label', { className: 'arivo-model-field' }, h('span', null, t(label)),
      h(ModelChoice, { label: t(label), placeholder: t('modelsChoose'), items: choices.items, value: selected?.id ?? '', disabled: busy || !enabled,
        onChange: (id: string) => { change(choices.items.find(item => item.id === id) ?? null) } }),
      enabled && !busy && !choices.items.length ? h('span', { className: 'arivo-model-hint' }, t('modelsEmpty')) : null,
      choices.nextCursor ? h('button', { type: 'button', disabled: busy, onClick: more }, t('modelsMore')) : null)
  }
  return h('section', { className: 'arivo-model-settings', 'aria-busy': busy }, h('h2', null, t('modelsTitle')),
    h('p', null, t('modelsDescription')), h('p', { className: 'arivo-model-hint' }, t('modelsExisting')),
    h('p', { role: 'status' }, t(status ?? (configured ? 'modelsConfigured' : 'modelsNotConfigured'))),
    field('modelsWorkspace', workspaces, workspace, true, (item) => {
      setWorkspace(item); setProject(null); setModel(null); setProjects(empty()); setModels(empty())
      if (item) void run(async (signal) => { setProjects(await page({ version: 1, type: 'projects', cloudWorkspaceId: item.id }, signal)) })
    }, () => { void run(async (signal) => { setWorkspaces(await page({ version: 1, type: 'workspaces', cursor: workspaces.nextCursor ?? undefined }, signal, workspaces)) }) }),
    field('modelsProject', projects, project, workspace !== null, (item) => {
      setProject(item); setModel(null); setModels(empty())
      if (workspace && item) void run(async (signal) => { setModels(await page({ version: 1, type: 'models', cloudWorkspaceId: workspace.id, cloudProjectId: item.id }, signal)) })
    }, () => { if (workspace) void run(async (signal) => { setProjects(await page({ version: 1, type: 'projects', cloudWorkspaceId: workspace.id, cursor: projects.nextCursor ?? undefined }, signal, projects)) }) }),
    field('modelsModel', models, model, project !== null, setModel,
      () => { if (workspace && project) void run(async (signal) => { setModels(await page({ version: 1, type: 'models', cloudWorkspaceId: workspace.id, cloudProjectId: project.id, cursor: models.nextCursor ?? undefined }, signal, models)) }) }),
    h('button', { type: 'button', className: 'arivo-model-save arivo-control-button', 'data-variant': 'primary', disabled: busy || !workspace || !project || !model,
      onClick: () => { if (workspace && project && model) void run(async (signal) => {
        const result = await request({ version: 1, type: 'select', cloudWorkspaceId: workspace.id, cloudProjectId: project.id, adapterId: model.id }, signal)
        if (result.type !== 'state' || !result.configured) throw new Error('Invalid selection result')
        if (live(signal)) setConfigured(true)
        return 'modelsSaved' as const
      }) } }, t('modelsSave')),
    status === 'modelsFailed' ? h('button', { type: 'button', disabled: busy, onClick: () => { setAttempt(value => value + 1) } }, t('modelsRetry')) : null)
}
