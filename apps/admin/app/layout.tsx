import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { z } from 'zod'
import './fonts.css'
import './global.css'
import { zh } from './messages'
import ActivityRefresh from './activity-refresh'

/** Product name used by the administration browser tab. */
export const metadata: Metadata = { title: zh.adminBrand }
/** Shared Web design tokens apply to the administration shell. */
export default async function Layout({ children }: { children: ReactNode }) {
  await connection()
  const apiUrl = z.url({ protocol: /^https?$/ }).parse(process.env.ADMIN_API_URL ?? 'http://127.0.0.1:8787')
  const refreshMs = z.coerce.number().int().min(1000).max(3600000).parse(process.env.ADMIN_ACTIVITY_REFRESH_MS ?? 30000)
  return (
    <html lang="zh-CN">
      <head><meta name="enterprise-api-url" content={apiUrl} /></head>
      <body data-admin-theme="light"><ActivityRefresh intervalMs={refreshMs} />{children}</body>
    </html>
  )
}
