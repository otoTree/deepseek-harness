import { Select, TabGroup } from '@deepseek-ai/dsh-client-ui-primitives'
/** Current-team roles, identity configuration and paged audit without platform impersonation. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { z } from 'zod'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { teamManagementCommand, type teamManagementState, type teamAuditPage } from '../wire.ts'

/** Explicit current-team management operations supplied by the authenticated Host. */
export interface TeamManagementActions {
  loadManagement?: () => Promise<z.infer<typeof teamManagementState>>
  manageTeam?: (input: z.infer<typeof teamManagementCommand>) => Promise<void>
  loadAudit?: (cursor?: string, action?: string) => Promise<z.infer<typeof teamAuditPage>>
}

/**
 * Render authorized team management controls and retain failed form input.
 * @param props Current-team callbacks and localized labels.
 * @returns Permission-scoped role, identity and audit controls.
 */
export default function TeamManagement({ loadManagement, manageTeam, loadAudit, t }: TeamManagementActions & PropsLocale<'enterprise'>): ReactNode {
  const [state, setState] = useState<z.infer<typeof teamManagementState>>()
  const [revision, setRevision] = useState(0), [error, setError] = useState(false), [busy, setBusy] = useState(false)
  const [roleId, setRoleId] = useState(''), [providerId, setProviderId] = useState('')
  const [audit, setAudit] = useState<z.infer<typeof teamAuditPage>>(), [actionFilter, setActionFilter] = useState('')
  const [draftFilter, setDraftFilter] = useState('')
  const [confirm, setConfirm] = useState<string>()
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void loadManagement?.().then((value) => {
        if (!disposed) { setState(value); setError(false) }
      }, () => { if (!disposed) { setState(undefined); setError(true) } })
    }
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('enterprise-refresh', refresh)
    return () => { disposed = true; window.removeEventListener('focus', refresh); window.removeEventListener('enterprise-refresh', refresh) }
  }, [loadManagement, revision])
  const canAudit = state?.permissions.includes('audit.read') ?? false
  useEffect(() => {
    let disposed = false
    setAudit(undefined)
    if (canAudit) void loadAudit?.(undefined, actionFilter ||
      undefined).then((value) => { if (!disposed) setAudit(value) }, () => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [loadAudit, canAudit, actionFilter, revision])
  const execute = (input: unknown, confirmation?: string) => {
    if (!manageTeam || busy) return
    if (confirmation && confirm !== confirmation) { setConfirm(confirmation); return }
    setBusy(true); setError(false)
    void Promise.resolve().then(() => manageTeam(teamManagementCommand.parse(input))).then(() => {
      setConfirm(undefined); setRevision(value => value + 1)
    }, () =>{  setError(true) }).finally(() =>{  setBusy(false) })
  }
  const submit = (event: FormEvent<HTMLFormElement>, command: (data: FormData) => unknown) => {
    event.preventDefault()
    try { execute(command(new FormData(event.currentTarget))) } catch { setError(true) }
  }
  if (!loadManagement) return null
  if (!state) return <div className="dse-section dse-management"><h2>{t('teamManagementNav')}</h2><p role={error ? 'alert' : 'status'}>{t(error ? 'requestFailed' : 'loading')}</p><Button onClick={() =>{  setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  const role = state.roles.find(item => item.id === roleId), provider = state.providers.find(item => item.id === providerId)
  const canRoles = state.permissions.includes('role.manage'), canIdentity = state.permissions.includes('identity.manage')
  const memberSelect = <label>{t('member')}<Select name="membershipId" required><option value="">{t('governanceChoose')}</option>{state.members.map(item => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</Select></label>
  return <div className="dse-section dse-management"><header><h2>{t('teamManagementNav')}</h2><p>{t('teamManagementHelp')}</p><Button disabled={busy} onClick={() =>{  setRevision(value => value + 1) }}>{t('governanceRefresh')}</Button></header>
    {error && <p role="alert">{t('requestFailed')}</p>}
    {!canRoles && !canIdentity && !canAudit && <p>{t('teamNoAuthority')}</p>}
    <TabGroup label={t('teamManagementNav')} tabs={[
      ...(canRoles ? [{ id: 'roles', label: t('teamRoles'), content: <section className="dse-card"><h3>{t('teamRoles')}</h3>
        <label>{t('teamRoleChoose')}<Select value={roleId} onChange={(event) => { setRoleId(event.target.value); setConfirm(undefined) }}><option value="">{t('teamNewRole')}</option>{state.roles.filter(item => item.enabled).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <form key={role?.id ?? 'new-role'} onSubmit={(event) =>{  submit(event, data => ({ action: role ? 'role-update' : 'role-create', ...(role ? { id: role.id } : {}), input: {
          name: data.get('name'), description: '', permissionIds: data.getAll('permission'), ...(role ? { expectedVersion: role.version } : {}),
        } })) }}><fieldset disabled={busy || role?.system}><label>{t('teamRoleName')}<input name="name" required maxLength={120} defaultValue={role?.name} /></label>
            <fieldset><legend>{t('teamPermissionIds')}</legend>{state.catalog.map(item => <label key={item.id}><input type="checkbox" name="permission" value={item.id} defaultChecked={role?.permissionIds.includes(item.id)} />{item.id} · {item.description}</label>)}</fieldset>
            <Button type="submit">{t('save')}</Button>{role && <Button onClick={() =>{  execute({ action: 'role-disable', id: role.id, expectedVersion: role.version }, role.id) }}>{t(confirm === role.id ? 'confirmRevoke' : 'teamDisableRole')}</Button>}
          </fieldset></form>
      </section> }, { id: 'bindings', label: t('teamBindings'), content: <section className="dse-card">
        <form onSubmit={(event) =>{  submit(event, (data) => {
          const id = z.string().parse(data.get('role')), input = { membershipId: data.get('membershipId'), unitId: null, effect: data.get('effect') }
          return id.startsWith('custom:') ? { action: 'role-bind', id: id.slice(7), input } : { action: 'fixed-role-bind', input: { ...input, role: id } }
        }) }}><fieldset disabled={busy}><h3>{t('teamBind')}</h3>{memberSelect}<label>{t('memberRole')}<Select name="role" required><option value="">{t('teamRoleChoose')}</option>{['owner', 'administrator', 'member', 'security_reviewer', 'finance_auditor', 'plugin_publisher'].map(id => <option key={id} value={id}>{id}</option>)}{state.roles.filter(item => item.enabled).map(item => <option key={item.id} value={'custom:' + item.id}>{item.name}</option>)}</Select></label>
            <label>{t('teamBind')}<Select name="effect"><option value="allow">{t('teamAllow')}</option><option value="deny">{t('teamDeny')}</option></Select></label><Button type="submit">{t('save')}</Button>
          </fieldset></form><h3>{t('teamBindings')}</h3><ul className="dse-list">{state.bindings.map(item => <li className="dse-row" key={item.id}><span>{state.members.find(member => member.id === item.membershipId)?.email ?? item.membershipId} · {state.roles.find(role => 'custom:' + role.id === item.role)?.name ?? item.role} · {t(item.effect === 'deny' ? 'teamDeny' : 'teamAllow')} · {item.unitId ?? t('organization')}</span><Button disabled={busy} onClick={() =>{  execute({ action: 'role-unbind', id: item.id }, item.id) }}>{t(confirm === item.id ? 'confirmRevoke' : 'teamRevokeRole')}</Button></li>)}</ul>
      </section> }] : []),
      ...(canIdentity ? [{ id: 'identity', label: t('teamIdentity'), content: <section className="dse-card"><h3>{t('teamIdentity')}</h3><label>{t('teamIdentity')}<Select value={providerId} onChange={(event) =>{  setProviderId(event.target.value) }}><option value="">{t('governanceChoose')}</option>{state.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <form key={provider?.id ?? 'new-provider'} onSubmit={(event) =>{  submit(event, data => ({ action: provider ? 'identity-update' : 'identity-create', ...(provider ? { id: provider.id } : {}), input: {
          name: data.get('name'), protocol: data.get('protocol'), ...(data.get('issuer') ? { issuer: data.get('issuer') } : {}),
          ...(data.get('config') ? { config: z.record(z.string(), z.json()).parse(JSON.parse(z.string().parse(data.get('config')))) } : {}),
          ...(provider ? { expectedVersion: provider.version } : {}),
        } })) }}><fieldset disabled={busy}><label>{t('teamRoleName')}<input name="name" required defaultValue={provider?.name} /></label><label>{t('teamIdentityProtocol')}<Select name="protocol" defaultValue={provider?.protocol ?? 'oidc'}><option value="oidc">{t('teamIdentityOidc')}</option><option value="oauth2">{t('teamIdentityOauth2')}</option></Select></label>
            <label>{t('teamIdentityIssuer')}<input type="url" name="issuer" defaultValue={provider?.issuer ?? ''} /></label><label>{t('teamIdentityConfig')}<textarea name="config" autoComplete="off" /></label><Button type="submit">{t('save')}</Button>
            {provider && <Button onClick={() =>{  execute({ action: 'identity-update', id: provider.id, input: { enabled: !provider.enabled, expectedVersion: provider.version } }, provider.id) }}>{t(confirm === provider.id ? 'confirmRevoke' : provider.enabled ? 'teamIdentityDisable' : 'teamIdentityEnable')}</Button>}
          </fieldset></form>
      </section> }] : []),
      ...(canAudit ? [{ id: 'audit', label: t('teamAudit'), content: <section className="dse-card"><h3>{t('teamAudit')}</h3><form onSubmit={(event) => { event.preventDefault(); setActionFilter(draftFilter) }}><label>{t('teamAuditAction')}<input value={draftFilter} onChange={(event) =>{  setDraftFilter(event.target.value) }} /></label><Button type="submit">{t('searchFiles')}</Button></form>
        <ul className="dse-list">{audit?.items.map(item => <li key={item.id}><time>{new Date(item.createdAt).toLocaleString()}</time> · {item.action} · {item.actorId} · {item.resourceId}<pre>{JSON.stringify(item.detail)}</pre></li>)}</ul>
        {audit?.nextCursor && <Button disabled={busy} onClick={() => {
          setBusy(true); void loadAudit?.(audit.nextCursor ?? undefined, actionFilter ||
          undefined).then((page) =>{  setAudit({ ...page, items: [...audit.items, ...page.items] }) },
            () =>{  setError(true) }).finally(() =>{  setBusy(false) })
        }}>{t('loadMore')}</Button>}
      </section> }] : []),
    ]} />
  </div>
}
