/** Monthly billing and authorized ledger exports from the common settlement records. */
import { useEffect, useState, type ReactNode } from 'react'
import type { z } from 'zod'
import { Select, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { enterpriseBillingSummary, EnterpriseDashboard, EnterpriseWalletLedger } from '../wire.ts'

/** Authorized billing reads; team scope is checked again by the API. */
export interface BillingSummaryActions {
  loadBillingSummary?: ((scope: 'own' | 'organization', month?: string) => Promise<z.infer<typeof enterpriseBillingSummary>>) | undefined
  loadBillingLedger?: ((scope: 'own' | 'organization', cursor?: string) => Promise<EnterpriseWalletLedger>) | undefined
}

/**
 * Show costs, pending estimates and explicit full-ledger export for the selected scope.
 * @param props Authenticated reads and localized copy.
 * @returns Monthly accounting controls with no reservation balance.
 */
export default function BillingSummaryPanel({ loadBillingSummary, loadBillingLedger, loadDashboard, t }: BillingSummaryActions & {
  loadDashboard: () => Promise<EnterpriseDashboard>
} & PropsLocale<'enterprise'>): ReactNode {
  const [scope, setScope] = useState<'own' | 'organization'>('own')
  const [month, setMonth] = useState('')
  const [state, setState] = useState<z.infer<typeof enterpriseBillingSummary>>()
  const [canReadTeam, setCanReadTeam] = useState(false)
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    let disposed = false
    void loadDashboard().then((value) => { if (!disposed) setCanReadTeam(value.permissions.includes('billing.read')) }, () => { if (!disposed) setCanReadTeam(false) })
    return () => { disposed = true }
  }, [loadDashboard, revision])
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      setError(false)
      void loadBillingSummary?.(scope, month || undefined).then((value) => {
        if (!disposed) setState(value)
      }, () => { if (!disposed) { setState(undefined); setError(true) } })
    }
    setState(undefined); refresh(); window.addEventListener('focus', refresh); window.addEventListener('enterprise-refresh', refresh)
    return () => { disposed = true; window.removeEventListener('focus', refresh); window.removeEventListener('enterprise-refresh', refresh) }
  }, [loadBillingSummary, scope, month, revision])
  const exportLedger = async () => {
    if (!loadBillingLedger || busy) return
    setBusy(true); setError(false)
    try {
      const records: EnterpriseWalletLedger['items'] = []
      let cursor: string | undefined
      do {
        const page = await loadBillingLedger(scope, cursor)
        records.push(...page.items); cursor = page.nextCursor ?? undefined
      } while (cursor)
      const quote = (value: string | number) => '"' + String(value).replace(/^[=+@\-\t\r]/u, "'$&").replaceAll('"', '""') + '"'
      const csv = [['id', 'createdAt', 'accountId', 'kind', 'amountMicrosCny', 'balanceAfterMicrosCny'],
        ...records.map(row => [row.id, row.createdAt, row.accountId, row.kind, row.amountMicrosCny, row.balanceAfterMicrosCny ?? ''])]
        .map(row => row.map(quote).join(',')).join('\r\n')
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try { const link = document.createElement('a'); link.href = url; link.download = `ledger-${scope}.csv`; link.click() }
      finally { URL.revokeObjectURL(url) }
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  if (!loadBillingSummary) return null
  const money = (amount: number) => (amount / 1_000_000).toLocaleString(undefined, { style: 'currency', currency: 'CNY', maximumFractionDigits: 6 })
  return <section className="dse-card dse-management"><header><h3>{t('billingMonthly')}</h3><p>{t('billingOvershoot')}</p></header>
    <div className="dse-billing-controls">
      <label>{t('billingMonthly')}<input type="month" value={month || state?.month || ''} onChange={(event) =>{  setMonth(event.currentTarget.value) }} /></label>
      <label>{t('billingNav')}<Select value={scope} onChange={(event) =>{  setScope(event.target.value as typeof scope) }}><option value="own">{t('billingOwn')}</option>{canReadTeam && <option value="organization">{t('billingTeam')}</option>}</Select></label>
      <Button disabled={busy} onClick={() =>{  setRevision(value => value + 1) }}>{t('governanceRefresh')}</Button>
      <Button disabled={busy} onClick={() => void exportLedger()}>{t('billingExport')}</Button>
    </div>
    {error && <p role="alert">{t('requestFailed')}</p>}
    {state ? <><p>{state.month} · {state.timeZone} · {new Date(state.updatedAt).toLocaleString()}</p>
      <dl className="dse-billing-metrics">
        {state.balanceMicrosCny !== null && <div><dt>{t('teamBalance')}</dt><dd>{money(state.balanceMicrosCny)}</dd></div>}
        {scope === 'own' && <div><dt>{t('governanceBudget')}</dt><dd>{state.budget.mode === 'limited' ? money(state.budget.amountMicrosCny) : t(state.budget.mode === 'inherit' ? 'governanceUnconfigured' : 'governanceUnlimited')}</dd></div>}
        <div><dt>{t('settledCost')}</dt><dd>{money(state.settledMicrosCny)}</dd></div>
        <div><dt>{t('billingPending')}</dt><dd>{state.pendingCount}</dd></div>
        <div><dt>{t('billingEstimate')}</dt><dd>{money(state.pendingEstimateMicrosCny)}</dd></div>
        <div><dt>{t('billingRefund')}</dt><dd>{money(state.refundMicrosCny)}</dd></div>
        <div><dt>{t('billingAdjustment')}</dt><dd>{money(state.adjustmentMicrosCny)}</dd></div>
      </dl>{scope === 'own' && state.ownerExempt && <p>{t('billingOwnerExempt')}</p>}
      <p>{t('billingDepartmentHelp')}</p><ul>{state.departments.map(item => <li key={item.id}>{item.name ?? item.id} · {money(item.settledMicrosCny)}</li>)}</ul>
    </> : !error && <p role="status">{t('loading')}</p>}
  </section>
}
