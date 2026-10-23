import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { z } from 'zod'
import './global.css'
import { zh } from './messages'

/** Product name used by the administration browser tab. */
export const metadata: Metadata = { title: zh.adminBrand }
/** Shared Web design tokens apply to the administration shell. */
export default async function Layout({ children }: { children: ReactNode }) {
  await connection()
  const apiUrl = z.url({ protocol: /^https?$/ }).parse(process.env.ADMIN_API_URL ?? 'http://127.0.0.1:8787')
  return (
    <html lang="zh-CN">
      <head><meta name="enterprise-api-url" content={apiUrl} /></head>
      <body data-ds-dark-theme="">{children}</body>
    </html>
  )
}
