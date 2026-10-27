'use client'

/** Public account recovery and invitations share Better Auth with the native desktop entry. */
import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { request } from '../client-api'
import { zh } from '../messages'

const t = zh.accountEntry

/** Account entry accepts invitation and reset tokens only from its own URL.
 * @returns Public sign-in, invitation, verification, and password recovery controls.
 */
export default function AccountPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | 'reset'>('login')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState('')
  const [invitation, setInvitation] = useState(''), [resetToken, setResetToken] = useState('')
  const [signedIn, setSignedIn] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [invite, setInvite] = useState<{ email: string; organizationId: string; expiresAt: string; accepted: boolean }>()
  const [canRegister, setCanRegister] = useState(false)
  const [downloads, setDownloads] = useState<{ target: string; version: string; url: string }[]>([])
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search)
    setInvitation(parameters.get('invitation') ?? '')
    const token = parameters.get('token') ?? ''
    if (token) { setResetToken(token); setMode('reset') }
    if (parameters.has('error')) setNotice(t.invalidLink)
    void request('/auth/deployment').then((value) => { const policy = z.object({ registration: z.string() }).parse(value); setCanRegister(['open', 'domain_restricted'].includes(policy.registration)) }).catch(() => { setCanRegister(false) })
    void request('/desktop/downloads').then(value => setDownloads(z.array(z.object({ target: z.string(), version: z.string(), url: z.url() })).parse(value))).catch(() => { setDownloads([]) })
    void request('/v1/me').then(() => setSignedIn(true)).catch(() => { /* Anonymous entry has no authenticated session. */ })
    void request('/auth/sso/providers').then(value => setProviders(z.array(z.object({ id: z.string(), name: z.string() })).parse(value))).catch(() => { setProviders([]) })
  }, [])
  useEffect(() => {
    if (!signedIn || !invitation) return
    let disposed = false
    void request('/v1/invitations/' + encodeURIComponent(invitation)).then((value) => {
      if (!disposed) setInvite(z.object({ email: z.string(), organizationId: z.string(), expiresAt: z.string(),
        accepted: z.boolean() }).parse(value))
    }).catch((error) => { if (!disposed) setNotice(error instanceof Error ? error.message : t.failed) })
    return () => { disposed = true }
  }, [signedIn, invitation])
  async function perform(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setNotice('')
    try { await work() } catch (error) { setNotice(error instanceof Error ? error.message : t.failed) } finally { setBusy(false) }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void perform(async () => {
      const callback = new URL('/account', window.location.origin)
      if (invitation) callback.searchParams.set('invitation', invitation)
      if (mode === 'recover') {
        await request('/auth/request-password-reset', 'POST', { email, redirectTo: callback.href }); setNotice(t.mailSent)
      } else if (mode === 'reset') {
        await request('/auth/reset-password', 'POST', { token: resetToken, newPassword: password })
        setPassword(''); setResetToken(''); setMode('login'); setNotice(t.passwordReset)
        window.history.replaceState(null, '', callback.pathname + callback.search)
      } else {
        await request(mode === 'register' ? '/auth/sign-up/email' : '/auth/sign-in/email', 'POST', { email, password,
          callbackURL: callback.href, ...(mode === 'register' ? { name } : {}) })
        setPassword('')
        if (mode === 'register') { setMode('login'); setNotice(t.registered) }
        else { setSignedIn(true); setNotice(t.signedIn) }
      }
    })
  }
  return <main className="login"><section className="login-brand"><div className="brand-lockup"><img className="brand-mark" src="/admin/brand.png" width={32} height={32} alt="" /><span className="wordmark">{zh.adminBrand}</span></div><div className="login-hero"><h1>{zh.loginHeroTitle}</h1><p>{t.intro}</p></div><p className="login-note">{zh.managementScope}</p></section>
    <section className="login-form-panel"><h2>{signedIn ? t.signedIn : t[mode]}</h2>
      {!signedIn && <div className="actions">{(['login', 'register', 'recover'] as const).filter(value => value !== 'register' || canRegister).map(value => <button className={mode === value ? 'selected' : ''} key={value} disabled={busy} onClick={() => setMode(value)}>{t[value]}</button>)}</div>}
      {!signedIn && <form onSubmit={submit}><fieldset disabled={busy}>
        {mode === 'register' && <label>{t.name}<input required value={name} onChange={event => setName(event.target.value)} autoComplete="name" /></label>}
        {mode !== 'reset' && <label>{t.email}<input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>}
        {mode !== 'recover' && <label>{t.password}<input required type="password" minLength={mode === 'login' ? 1 : 12} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>}
        <button className="primary" type="submit">{busy ? t.waiting : t[mode]}</button>
      </fieldset></form>}

      {!signedIn && providers.map(provider => <button key={provider.id} disabled={busy} onClick={() => void perform(async () => {
        const value = z.object({ url: z.url() }).parse(await request('/auth/sign-in/social', 'POST', { provider: provider.id, callbackURL: window.location.href, disableRedirect: true }))
        window.location.assign(value.url)
      })}>{t.sso} · {provider.name}</button>)}
      {!signedIn && mode !== 'reset' && <button disabled={busy || !email} onClick={() => void perform(async () => {
        await request('/auth/send-verification-email', 'POST', { email, callbackURL: window.location.href }); setNotice(t.mailSent)
      })}>{t.verify}</button>}
      {signedIn && invite &&
        <section><p>{invite.email} · {invite.organizationId}</p><p>{t.expires} {new Date(invite.expiresAt).toLocaleString()}</p>
          <button disabled={busy || invite.accepted} onClick={() => void perform(async () => {
            await request('/v1/invitations/accept', 'POST', { token: invitation })
            setInvite({ ...invite, accepted: true }); setNotice(t.accepted)
          })}>{invite.accepted ? t.accepted : t.accept}</button></section>}
      {signedIn && <><p>{t.desktop}</p>
        {downloads.map(item => <a key={item.target} href={item.url}>{t.download} · {item.target} · {item.version}</a>)}
        <button disabled={busy} onClick={() => void perform(async () => {
          await request('/auth/sign-out', 'POST', {}); setSignedIn(false); setInvite(undefined)
        })}>{t.signOut}</button></>}
      <p role="status">{notice}</p>
    </section></main>
}
