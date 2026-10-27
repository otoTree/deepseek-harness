'use client'

/** Enterprise identity connection editor. */
import { useEffect, useState, type FormEvent } from 'react'
import { zh as t } from './messages'

type IdentityProtocol = keyof typeof t.identityProtocols
export type IdentityProviderForm = { name: string; protocol: IdentityProtocol; issuer?: string; config: Record<string, string> }

/** Edit an enterprise identity connection without displaying stored credentials. */
export function IdentityProviderModal({ open, busy, provider, onClose, onSubmit, submitError }: { open: boolean
  busy: boolean
  submitError?: string
  provider?: Record<string, unknown>
  onClose: () => void
  onSubmit: (value: IdentityProviderForm) => void }) {
  const [protocol, setProtocol] = useState<IdentityProtocol>('oidc')
  const [values, setValues] = useState<Record<string, string>>({ name: '', issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '' })
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setProtocol((provider?.protocol as IdentityProtocol) ?? 'oidc')
    const config = provider?.config && typeof provider.config === 'object' ? provider.config : {}
    setValues({ name: String(provider?.name ?? ''), issuer: String(provider?.issuer ?? ''),
      scopes: 'openid profile email', ...Object.fromEntries(Object.entries(config).filter(([, value]) => typeof value === 'string')),
      clientSecret: '', bindPassword: '' })
    setError('')
  }, [open, provider])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, onClose])
  if (!open) return null
  const update = (key: string, value: string) => setValues(current => ({ ...current, [key]: value }))
  const changeProtocol = (next: IdentityProtocol) => {
    setProtocol(next)
    setError('')
    const defaults: Record<string, string> = next === 'oidc'
      ? { name: values.name, issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '' }
      : next === 'oauth2'
        ? { name: values.name, authorizationUrl: '', tokenUrl: '', userInfoUrl: '', clientId: '', clientSecret: '', scopes: '', redirectUri: '' }
        : next === 'saml'
          ? { name: values.name, entityId: '', metadataUrl: '', ssoUrl: '', certificate: '', emailAttribute: 'email' }
          : { name: values.name, ldapUrl: 'ldap://', baseDn: '', bindDn: '', bindPassword: '', userBaseDn: '', userFilter: '(&(objectClass=inetOrgPerson)(uid=*))', usernameAttribute: 'uid', displayNameAttribute: 'displayName', emailAttribute: 'mail', membershipMode: 'user_attribute', groupBaseDn: '', groupFilter: '(objectClass=organizationalUnit)', groupNameAttribute: 'ou', memberAttribute: 'ou' }
    setValues(defaults)
  }
  const field = (key: string, label: string, type: 'text' | 'url' | 'password' | 'textarea' = 'text', required = true) => <label key={key}>{label}{type === 'textarea' ? <textarea rows={4} disabled={busy} value={values[key] ?? ''} onChange={event => update(key, event.target.value)} required={required} /> : <input type={type} disabled={busy} value={values[key] ?? ''} onChange={event => update(key, event.target.value)} required={required} />}</label>
  const jsonConfig = Object.fromEntries(Object.entries(values).filter(([key, value]) => key !== 'name' && key !== 'issuer' && value.trim() !== ''))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!values.name.trim()) return
    if (protocol === 'saml' && !(values.metadataUrl ?? '').trim() && !(values.ssoUrl ?? '').trim()) { setError(t.samlEndpointRequired); return }
    if (protocol === 'ldap' && !(values.ldapUrl ?? '').trim()) { setError(t.ldapUrlRequired); return }
    setError('')
    onSubmit({ name: values.name.trim(), protocol, ...((values.issuer ?? '').trim() ? { issuer: (values.issuer ?? '').trim() } : {}), config: jsonConfig })
  }
  const protocolFields = protocol === 'oidc'
    ? <>{field('issuer', t.issuer, 'url')}{field('clientId', t.clientId)}{field('clientSecret', t.clientSecret, 'password', !provider)}{field('scopes', t.scopes)}{field('redirectUri', t.redirectUri, 'url', false)}</>
    : protocol === 'oauth2'
      ? <>{field('authorizationUrl', t.authorizationUrl, 'url')}{field('tokenUrl', t.tokenUrl, 'url')}{field('userInfoUrl', t.userInfoUrl, 'url')}{field('clientId', t.clientId)}{field('clientSecret', t.clientSecret, 'password', false)}{field('scopes', t.scopes, 'text', false)}{field('redirectUri', t.redirectUri, 'url', false)}</>
      : protocol === 'saml'
        ? <>{field('entityId', t.entityId)}{field('metadataUrl', t.metadataUrl, 'url', false)}{field('ssoUrl', t.ssoUrl, 'url', false)}{field('certificate', t.certificate, 'textarea', false)}{field('emailAttribute', t.emailAttribute)}</>
        : <>{field('ldapUrl', t.ldapUrl, 'url')}{field('baseDn', t.baseDn)}{field('bindDn', t.bindDn)}{field('bindPassword', t.bindPassword, 'password', !provider)}{field('userBaseDn', t.userBaseDn, 'text', false)}{field('userFilter', t.userFilter, 'text', false)}{field('usernameAttribute', t.usernameAttribute)}{field('displayNameAttribute', t.displayNameAttribute)}{field('emailAttribute', t.emailAttribute)}<label>{t.membershipMode}<select disabled={busy} value={values.membershipMode ?? 'user_attribute'} onChange={event => update('membershipMode', event.target.value)}>{Object.entries(t.membershipModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{field('groupBaseDn', t.groupBaseDn, 'text', false)}{field('groupFilter', t.groupFilter, 'text', false)}{field('groupNameAttribute', t.groupNameAttribute, 'text', false)}{field('memberAttribute', t.memberAttribute, 'text', false)}</>
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="identity-provider-modal-title"><div className="modal-heading"><div><p className="eyebrow">{t.identityProviders}</p><h2 id="identity-provider-modal-title">{t.configure}</h2></div><button className="icon-button" type="button" disabled={busy} data-dialog-close onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.identityProtocolDescriptions[protocol]}</p><p className="muted">{t.enterpriseAdmin.loginSupport}</p><p className="muted">{t.enterpriseAdmin.keepSecrets}</p><form className="grid-form" onSubmit={submit}><label>{t.name}<input disabled={busy} value={values.name ?? ''} onChange={event => update('name', event.target.value)} required /></label><label>{t.protocol}<select disabled={busy} value={protocol} onChange={event => changeProtocol(event.target.value as IdentityProtocol)}>{Object.entries(t.identityProtocols).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{protocolFields}{(error || submitError) ? <p className="error full-width" role="alert">{error || submitError}</p> : null}<div className="modal-actions full-width"><button type="button" disabled={busy} data-dialog-close onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy}>{busy ? t.loading : t.confirm}</button></div></form></section></div>
}
