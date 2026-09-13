/** Bundled account UI talks only to its native loopback host, never to an admin page. */
import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { accountState, type AccountAction } from '../contracts.ts'
import { accountMessages } from './account-messages.ts'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import './account.css'

const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? ''
type State = ReturnType<typeof accountState.parse>

function Account() {
  const [locale, setLocale] = useState<'en' | 'zh'>(navigator.language.startsWith('zh') ? 'zh' : 'en')
  const t = accountMessages[locale]
  const [state, setState] = useState<State>()
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<keyof typeof t>()
  useEffect(() => { document.title = t.brand; document.documentElement.lang = locale }, [locale, t.brand])
  async function refresh() {
    const response = await fetch('/account/state', { headers: { 'X-Desktop-Token': token }, cache: 'no-store' })
    if (!response.ok) throw new Error('Account state unavailable')
    setState(accountState.parse(await response.json()))
  }
  useEffect(() => { void refresh().catch(() => setNotice('failed')) }, [])
  async function run(input: AccountAction) {
    if (busy) return
    setBusy(true); setNotice(input.action === 'enter' ? 'starting' : undefined)
    try {
      const response = await fetch('/account/action', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Desktop-Token': token }, body: JSON.stringify(input) })
      if (!response.ok) {
        setNotice(input.action === 'enter' ? 'startFailed' : response.status === 403 ? 'denied'
          : response.status === 409 ? 'conflict' : response.status === 429 ? 'limited'
            : response.status < 500 ? 'invalid' : 'failed')
        return
      }
      if (input.action === 'enter') return
      if (input.action === 'register') { setRegister(false); setNotice('registered') }
      await refresh()
    } catch { setNotice(input.action === 'enter' ? 'startFailed' : 'failed') } finally { setBusy(false) }
  }
  function submit(action: 'login' | 'register' | 'create' | 'join') {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const value = (key: string) => String(data.get(key) ?? '')
      const input: AccountAction = action === 'login' ? { action, email: value('email'), password: value('password') }
        : action === 'register' ? { action, email: value('email'), password: value('password'), name: value('name') }
          : action === 'create' ? { action, name: value('name') } : { action, token: value('token') }
      // Passwords and invitation values are not retained in component state.
      event.currentTarget.reset()
      void run(input)
    }
  }
  return <main className="account-shell">
    <header><span className="brand">{t.brand}</span><select aria-label={t.language} value={locale}
      onChange={event => setLocale(event.target.value === 'zh' ? 'zh' : 'en')}>
      <option value="zh">{t.chinese}</option><option value="en">{t.english}</option></select></header>
    <section className="account-content" aria-busy={busy}>
      {!state ? <><h1>{t.brand}</h1><p>{notice ? t[notice] : t.waiting}</p>
        {notice && <button onClick={() => { setNotice(undefined); void refresh().catch(() => setNotice('failed')) }}>{t.retry}</button>}</>
        : !state.user ? <>
          <h1>{register ? t.registerTitle : t.welcome}</h1><p>{register ? t.registerSubtitle : t.subtitle}</p>
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
          <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setNotice(undefined) }}>{register ? t.back : t.newAccount}</button>
        </> : <>
          <h1>{t.organization}</h1><p>{t.organizationHint}</p><p className="identity">{state.user.email}</p>
          {state.organizations.length === 0 && <p>{t.empty}</p>}
          <div className="teams">{state.organizations.map(org => <button className="team" key={org.id} disabled={busy}
            onClick={() => void run({ action: 'enter', organizationId: org.id })}><span>{org.name}</span><span>{t.enter}</span></button>)}</div>
          <details><summary>{t.create}</summary><form onSubmit={submit('create')}><fieldset disabled={busy}>
            <label>{t.teamName}<input name="name" required maxLength={120} /></label><button type="submit">{t.create}</button>
          </fieldset></form></details>
          <details><summary>{t.join}</summary><form onSubmit={submit('join')}><fieldset disabled={busy}>
            <label>{t.invitation}<input name="token" required maxLength={256} autoComplete="off" /></label><button type="submit">{t.join}</button>
          </fieldset></form></details>
          <button className="text-button" disabled={busy} onClick={() => void run({ action: 'logout' })}>{t.logout}</button>
        </>}
      {state && notice && <p className="notice" role="status">{t[notice]}</p>}
    </section><footer>{t.local}</footer>
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Desktop account root is missing')
createRoot(root).render(<Account />)
