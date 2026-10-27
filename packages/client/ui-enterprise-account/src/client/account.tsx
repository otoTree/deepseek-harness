/** Bundled account UI talks only to its native loopback host, never to an admin page. */
import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { z } from 'zod'
import { accountState, type AccountAction } from '../contracts.ts'
import { accountMessages } from './account-messages.ts'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/visual-system.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/client-palette.css'
import './account.css'

const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? ''
type State = ReturnType<typeof accountState.parse>

function Account() {
  const [locale, setLocale] = useState<'en' | 'zh'>(navigator.language.startsWith('zh') ? 'zh' : 'en')
  const t = accountMessages[locale]
  const [state, setState] = useState<State>()
  const [register, setRegister] = useState(false)
  const [budgetMode, setBudgetMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<keyof typeof t>()
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateFailed, setUpdateFailed] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  useEffect(() => {
    let revision = 0
    let disposed = false
    const cancellation = new AbortController()
    const refreshUpdate = (): void => {
      const current = ++revision
      void fetch('/account/updates', { headers: { 'X-Desktop-Token': token }, cache: 'no-store', signal: cancellation.signal })
        .then(async (response) => {
          if (!response.ok) return
          const result = z.object({ version: z.string().nullable() }).strict().parse(await response.json())
          if (!disposed && current === revision) setUpdateVersion(result.version)
        }).catch(() => { /* Startup discovery is silent when its local transport is unavailable. */ })
    }
    window.addEventListener('dsh-desktop-update-available', refreshUpdate)
    refreshUpdate()
    return () => { disposed = true; cancellation.abort(); window.removeEventListener('dsh-desktop-update-available', refreshUpdate) }
  }, [])
  async function update(action: 'install' | 'dismiss'): Promise<void> {
    setUpdateBusy(true)
    setUpdateFailed(false)
    try {
      const response = await fetch(`/account/updates/${action}`, { method: 'POST', headers: { 'X-Desktop-Token': token } })
      if (!response.ok) throw new Error('Native update action failed')
      setUpdateVersion(null)
    } catch { setUpdateFailed(true) } finally { setUpdateBusy(false) }
  }
  useEffect(() => {
    document.title = t.brand
    document.documentElement.lang = locale
    document.documentElement.style.colorScheme = 'dark'
    document.body.setAttribute('data-ds-dark-theme', '')
  }, [locale, t.brand])
  async function refresh() {
    const response = await fetch('/account/state', { headers: { 'X-Desktop-Token': token }, cache: 'no-store' })
    if (!response.ok) throw new Error('Account state unavailable')
    setState(accountState.parse(await response.json()))
  }
  useEffect(() => { void refresh().catch(() => { setNotice('failed') }) }, [])
  async function run(input: AccountAction): Promise<boolean> {
    if (busy) return false
    setBusy(true); setNotice(input.action === 'enter' ? 'starting' : undefined)
    try {
      const response = await fetch('/account/action', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Desktop-Token': token }, body: JSON.stringify(input) })
      if (!response.ok) {
        if (input.action === 'enter' && response.status === 401) {
          setNotice('sessionExpired')
          await refresh().catch(() => { setNotice('failed') })
          return false
        }
        setNotice(response.status === 403 ? 'denied'
          : response.status === 409 ? 'conflict' : response.status === 429 ? 'limited'
            : response.status < 500 ? 'invalid' : input.action === 'enter' ? 'startFailed' : 'failed')
        return false
      }
      if (input.action === 'enter') return true
      if (input.action === 'register') { setRegister(false); setNotice('registered') }
      await refresh()
      return true
    } catch { setNotice(input.action === 'enter' ? 'startFailed' : 'failed'); return false } finally { setBusy(false) }
  }
  function submit(action: 'login' | 'register' | 'create' | 'join') {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const value = (key: string) => {
        const field = data.get(key)
        return typeof field === 'string' ? field : ''
      }
      const input: AccountAction = action === 'login' ? { action, email: value('email'), password: value('password') }
        : action === 'register' ? { action, email: value('email'), password: value('password'), name: value('name') }
          : action === 'create' ? { action, name: value('name'), defaultBudget: budgetMode === 'unlimited'
            ? { mode: 'unlimited' } : { mode: 'limited', amountMicrosCny: Math.round(Number(value('budget')) * 1_000_000) } }
            : { action, token: value('token') }
      const form = event.currentTarget
      void run(input).then((success) => { if (success) form.reset() })
    }
  }
  return <main className="account-shell">
    <header><span className="brand"><img src="/favicon.png" alt="" />{t.brand}</span><select aria-label={t.language} value={locale}
      onChange={(event) => { setLocale(event.target.value === 'zh' ? 'zh' : 'en') }}>
      <option value="zh">{t.chinese}</option><option value="en">{t.english}</option></select></header>
    <aside className="account-story">
      <div><h2>{t.storyTitle}</h2><p>{t.storyDescription}</p></div>
      <p className="account-story-footer">{t.storyFooter}</p>
    </aside>
    <div className="account-panel">
      <section className="account-content" aria-busy={busy}>
        {!state ? <><h1>{t.brand}</h1><p>{notice ? t[notice] : t.waiting}</p>
          {notice && <button onClick={() => {
            setNotice(undefined)
            void refresh().catch(() => { setNotice('failed') })
          }}>{t.retry}</button>}</>
          : !state.user ? <>
            <h1>{register ? t.registerTitle : t.welcome}</h1><p>{register ? (state.deployment.mode === 'private' ? t.privateRegisterSubtitle : t.registerSubtitle) : t.subtitle}</p>
            <form key={String(register)} onSubmit={submit(register ? 'register' : 'login')}>
              <fieldset disabled={busy}>
                {register && <label>{t.name}<input name="name" autoComplete="name" required maxLength={120} /></label>}
                <label>{t.email}<input name="email" type="email" autoComplete="email" required /></label>
                <label>{t.password}<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
                  required minLength={register ? 12 : 1} maxLength={4096} /></label>
                {register && <small>{t.passwordHint}</small>}
                <button className="primary" type="submit">{busy ? t.waiting : register ? t.register : t.login}</button>
              </fieldset>
            </form>
            {state.ssoProviders.map(provider => <button className="secondary-button" type="button" key={provider.id} disabled={busy}
              onClick={() => void run({ action: 'sso', provider: provider.id })}>{t.sso} · {provider.name}</button>)}
            {state.deployment.registration !== 'disabled' && <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setNotice(undefined) }}>{register ? t.back : t.newAccount}</button>}
            <button className="text-button" disabled={busy} onClick={() => void run({ action: 'recover' })}>{t.recover}</button>
          </> : <>
            <h1>{state.deployment.mode === 'private' ? t.companyOrganization : t.organization}</h1><p>{state.deployment.mode === 'private' ? t.privateOrganizationHint : t.organizationHint}</p><p className="identity">{state.user.email}</p>
            {state.organizations.length === 0 && <p>{state.deployment.mode === 'private' ? t.privateEmpty : t.empty}</p>}
            <div className="teams">{state.organizations.map(org => <button className="team" key={org.id} disabled={busy}
              onClick={() => void run({ action: 'enter', organizationId: org.id })}><span>{org.name}</span><span>{t.enter}</span></button>)}</div>
            {state.deployment.mode === 'open' && <details><summary>{t.create}</summary><form onSubmit={submit('create')}><fieldset disabled={busy}>
              <label>{t.teamName}<input name="name" required maxLength={120} /></label>
              <label>{t.defaultBudget}<select required value={budgetMode}
                onChange={(event) => { setBudgetMode(event.currentTarget.value) }}>
                <option value="" disabled>{t.chooseBudget}</option><option value="limited">{t.limitedBudget}</option><option value="unlimited">{t.unlimitedBudget}</option>
              </select></label>{budgetMode === 'limited' && <label>{t.budgetAmount}<input name="budget" type="number" min="0" step="0.000001" required /></label>}
              <small>{t.budgetPeriod}</small><button type="submit">{t.create}</button>
            </fieldset></form></details>}
            <details><summary>{state.deployment.mode === 'private' ? t.companyJoin : t.join}</summary><p>{t.joinHelp}</p><form onSubmit={submit('join')}><fieldset disabled={busy}>
              <label>{t.invitation}<input name="token" required maxLength={256} autoComplete="off" /></label><button type="submit">{state.deployment.mode === 'private' ? t.companyJoin : t.join}</button>
            </fieldset></form></details>
            <button className="text-button" disabled={busy} onClick={() => void run({ action: 'logout' })}>{t.logout}</button>
          </>}
        {state && notice && <p className="notice" role="status">{t[notice]}</p>}
      </section><footer>{t.local}</footer>
    </div>
    {updateVersion !== null && <aside className="account-update" role="region" aria-label={t.updateTitle}>
      <div className="account-update-heading"><strong>{t.updateTitle}</strong>
        <button type="button" disabled={updateBusy} aria-label={t.dismissUpdate} onClick={() => { void update('dismiss') }}>×</button></div>
      <p role="status">{t.updateAvailable.replace('{version}', updateVersion)}</p>
      <button type="button" disabled={updateBusy} onClick={() => { void update('install') }}>{updateBusy ? t.waiting : t.installUpdate}</button>
      {updateFailed && <p role="alert">{t.updateFailed}</p>}
    </aside>}
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Desktop account root is missing')
createRoot(root).render(<Account />)
