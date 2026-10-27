import { Select, TabGroup } from '@deepseek-ai/dsh-client-ui-primitives'
/** Team-funded storage accounting, trash and metadata-only offboarding custody. */
import { useEffect, useState, type ReactNode } from 'react'
import type { z } from 'zod'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { enterpriseStorage, enterpriseCustody, DriveSpaces, DriveFilePage } from '../wire.ts'

/** Storage controls keep custody separate from content browsing. */
export interface StorageRecoveryActions {
  loadStorage?: () => Promise<z.infer<typeof enterpriseStorage>>
  loadCustody?: (cursor?: string) => Promise<z.infer<typeof enterpriseCustody>>
  loadTrash?: (spaceId: string, cursor?: string) => Promise<DriveFilePage>
  loadTaskSpaces?: () => Promise<DriveSpaces>
  recoverFile?: (id: string, action: 'trash' | 'restore' | 'purge') => Promise<void>
}

/**
 * Render capacity and explicit file recovery without generating download URLs.
 * @param props Authorized storage queries, mutations and locale dictionary.
 * @returns Current usage, paged trash and assigned custody.
 */
export default function StorageRecovery({ loadStorage, loadCustody, loadTrash, loadTaskSpaces, recoverFile, t }: StorageRecoveryActions & PropsLocale<'enterprise'>): ReactNode {
  const [capacity, setCapacity] = useState<z.infer<typeof enterpriseStorage>>()
  const [custody, setCustody] = useState<z.infer<typeof enterpriseCustody>>()
  const [spaces, setSpaces] = useState<DriveSpaces>([])
  const [space, setSpace] = useState(''), [trash, setTrash] = useState<DriveFilePage>()
  const [revision, setRevision] = useState(0), [error, setError] = useState(false), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string>()
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void Promise.all([loadStorage?.(), loadCustody?.(), loadTaskSpaces?.()]).then(([bytes, files, available]) => {
        if (!disposed) { setCapacity(bytes); setCustody(files); setSpaces(available ?? []); setError(false) }
      }, () => { if (!disposed) setError(true) })
    }
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('enterprise-refresh', refresh)
    return () => { disposed = true; window.removeEventListener('focus', refresh); window.removeEventListener('enterprise-refresh', refresh) }
  }, [loadStorage, loadCustody, loadTaskSpaces, revision])
  useEffect(() => {
    let disposed = false
    setTrash(undefined)
    if (space) void loadTrash?.(space).then((value) => { if (!disposed) setTrash(value) }, () => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [space, loadTrash, revision])
  const act = (id: string, action: 'trash' | 'restore' | 'purge') => {
    if (!recoverFile || busy) return
    if (action === 'purge' && confirm !== id) { setConfirm(id); return }
    setBusy(true); setError(false)
    void recoverFile(id, action).then(() => { setConfirm(undefined); setRevision(value => value + 1) },
      () => { setError(true) }).finally(() =>{  setBusy(false) })
  }
  return <div className="dse-section"><header className="dse-page-heading"><div><h2>{t('storageRecoveryNav')}</h2><p>{t('storageRecoveryHelp')}</p></div><Button disabled={busy} onClick={() =>{  setRevision(value => value + 1) }}>{t('governanceRefresh')}</Button></header>
    {error && <p role="alert">{t('requestFailed')}</p>}
    <TabGroup label={t('storageRecoveryNav')} tabs={[
      { id: 'capacity', label: t('usageOverview'), content: <>{capacity ? <><p>{new Date(capacity.updatedAt).toLocaleString()}</p>{(['team', 'personal'] as const).map(kind => <section key={kind} className="dse-card"><h3>{t(kind === 'team' ? 'governanceCapacity' : 'governancePersonalCapacity')}</h3><dl className="dse-profile-fields"><div><dt>{t('storageUsed')}</dt><dd>{capacity[kind].usedBytes} / {capacity[kind].limitBytes ?? t('governanceUnconfigured')}</dd></div><div><dt>{t('storageVersions')}</dt><dd>{capacity[kind].versionBytes}</dd></div><div><dt>{t('storageTrash')}</dt><dd>{capacity[kind].trashBytes}</dd></div><div><dt>{t('governanceUploads')}</dt><dd>{capacity[kind].uploadBytes}</dd></div></dl></section>)}</> : <p role="status">{t('loading')}</p>}</> },
      { id: 'trash', label: t('storageTrash'), content: <section><h3>{t('storageTrash')}</h3><label>{t('taskWorkspace')}<Select value={space} onChange={(event) => { setSpace(event.target.value); setConfirm(undefined) }}><option value="">{t('governanceChoose')}</option>{spaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        {trash && <><ul className="dse-list">{trash.items.map(item => <li className="dse-row" key={item.id}><span>{item.name} · {item.size}</span><span><Button disabled={busy} onClick={() =>{  act(item.id, 'restore') }}>{t('governanceRestore')}</Button><Button disabled={busy} onClick={() =>{  act(item.id, 'purge') }}>{t(confirm === item.id ? 'storageConfirmPurge' : 'storagePurge')}</Button></span></li>)}</ul>{trash.nextCursor && <Button disabled={busy} onClick={() => {
          setBusy(true); void loadTrash?.(space, trash.nextCursor ?? undefined).then((page) =>{  setTrash({ ...page,
            items: [...trash.items, ...page.items] }) }, () =>{  setError(true) }).finally(() =>{  setBusy(false) })
        }}>{t('loadMore')}</Button>}</>}
      </section> },
      { id: 'custody', label: t('storageCustody'), content: <section><h3>{t('storageCustody')}</h3><p>{t('governanceHandoverHelp')}</p><ul className="dse-list">{custody?.items.map(item => <li className="dse-row" key={item.id}><span>{item.name} · {item.size}</span>{item.purging ? <span role="status">{t('storagePurging')}</span> : <Button disabled={busy} onClick={() =>{  act(item.id, item.deletedAt ? 'purge' : 'trash') }}>{t(item.deletedAt ? confirm === item.id ? 'storageConfirmPurge' : 'storagePurge' : 'storageMoveTrash')}</Button>}</li>)}</ul>
        {custody?.nextCursor && <Button disabled={busy} onClick={() => {
          setBusy(true); void loadCustody?.(custody.nextCursor ?? undefined).then((page) =>{  setCustody({ ...page,
            items: [...custody.items, ...page.items] }) }, () =>{  setError(true) }).finally(() =>{  setBusy(false) })
        }}>{t('loadMore')}</Button>}
      </section> },
    ]} /></div>
}
