/* oxlint-disable @stylistic/max-len -- Shared trigger forms retain the original compact field layout. */
/** Shared trigger editor and product-owned RPC composition. */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable, PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainSurface } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Select, Button, Modal, IconAlarmClockOutline16, IconCloseOutline16, IconPlayOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { z } from 'zod'
import { triggerSnapshot, triggerRule, triggerRuleSaveInput, driveSpaces, type TriggerSnapshot, type TriggerRule, type TriggerRuleSaveInput, type DriveSpaces } from '../wire.ts'
import type { EnterpriseLocaleKey } from './locales.ts'
export interface TriggerInjected {
  newSessionPreset?: string
  cloudFiles?: boolean
  loadTriggers: () => Promise<TriggerSnapshot>
  saveTrigger: (input: TriggerRuleSaveInput) => Promise<TriggerRule>
  setTriggerEnabled: (ruleId: string, enabled: boolean) => Promise<TriggerRule>
  removeTrigger: (ruleId: string) => Promise<void>
  retryTrigger: (batchId: string) => Promise<void>
  testTriggerMatch: (path: string, includes: string[], excludes: string[]) => Promise<boolean>
  loadSpaces: () => Promise<DriveSpaces>
  openSession: (sessionId: string) => Promise<void>
}
export type TriggerProps = PropsRuntime<'main.surface'> & PropsLocale<'enterprise'> & InjectFace<TriggerInjected> & {
  useSessions: UseSessions
}

interface TriggerDraft {
  readonly id?: string
  readonly name: string
  readonly enabled: boolean
  readonly sourceKind: 'timer' | 'local-file' | 'cloud-file'
  readonly timerKind: 'at' | 'every'
  readonly timerAt: string
  readonly everySeconds: string
  readonly roots: string
  readonly spaceId: string
  readonly includes: string
  readonly excludes: string
  readonly maxDepth: string
  readonly stabilityMs: string
  readonly maxEventsPerMinute: string
  readonly windowMs: string
  readonly targetKind: 'existing-session' | 'new-session'
  readonly sessionId: string
  readonly workspacePath: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly titleTemplate: string
  readonly instruction: string
  readonly templateVersion: number
}

function localDateTime(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function freshTriggerDraft(prompt: string, agentPreset = 'default'): TriggerDraft {
  return {
    name: '', enabled: true, sourceKind: 'timer', timerKind: 'every',
    timerAt: localDateTime(new Date(Date.now() + 3_600_000).toISOString()), everySeconds: '3600',
    roots: '', spaceId: '', includes: '**/*', excludes: '', maxDepth: '20',
    stabilityMs: '500', maxEventsPerMinute: '1000', windowMs: '1000',
    targetKind: 'existing-session', sessionId: '', workspacePath: '', agentPreset,
    permissionPreset: 'workspace-write', titleTemplate: '{{rule.name}}',
    instruction: prompt,
    templateVersion: 1,
  }
}

function draftFromRule(rule: TriggerRule): TriggerDraft {
  const file = rule.source.kind === 'timer' ? undefined : rule.source
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    sourceKind: rule.source.kind,
    timerKind: rule.source.kind === 'timer' ? rule.source.schedule.kind : 'every',
    timerAt: rule.source.kind === 'timer'
      ? localDateTime(rule.source.schedule.kind === 'at' ? rule.source.schedule.at : rule.source.schedule.anchorAt)
      : localDateTime(new Date(Date.now() + 3_600_000).toISOString()),
    everySeconds: rule.source.kind === 'timer' && rule.source.schedule.kind === 'every'
      ? String(rule.source.schedule.everySeconds)
      : '3600',
    roots: rule.source.kind === 'local-file' ? rule.source.roots.join('\n') : '',
    spaceId: rule.source.kind === 'cloud-file' ? rule.source.spaceId : '',
    includes: file?.filter.includes.join('\n') ?? '**/*',
    excludes: file?.filter.excludes.join('\n') ?? '',
    maxDepth: String(file?.filter.maxDepth ?? 20),
    stabilityMs: rule.source.kind === 'local-file' ? String(rule.source.stabilityMs) : '500',
    maxEventsPerMinute: rule.source.kind === 'local-file' ? String(rule.source.maxEventsPerMinute) : '1000',
    windowMs: rule.delivery.kind === 'batch-window' ? String(rule.delivery.windowMs) : '1000',
    targetKind: rule.target.kind,
    sessionId: rule.target.kind === 'existing-session' ? rule.target.sessionId : '',
    workspacePath: rule.target.kind === 'new-session' ? rule.target.workspacePath : '',
    agentPreset: rule.target.kind === 'new-session' ? rule.target.agentPreset : 'default',
    permissionPreset: rule.target.kind === 'new-session' ? rule.target.permissionPreset : 'workspace-write',
    titleTemplate: rule.target.kind === 'new-session' ? rule.target.titleTemplate : '{{rule.name}}',
    instruction: rule.instructionTemplate.text,
    templateVersion: rule.instructionTemplate.version + 1,
  }
}

