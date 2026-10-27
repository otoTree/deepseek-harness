'use client'

/** Platform desktop release upload and publication status. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { publishDesktopRelease, request } from './client-api'
import { useActivityRevision } from './activity-refresh'
import { zh as t } from './messages'

const listing = z.object({
  apiUrl: z.url(), requirements: z.object({ signingKey: z.boolean(), storage: z.boolean(), https: z.boolean() }),
  configured: z.boolean(), maxBytes: z.number(), releases: z.array(z.object({
    id: z.string(), version: z.string(), target: z.string(), publishedAt: z.string().nullable(),
  })),
})

/** Upload a matching installer/signature pair with cancellation and server-verified publication feedback. */
export default function DesktopReleasesWorkspace() {
  const activityRevision = useActivityRevision()
  const [data, setData] = useState<z.infer<typeof listing>>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const upload = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => upload.current?.abort(), [])
  useEffect(() => {
    let cancelled = false
    void request('/v1/platform/desktop-releases').then((value) => {
      if (!cancelled) { setData(listing.parse(value)); setError('') }
    }).catch((value) => { if (!cancelled) setError(value instanceof Error ? value.message : t.error) })
    return () => { cancelled = true }
  }, [revision, activityRevision])
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const installer = values.get('installer')
    const manifest = values.get('manifest')
    if (!(installer instanceof File) || !(manifest instanceof File)) return
    if (manifest.size > 256 * 1024) { setError(t.desktopManifestTooLarge); return }
    if (data && installer.size > data.maxBytes) { setError(t.desktopUploadLimit + `${Math.floor(data.maxBytes / 1024 / 1024)} MiB`); return }
    const controller = new AbortController()
    upload.current = controller
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await publishDesktopRelease(await manifest.text(), installer, controller.signal)
      setNotice(t.desktopPublished + `${result.version} (${result.target})`)
      form.reset()
    } catch (value) {
      if (controller.signal.aborted) setNotice(t.desktopUploadCancelled)
      else setError(value instanceof Error ? value.message : t.error)
    } finally {
      upload.current = undefined
      setBusy(false)
      setRevision(value => value + 1)
    }
  }
  return <>
    <header className="page-header"><div className="page-heading"><h1>{t.desktopReleases}</h1><p className="page-description">{t.desktopReleaseDescription}</p></div></header>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {notice ? <p className="status-line" role="status">{notice}</p> : null}
    {data && <section className="card desktop-prerequisites"><h2>{t.desktopReleasePrerequisites}</h2><p>{t.desktopReleaseApi}: <code>{data.apiUrl}</code></p><ul>{([
      ['signingKey', t.desktopReleaseKey], ['storage', t.desktopReleaseStorage], ['https', t.desktopReleaseHttps],
    ] as const).map(([key, label]) => <li key={key}>{label}: {data.requirements[key] ? t.desktopReleaseReady : t.desktopReleaseMissing}</li>)}</ul>{!data.configured && <p role="status">{t.desktopReleaseSetup}</p>}</section>}
    <div className="desktop-release-layout"><section className="card desktop-release-upload"><h2>{t.desktopPublish}</h2>
      <p className="muted">{t.desktopReleaseDescription}</p>
      <p className="muted">{t.desktopUploadLimit}{data ? Math.floor(data.maxBytes / 1024 / 1024) : '—'} MiB</p>
      <form onSubmit={event => void publish(event)}>
        <label>{t.desktopInstaller}<input name="installer" type="file" accept=".dmg,.zip" required disabled={busy} /></label>
        <label>{t.desktopSignature}<input name="manifest" type="file" accept=".json" required disabled={busy} /></label>
        <div className="desktop-release-actions"><button className="primary" disabled={busy || !data?.configured}>{busy ? t.desktopUploading : t.desktopPublish}</button>
          {busy ? <button type="button" className="secondary-button" onClick={() => upload.current?.abort()}>{t.cancel}</button> : null}</div>
      </form>
    </section>
    <section className="card desktop-release-list"><div className="card-heading"><h2>{t.desktopReleases}</h2><button className="secondary-button" onClick={() => setRevision(value => value + 1)}>{t.refresh}</button></div>
      <table><thead><tr><th>{t.desktopVersion}</th><th>{t.desktopTarget}</th><th>{t.status}</th><th>{t.desktopPublishedAt}</th></tr></thead>
        <tbody>{data?.releases.map(item => <tr key={item.id}><td>{item.version}</td><td>{item.target}</td><td>{item.publishedAt ? t.desktopReleasePublished : t.desktopDraft}</td><td>{item.publishedAt ? new Date(item.publishedAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</tbody></table>
      {data?.releases.length === 0 ? <p className="muted">{t.noData}</p> : null}
    </section></div>
  </>
}
