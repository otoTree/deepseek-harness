'use client'

import { useId } from 'react'
import { zh as t } from './messages'

/** Plot settled daily costs from the displayed API range, including zero-cost days.
 * @param props Daily records in chronological order.
 * @returns Accessible cost chart and date labels, or the localized empty state.
 */
export default function CostTrend({ items }: { items: Array<Record<string, unknown>> }) {
  const id = useId()
  if (!items.length) return <div className="chart-empty">{t.noUsageInRange}</div>
  const costs = items.map(item => Number(item.totalCostMicrosCny) / 1_000_000)
  const maximum = Math.max(...costs, 0.01)
  const points = costs.map((cost, index) => `${24 + index * 652 / Math.max(items.length - 1, 1)},${196 - cost / maximum * 160}`)
  return <div className="cost-trend"><svg viewBox="0 0 700 225" role="img" aria-labelledby={id} preserveAspectRatio="none"><title id={id}>{t.platformCostTrend}</title>{[0, 1, 2, 3, 4].map(line => <line key={line} x1="24" y1={36 + line * 40} x2="676" y2={36 + line * 40} stroke="var(--admin-border)" />)}<polygon points={`24,196 ${points.join(' ')} ${items.length > 1 ? '676' : '24'},196`} fill="var(--admin-blue-pale)" /><polyline points={points.join(' ')} fill="none" stroke="var(--admin-primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />{points.map((point, index) => { const [cx, cy] = point.split(','); return <circle key={index} cx={cx} cy={cy} r="3" fill="var(--admin-primary)"><title>{String(items[index].day)} · ¥{costs[index].toFixed(6)}</title></circle> })}</svg><div className="cost-trend-dates">{items.filter((_, index) => index === 0 || index === items.length - 1 || index % Math.max(1, Math.ceil(items.length / 4)) === 0).map(item => <span key={String(item.day)}>{String(item.day).slice(5)}</span>)}</div></div>
}
