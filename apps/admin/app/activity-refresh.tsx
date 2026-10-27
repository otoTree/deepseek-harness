'use client'

/** Refresh active administration resources at the deployment's configured interval. */
import { useEffect, useState } from 'react'

/** @returns A revision incremented by visible-page refresh broadcasts. */
export function useActivityRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('enterprise-admin-refresh', refresh)
    return () => window.removeEventListener('enterprise-admin-refresh', refresh)
  }, [])
  return revision
}

/**
 * Broadcast refresh requests only while the administrator can see the page.
 * @param props Server-validated refresh period.
 * @returns No visible content.
 */
export default function ActivityRefresh({ intervalMs }: { intervalMs: number }) {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') window.dispatchEvent(new Event('enterprise-admin-refresh'))
    }
    const timer = window.setInterval(refresh, intervalMs)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [intervalMs])
  return null
}