function splitTriggerLines(value: string): string[] {
  return value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean)
}

export function TriggerSurface({
  loadTriggers, saveTrigger, setTriggerEnabled, removeTrigger, retryTrigger, testTriggerMatch,
  loadSpaces, openSession, useSessions, cloudFiles = true, newSessionPreset, t,
}: TriggerProps): ReactNode {
  const sessions = useSessions(value => value)
  const [snapshot, setSnapshot] = useState<TriggerSnapshot>()
  const [spaces, setSpaces] = useState<DriveSpaces>([])
  const [draft, setDraft] = useState<TriggerDraft>(() => freshTriggerDraft(t('triggerDefaultPrompt'), newSessionPreset))
  const [editorOpen, setEditorOpen] = useState(false)
  const [runView, setRunView] = useState<'queue' | 'history'>('queue')
  const [sourceFilter, setSourceFilter] = useState<'all' | TriggerRule['source']['kind']>('all')
  const runSection = useRef<HTMLElement | null>(null)
  const queueTabRef = useRef<HTMLButtonElement | null>(null)
  const historyTabRef = useRef<HTMLButtonElement | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [surfaceError, setSurfaceError] = useState(false)
  const [editorError, setEditorError] = useState(false)
  const [matchPath, setMatchPath] = useState('')
  const [matchResult, setMatchResult] = useState<boolean>()
  const reload = (): void => {
    setState('loading')
    void Promise.all([loadTriggers(), loadSpaces().catch(() => [] as DriveSpaces)]).then(([next, nextSpaces]) => {
      setSnapshot(next); setSpaces(nextSpaces); setState('ready')
    }, () => { setState('error') })
  }
  useEffect(() => { reload() }, [])
  const patchDraft = <K extends keyof TriggerDraft>(key: K, value: TriggerDraft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }))
  }
  const buildInput = (): TriggerRuleSaveInput => {
    const includes = splitTriggerLines(draft.includes)
    const excludes = splitTriggerLines(draft.excludes)
    const filter = { includes, excludes, maxDepth: Number(draft.maxDepth) }
    const source = draft.sourceKind === 'timer'
      ? { kind: 'timer' as const, schedule: draft.timerKind === 'at'
        ? { kind: 'at' as const, at: new Date(draft.timerAt).toISOString() }
        : { kind: 'every' as const, everySeconds: Number(draft.everySeconds), anchorAt: new Date(draft.timerAt).toISOString() } }
      : draft.sourceKind === 'local-file'
        ? { kind: 'local-file' as const, roots: splitTriggerLines(draft.roots), filter, stabilityMs: Number(draft.stabilityMs), maxEventsPerMinute: Number(draft.maxEventsPerMinute) }
        : { kind: 'cloud-file' as const, spaceId: draft.spaceId, filter }
    const fallbackSession = sessions.current ?? sessions.ids[0]
    const target = draft.targetKind === 'existing-session'
      ? { kind: 'existing-session' as const, sessionId: draft.sessionId || fallbackSession || '' }
      : { kind: 'new-session' as const, workspacePath: draft.workspacePath, agentPreset: draft.agentPreset, permissionPreset: draft.permissionPreset, titleTemplate: draft.titleTemplate }
    return triggerRuleSaveInput.parse({
      ...(draft.id === undefined ? {} : { id: draft.id }), name: draft.name, enabled: draft.enabled,
      source, delivery: draft.sourceKind === 'timer' ? { kind: 'queue-each' } : { kind: 'batch-window', windowMs: Number(draft.windowMs) },
      target, instructionTemplate: { version: draft.templateVersion, text: draft.instruction },
    })
  }
  const submit = (): void => {
    setEditorError(false)
    let input: TriggerRuleSaveInput
    try { input = buildInput() } catch { setEditorError(true); return }
    setBusy(true)
    void saveTrigger(input).then(() => {
      setEditorOpen(false); setDraft(freshTriggerDraft(t('triggerDefaultPrompt'), newSessionPreset)); reload()
    }, () => { setEditorError(true) }).finally(() => { setBusy(false) })
  }
  const mutate = (operation: () => Promise<unknown>): void => {
    setBusy(true); setSurfaceError(false)
    void operation().then(reload, () => { setSurfaceError(true) }).finally(() => { setBusy(false) })
  }
  const runMatch = (): void => {
    const includes = splitTriggerLines(draft.includes)
    const excludes = splitTriggerLines(draft.excludes)
    setBusy(true); setMatchResult(undefined)
    void testTriggerMatch(matchPath, includes, excludes).then(setMatchResult, () => { setEditorError(true) }).finally(() => { setBusy(false) })
  }
  const handleRunTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = runView === 'queue' ? 'history' : 'queue'
    setRunView(next)
    ;(next === 'queue' ? queueTabRef : historyTabRef).current?.focus()
  }
  if (state === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state === 'error' || snapshot === undefined) return <div className="dse-status dse-error">{t('triggerUnavailable')} <Button size="sm" onClick={reload}>{t('retry')}</Button></div>
  const providerFor = (ruleId: string) => snapshot.providers.find(item => item.ruleId === ruleId)
  const queued = snapshot.batches.filter(batch => batch.state === 'queued' || batch.state === 'delivering' || batch.state === 'processing')
  const history = snapshot.batches.filter(batch => !queued.includes(batch)).slice(-50).reverse()
  const sourceLabel = (rule: TriggerRule): string => t(rule.source.kind === 'timer' ? 'triggerTimer' : rule.source.kind === 'local-file' ? 'triggerLocalFiles' : 'triggerCloudFiles')
  const stateLabel = (value: TriggerSnapshot['batches'][number]['state']): string => t(`triggerBatch${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` as EnterpriseLocaleKey)
  const visibleRules = snapshot.rules.filter(rule => sourceFilter === 'all' || rule.source.kind === sourceFilter)
  return <main className="dse-triggers">
    <nav className="dse-feature-nav" aria-label={t('triggers')}>
      <div className="dse-feature-nav-title">{t('triggers')}</div>
      <button type="button" aria-current={sourceFilter === 'all' ? 'page' : undefined} onClick={() => { setSourceFilter('all') }}><IconAlarmClockOutline16 size={16} />{t('triggerAllRules')}</button>
      <button type="button" onClick={() => { setRunView('queue'); runSection.current?.scrollIntoView({ block: 'start' }) }}>{t('triggerQueue')}</button>
      <button type="button" onClick={() => { setRunView('history'); runSection.current?.scrollIntoView({ block: 'start' }) }}>{t('triggerHistory')}</button>
      <span className="dse-market-nav-label">{t('triggerSource')}</span>
      {(['timer', 'local-file', ...(cloudFiles ? ['cloud-file' as const] : [])] as const).map(kind => <button type="button" aria-current={sourceFilter === kind ? 'page' : undefined} key={kind} onClick={() => { setSourceFilter(kind) }}><IconAlarmClockOutline16 size={16} />{t(kind === 'timer' ? 'triggerTimer' : kind === 'local-file' ? 'triggerLocalFiles' : 'triggerCloudFiles')}</button>)}
    </nav>
    <div className="dse-feature-content">
      <div className="dse-page-breadcrumb" aria-hidden="true">{t('triggers')}</div>
      <header className="dse-trigger-header"><div><h2 className="dse-market-title">{t('triggers')}</h2><p className="dse-market-intro">{t(cloudFiles ? 'triggerIntro' : 'triggerLocalIntro')}</p></div><Button size="sm" onClick={() => { setDraft(freshTriggerDraft(t('triggerDefaultPrompt'), newSessionPreset)); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerNewRule')}</Button></header>
      {surfaceError ? <p className="dse-status dse-error" role="alert">{t('requestFailed')}</p> : null}
      <section className="dse-trigger-column" aria-label={t('triggerRules')}>
        <div className="dse-trigger-section-head"><h3>{t('triggerRules')}</h3><span>{visibleRules.length}</span></div>
        {visibleRules.length === 0 ? <div className="dse-trigger-empty"><span className="dse-trigger-empty-icon" aria-hidden="true"><IconAlarmClockOutline16 size={20} /></span><p>{t('triggerNoRules')}</p><Button size="sm" variant="outline" onClick={() => { setDraft(freshTriggerDraft(t('triggerDefaultPrompt'), newSessionPreset)); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerCreateFirstRule')}</Button></div> : <div className="dse-trigger-list"><table className="dse-trigger-table">
          <thead><tr><th scope="col">{t('triggerRuleName')}</th><th scope="col">{t('triggerSource')}</th><th scope="col">{t('triggerRuleState')}</th><th scope="col">{t('triggerRunState')}</th><th scope="col">{t('triggerActions')}</th></tr></thead>
          <tbody>{visibleRules.map((rule) => {
            const provider = providerFor(rule.id)
            return <tr key={rule.id}>
              <td><strong>{rule.name}</strong><span className="dse-row-note">{rule.target.kind === 'existing-session' ? `${t('triggerExistingSession')}: ${sessions.byId[rule.target.sessionId as SessionId]?.displayTitle ?? rule.target.sessionId}` : `${t('triggerNewSession')}: ${rule.target.workspacePath}`}</span></td>
              <td>{sourceLabel(rule)}<span className="dse-row-note">{t('versionShort')}{rule.version}</span></td>
              <td><span className="dse-tag" data-state={rule.enabled ? 'enabled' : 'disabled'}>{rule.enabled ? t('triggerEnabled') : t('triggerDisabled')}</span></td>
              <td><span className="dse-tag" data-state={provider?.state ?? 'idle'}>{provider?.state === 'watching' ? t('triggerListening') : provider?.state === 'failed' ? t('triggerListenerFailed') : provider?.state === 'missed' ? t('triggerMissed') : t('triggerNotListening')}</span>{provider?.message ? <span className="dse-row-note">{provider.message}</span> : null}</td>
              <td><div className="dse-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(draftFromRule(rule)); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerEdit')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { mutate(() => setTriggerEnabled(rule.id, !rule.enabled)) }}>{rule.enabled ? t('disablePlugin') : t('enablePlugin')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { mutate(() => removeTrigger(rule.id)) }}>{t('triggerRemove')}</Button></div></td>
            </tr>
          })}</tbody>
        </table></div>}

      </section>
      <Modal open={editorOpen} onClose={() => { if (!busy) setEditorOpen(false) }} title={draft.id ? t('triggerEditRule') : t('triggerCreateRule')} headless className="dse-trigger-modal">
        <header className="dse-trigger-editor-header">
          <span className="dse-trigger-editor-icon" aria-hidden="true"><IconAlarmClockOutline16 size={22} /></span>
          <div><h2>{draft.id ? t('triggerEditRule') : t('triggerCreateRule')}</h2><p>{t('triggerPromptDelivery')}</p></div>
          <button type="button" className="dse-trigger-editor-close" aria-label={t('triggerCloseEditor')} disabled={busy} onClick={() => { setEditorOpen(false) }}><IconCloseOutline16 size={16} /></button>
        </header>
        <div className="dse-trigger-modal-content"><div className="dse-trigger-editor">
          <fieldset className="dse-trigger-editor-section"><legend><span aria-hidden="true">01</span>{t('triggerConditions')}</legend>
            <div className="dse-trigger-fields"><label><span>{t('triggerRuleName')}</span><input placeholder={t('triggerRuleNamePlaceholder')} value={draft.name} onChange={(event) => { patchDraft('name', event.currentTarget.value) }} /></label>
              <label><span>{t('triggerSource')}</span><Select value={draft.sourceKind} onChange={(event) => { patchDraft('sourceKind', event.currentTarget.value as TriggerDraft['sourceKind']) }}><option value="timer">{t('triggerTimer')}</option><option value="local-file">{t('triggerLocalFiles')}</option>{cloudFiles ? <option value="cloud-file">{t('triggerCloudFiles')}</option> : null}</Select></label></div>
            {draft.sourceKind === 'timer' ? <div className={draft.timerKind === 'every' ? 'dse-trigger-fields dse-trigger-timer-fields' : 'dse-trigger-fields'}><label><span>{t('triggerSchedule')}</span><Select value={draft.timerKind} onChange={(event) => { patchDraft('timerKind', event.currentTarget.value as TriggerDraft['timerKind']) }}><option value="every">{t('triggerRecurring')}</option><option value="at">{t('triggerOneTime')}</option></Select></label><label><span>{t('triggerStartAt')}</span><input type="datetime-local" value={draft.timerAt} onChange={(event) => { patchDraft('timerAt', event.currentTarget.value) }} /></label>{draft.timerKind === 'every' ? <label><span>{t('triggerEverySeconds')}</span><input type="number" min="1" value={draft.everySeconds} onChange={(event) => { patchDraft('everySeconds', event.currentTarget.value) }} /></label> : null}</div> : <><div className="dse-trigger-fields">{draft.sourceKind === 'local-file' ? <label className="dse-trigger-wide"><span>{t('triggerRoots')}</span><textarea value={draft.roots} onChange={(event) => { patchDraft('roots', event.currentTarget.value) }} placeholder={t('triggerRootsHelp')} /></label> : <label className="dse-trigger-wide"><span>{t('triggerCloudSpace')}</span><Select value={draft.spaceId} onChange={(event) => { patchDraft('spaceId', event.currentTarget.value) }}><option value="">{t('triggerSelectSpace')}</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</Select></label>}<label><span>{t('triggerIncludes')}</span><textarea value={draft.includes} onChange={(event) => { patchDraft('includes', event.currentTarget.value) }} /></label><label><span>{t('triggerExcludes')}</span><textarea value={draft.excludes} onChange={(event) => { patchDraft('excludes', event.currentTarget.value) }} /></label><label><span>{t('triggerBatchWindow')}</span><input type="number" min="50" value={draft.windowMs} onChange={(event) => { patchDraft('windowMs', event.currentTarget.value) }} /></label>{draft.sourceKind === 'local-file' ? <><label><span>{t('triggerStabilityWindow')}</span><input type="number" min="50" value={draft.stabilityMs} onChange={(event) => { patchDraft('stabilityMs', event.currentTarget.value) }} /></label><label><span>{t('triggerRateLimit')}</span><input type="number" min="1" value={draft.maxEventsPerMinute} onChange={(event) => { patchDraft('maxEventsPerMinute', event.currentTarget.value) }} /></label></> : null}</div><div className="dse-inline-form"><input aria-label={t('triggerTestPath')} placeholder={t('triggerTestPath')} value={matchPath} onChange={(event) => { setMatchPath(event.currentTarget.value) }} /><Button size="sm" variant="outline" disabled={busy || !matchPath} onClick={runMatch}>{t('triggerTestMatch')}</Button>{matchResult !== undefined ? <span className="dse-row-note">{matchResult ? t('triggerMatches') : t('triggerDoesNotMatch')}</span> : null}</div></>}
          </fieldset>
          <fieldset className="dse-trigger-editor-section"><legend><span aria-hidden="true">02</span>{t('triggerTarget')}</legend>
            <div className="dse-trigger-fields"><label><span>{t('triggerTarget')}</span><Select value={draft.targetKind} onChange={(event) => { patchDraft('targetKind', event.currentTarget.value as TriggerDraft['targetKind']) }}><option value="existing-session">{t('triggerExistingSession')}</option><option value="new-session">{t('triggerNewSession')}</option></Select></label>
              {draft.targetKind === 'existing-session' ? <label><span>{t('triggerSession')}</span><Select value={draft.sessionId || sessions.current || ''} onChange={(event) => { patchDraft('sessionId', event.currentTarget.value) }}><option value="">{t('triggerSelectSession')}</option>{sessions.ids.map(id => <option value={id} key={id}>{sessions.byId[id]?.displayTitle ?? id}</option>)}</Select></label> : null}
            </div>
            {draft.targetKind === 'new-session' ? <div className="dse-trigger-fields"><label className="dse-trigger-wide"><span>{t('triggerWorkspacePath')}</span><input value={draft.workspacePath} onChange={(event) => { patchDraft('workspacePath', event.currentTarget.value) }} /></label><label><span>{t('triggerAgentPreset')}</span><input value={draft.agentPreset} onChange={(event) => { patchDraft('agentPreset', event.currentTarget.value) }} /></label><label><span>{t('triggerPermissionPreset')}</span><input value={draft.permissionPreset} onChange={(event) => { patchDraft('permissionPreset', event.currentTarget.value) }} /></label><label className="dse-trigger-wide"><span>{t('triggerTitleTemplate')}</span><input value={draft.titleTemplate} onChange={(event) => { patchDraft('titleTemplate', event.currentTarget.value) }} /></label></div> : null}
          </fieldset>
          <fieldset className="dse-trigger-editor-section"><legend><span aria-hidden="true">03</span>{t('triggerInstruction')}</legend>
            <label><span>{t('triggerPrompt')}</span><textarea aria-label={t('triggerPrompt')} className="dse-trigger-instruction" value={draft.instruction} onChange={(event) => { patchDraft('instruction', event.currentTarget.value) }} /></label>
            <details className="dse-trigger-variables"><summary>{t('triggerVariablesTitle')}</summary><p>{t('triggerPromptVariables')}</p></details>
          </fieldset>
          {editorError ? <p className="dse-status dse-error" role="alert">{t('requestFailed')}</p> : null}
        </div></div>
        <footer className="dse-trigger-editor-footer"><Button variant="outline" disabled={busy} onClick={() => { setEditorOpen(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? t('saving') : t('save')}</Button></footer>
      </Modal>
      <section ref={runSection} className="dse-trigger-runs" aria-label={runView === 'queue' ? t('triggerQueue') : t('triggerHistory')}>
        <div className="dse-trigger-run-tabs" role="tablist" aria-label={t('triggerRunViews')}>
          <button ref={queueTabRef} type="button" id="dse-trigger-queue-tab" role="tab" tabIndex={runView === 'queue' ? 0 : -1} aria-controls="dse-trigger-run-panel" aria-selected={runView === 'queue'} onKeyDown={handleRunTabKeyDown} onClick={() => { setRunView('queue') }}>{t('triggerQueue')}<span aria-hidden="true">{queued.length}</span></button>
          <button ref={historyTabRef} type="button" id="dse-trigger-history-tab" role="tab" tabIndex={runView === 'history' ? 0 : -1} aria-controls="dse-trigger-run-panel" aria-selected={runView === 'history'} onKeyDown={handleRunTabKeyDown} onClick={() => { setRunView('history') }}>{t('triggerHistory')}<span aria-hidden="true">{history.length}</span></button>
        </div>
        <div id="dse-trigger-run-panel" role="tabpanel" aria-labelledby={runView === 'queue' ? 'dse-trigger-queue-tab' : 'dse-trigger-history-tab'}>
          {(runView === 'queue' ? queued : history).length === 0 ? <p className="dse-trigger-quiet-empty">{t(runView === 'queue' ? 'triggerQueueEmpty' : 'triggerHistoryEmpty')}</p> : <div className="dse-trigger-list"><table className="dse-trigger-table">
            <thead><tr><th scope="col">{t('triggerRuleName')}</th><th scope="col">{t('triggerReceivedAt')}</th><th scope="col">{t('triggerRunState')}</th><th scope="col">{t('triggerTarget')}</th></tr></thead>
            <tbody>{(runView === 'queue' ? queued : history).map(batch => <tr key={batch.id}>
              <td><strong>{snapshot.rules.find(rule => rule.id === batch.ruleId)?.name ?? batch.ruleSnapshot.name}</strong><span className="dse-row-note">{t('versionShort')}{batch.ruleVersion} · {batch.resources.length} {t('triggerResources')}</span></td>
              <td>{new Date(batch.createdAt).toLocaleString()}</td>
              <td><span className="dse-tag" data-state={batch.state}>{stateLabel(batch.state)}</span>{batch.error ? <span className="dse-row-note">{batch.error}</span> : null}</td>
              <td><div className="dse-actions">{batch.sessionId ? <Button size="sm" variant="outline" onClick={() => { void openSession(batch.sessionId as string) }}>{t('triggerOpenSession')}</Button> : null}{runView === 'history' && (batch.state === 'failed' || batch.state === 'unknown') ? <Button size="sm" variant="outline" icon={<IconPlayOutline16 size={14} />} disabled={busy} onClick={() => { mutate(() => retryTrigger(batch.id)) }}>{t('triggerRetry')}</Button> : null}</div></td>
            </tr>)}</tbody>
          </table></div>}

        </div>
      </section>
    </div>
  </main>
}

/** Mount only trigger management; credentials and source availability belong to the product Host. */
export function registerProductTriggers(ctx: Context, rpcPath: string, cloudFiles: boolean): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const navigation = ctx.mainNavigation
  const call = async (endpoint: string, args: unknown): Promise<unknown> => {
    const response = await connection.rpc.call(rpcPath, endpoint, { args })
    if (!response.ok) throw new Error(response.error.message)
    return response.value
  }
  const injected = (): TriggerInjected => ({
    cloudFiles, newSessionPreset: 'standard',
    loadTriggers: async () => triggerSnapshot.parse(await call('trigger-snapshot', {})),
    saveTrigger: async input => triggerRule.parse(await call('trigger-save', triggerRuleSaveInput.parse(input))),
    setTriggerEnabled: async (ruleId, enabled) => triggerRule.parse(await call('trigger-enable', { ruleId, enabled })),
    removeTrigger: async (ruleId) => { await call('trigger-remove', { ruleId }) },
    retryTrigger: async (batchId) => { await call('trigger-retry', { batchId }) },
    testTriggerMatch: async (path, includes, excludes) => z.object({ matched: z.boolean() }).parse(await call('trigger-test-match', { path, includes, excludes })).matched,
    loadSpaces: async () => cloudFiles ? driveSpaces.parse(await call('drive-spaces', {})) : [],
    openSession: async (id) => { await sessions.refresh(); sessions.open(id as SessionId); navigation.openConversation() },
  })
  const t = ctx.locale.bind('enterprise')
  type RailProps = { wide?: boolean } & PropsRuntime<'sidebar.rail.item'> & PropsLocale<'enterprise'> & InjectFace<{
    open: () => void
    hooks: { active: HostObservable<MainSurface> }
  }>
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({ name: 'sidebar.rail.item', id: 'triggers', order: 30,
    locale: 'enterprise', label: () => t('triggers'), icon: IconAlarmClockOutline16,
    inject: () => ({ open: () => { navigation.openTriggers() }, hooks: { active: { getSnapshot: () => navigation.get(), subscribe: navigation.subscribe.bind(navigation) } } }),
  }, ({ open, useActive, t, wide }: RailProps) => {
    const selected = useActive(value => value === 'triggers')
    return <button type="button" className="dse-market-action" data-active={selected || undefined} data-wide={wide || undefined} title={t('triggers')} aria-label={t('triggers')}
      aria-pressed={selected} aria-current={selected ? 'page' : undefined} onClick={open}><IconAlarmClockOutline16 size={wide ? 16 : 18} />{wide ? <span className="dse-market-action-label">{t('triggers')}</span> : null}</button>
  }))
  ctx.slots.inject('main.surface', () => ctx.slots.register({ name: 'main.surface', key: 'triggers', locale: 'enterprise', inject: injected }, TriggerSurface))
}
