// @vitest-environment jsdom
/** Failed management retains input; financial and custody reads remain permission scoped. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TeamManagement from '../src/client/team-management.tsx'
import BillingSummaryPanel from '../src/client/billing-summary.tsx'
import StorageRecovery from '../src/client/storage-recovery.tsx'
import { en, zh } from '../src/client/locales.ts'
import { enterpriseBillingSummary, enterpriseDashboard, teamManagementState, teamAuditPage } from '../src/wire.ts'

afterEach(cleanup)
function translate() {
  const locale = new LocaleRuntime(new Context())
  locale.register('enterprise', { en, zh }); locale.setLocale('en')
  return locale.bind('enterprise')
}

it('retains failed role edits, captures the version and confirms role disabling', async () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const state = teamManagementState.parse({ permissions: ['role.manage'], members: [], catalog: [{ id: 'billing.read', description: 'Billing' }],
    roles: [{ id, name: 'Finance', description: '', permissionIds: ['billing.read'], version: 7, enabled: true, system: false }], bindings: [], providers: [] })
  const loadManagement = vi.fn(async () => state)
  const manageTeam = vi.fn().mockRejectedValueOnce(new Error('CONFIG_VERSION_CONFLICT')).mockResolvedValue(undefined)
  render(<TeamManagement t={translate()} loadManagement={loadManagement} manageTeam={manageTeam} />)
  changeField(await screen.findByLabelText(en.teamRoleChoose), { target: { value: id } })
  changeField(screen.getByLabelText(en.teamRoleName), { target: { value: 'Finance reader' } })
  fireEvent.click(screen.getByRole('tab', { name: en.teamBindings }))
  expect(screen.queryByRole('textbox', { name: en.teamRoleName })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: en.teamRoles }))
  expect(screen.getByRole('textbox', { name: en.teamRoleName })).toHaveProperty('value', 'Finance reader')
  const save = screen.getAllByRole('button', { name: en.save }).at(0)
  expect(save).toBeDefined()
  if (!save) throw new Error('Role editor is unavailable')
  fireEvent.click(save)
  await screen.findByRole('alert')
  expect(screen.getByLabelText(en.teamRoleName)).toHaveProperty('value', 'Finance reader')
  expect(manageTeam).toHaveBeenLastCalledWith({ action: 'role-update', id, input: {
    name: 'Finance reader', description: '', permissionIds: ['billing.read'], expectedVersion: 7,
  } })
  fireEvent.click(screen.getByRole('button', { name: en.teamDisableRole }))
  expect(manageTeam).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: en.confirmRevoke }))
  await waitFor(() => { expect(manageTeam).toHaveBeenCalledTimes(2) })
  expect(manageTeam).toHaveBeenLastCalledWith({ action: 'role-disable', id, expectedVersion: 7 })
})

it('pages audit records with the submitted action filter and hides unauthorized editors', async () => {
  const state = teamManagementState.parse({ permissions: ['audit.read'], members: [], catalog: [], roles: [], bindings: [], providers: [] })
  const loadManagement = vi.fn(async () => state)
  const loadAudit = vi.fn(async (cursor?: string, action?: string) => teamAuditPage.parse({ items: [{ id: cursor ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001', actorId: 'actor',
    action: action ?? 'team.updated', resourceId: null, createdAt: '2026-10-23T00:00:00Z', detail: {} }], nextCursor: cursor ? null : 'next' }))
  render(<TeamManagement t={translate()} loadManagement={loadManagement} loadAudit={loadAudit} />)
  await screen.findByRole('button', { name: en.loadMore })
  expect(screen.queryByLabelText(en.teamRoleName)).toBeNull()
  changeField(screen.getByLabelText(en.teamAuditAction), { target: { value: 'team.suspended' } })
  fireEvent.click(screen.getByRole('button', { name: en.searchFiles }))
  await waitFor(() => { expect(loadAudit).toHaveBeenLastCalledWith(undefined, 'team.suspended') })
  fireEvent.click(await screen.findByRole('button', { name: en.loadMore }))
  await waitFor(() => { expect(loadAudit).toHaveBeenLastCalledWith('next', 'team.suspended') })
  expect(screen.queryByRole('button', { name: en.loadMore })).toBeNull()
})

it('recovers personal billing on focus and distinguishes failed reads from zero costs', async () => {
  const dashboard = enterpriseDashboard.parse({ organization: { id: 'team', name: 'Company', kind: 'team', status: 'active', policyRevision: 1 },
    subscription: { plan: 'team', seats: 1 }, roles: [], permissions: [], models: [], runtimes: [] })
  const state = enterpriseBillingSummary.parse({ scope: 'own', month: '2026-10', timeZone: 'Asia/Shanghai', balanceMicrosCny: null,
    budget: { mode: 'limited', amountMicrosCny: 0 }, ownerExempt: false, settledMicrosCny: 17, pendingCount: 2,
    pendingEstimateMicrosCny: 20, refundMicrosCny: 0, adjustmentMicrosCny: 0, departments: [], updatedAt: '2026-10-23T00:00:00Z' })
  const loadBillingSummary = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(state)
  render(<BillingSummaryPanel t={translate()} loadDashboard={async () => dashboard} loadBillingSummary={loadBillingSummary} />)
  await screen.findByRole('alert')
  expect(screen.queryByText(en.billingTeam)).toBeNull()
  expect(screen.queryByText(en.settledCost)).toBeNull()
  fireEvent.focus(window)
  await screen.findByText(en.settledCost)
  expect(loadBillingSummary).toHaveBeenLastCalledWith('own', undefined)
  changeField(screen.getByLabelText(en.billingMonthly), { target: { value: '2026-09' } })
  await waitFor(() => { expect(loadBillingSummary).toHaveBeenLastCalledWith('own', '2026-09') })
})

it('confirms permanent cleanup, preserves a failed retry and exposes no custody content URL', async () => {
  const totals = { usedBytes: 20, trashBytes: 10, versionBytes: 5, uploadBytes: 3, limitBytes: 10 }
  const loadStorage = vi.fn(async () => ({ team: totals, personal: totals, updatedAt: '2026-10-23T00:00:00Z' }))
  const loadCustody = vi.fn(async () => ({ items: [{ id: 'asset', name: 'Retained file', kind: 'file', spaceId: 'space',
    ownerAccountId: 'departed', deletedAt: '2026-10-22T00:00:00Z', purging: false, size: 10 }], nextCursor: null }))
  const recoverFile = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<StorageRecovery t={translate()} loadStorage={loadStorage} loadCustody={loadCustody} recoverFile={recoverFile} />)
  fireEvent.click(await screen.findByRole('tab', { name: en.storageCustody }))
  await screen.findByText('Retained file · 10')
  expect(screen.queryByRole('link')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.storagePurge }))
  expect(recoverFile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.storageConfirmPurge }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: en.storageConfirmPurge }))
  await waitFor(() => { expect(recoverFile).toHaveBeenCalledTimes(2) })
  expect(recoverFile).toHaveBeenLastCalledWith('asset', 'purge')
})

function changeField(element: Element, init: { target: Record<string, unknown> }): void {
  if (element.getAttribute('role') !== 'combobox') { fireEvent.change(element, init); return }
  fireEvent.click(element)
  const option = screen.getAllByRole('option').find(item => item.getAttribute('data-value') === String(init.target.value))
  if (!option) throw new Error(`Missing choice: ${String(init.target.value)}`)
  fireEvent.click(option)
}
