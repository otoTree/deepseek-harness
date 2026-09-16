const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

interface CalendarDate {
  readonly utcDay: number
}

function calendarDate(value: string): CalendarDate | undefined {
  const match = datePattern.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utcDay = Date.UTC(year, month - 1, day)
  const normalized = new Date(utcDay).toISOString().slice(0, 10)
  return normalized === value ? { utcDay } : undefined
}

/** Return the Asia/Shanghai calendar date containing the supplied instant. */
export function shanghaiDate(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

/** Shift an ISO calendar date without consulting the host timezone. */
export function shiftCalendarDate(value: string, days: number): string | undefined {
  const parsed = calendarDate(value)
  if (!parsed || !Number.isInteger(days)) return undefined
  return new Date(parsed.utcDay + days * DAY_MS).toISOString().slice(0, 10)
}

/** Build an inclusive Asia/Shanghai date range for the bounded usage API. */
export function usageRange(from: string, to: string): { from: string; to: string } | undefined {
  const first = calendarDate(from)
  const last = calendarDate(to)
  if (!first || !last) return undefined
  const days = (last.utcDay - first.utcDay) / DAY_MS + 1
  if (days < 1 || days > 366) return undefined
  return {
    from: new Date(first.utcDay - SHANGHAI_OFFSET_MS).toISOString(),
    to: new Date(last.utcDay + DAY_MS - SHANGHAI_OFFSET_MS).toISOString(),
  }
}
