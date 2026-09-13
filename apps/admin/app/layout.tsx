import type { ReactNode } from 'react'
import './global.css'
/** Shared Web design tokens apply to the administration shell. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
