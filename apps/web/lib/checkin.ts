import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz'

/** Date-only key for a company-local calendar day, represented at UTC midnight. */
export function getCompanyDate(now: Date, timezone: string): Date {
  return new Date(`${formatInTimeZone(now, timezone, 'yyyy-MM-dd')}T00:00:00.000Z`)
}

/**
 * Returns 'ON_TIME', 'LATE', or null if outside window.
 */
export function isWithinCheckInWindow(
  now: Date,
  windowStart: string,
  windowEnd: string,
  timezone: string
): 'ON_TIME' | 'LATE' | null {
  const localNow = toZonedTime(now, timezone)
  const localHour = localNow.getHours()
  const localMinute = localNow.getMinutes()
  const currentMinutes = localHour * 60 + localMinute

  const [startH, startM] = windowStart.split(':').map(Number)
  const [endH, endM] = windowEnd.split(':').map(Number)
  const startMinutes = (startH ?? 0) * 60 + (startM ?? 0)
  const endMinutes = (endH ?? 0) * 60 + (endM ?? 0)

  if (currentMinutes < startMinutes || currentMinutes > endMinutes) return null

  // Grace: first 30 mins of window = ON_TIME, remainder = LATE
  const graceCutoff = startMinutes + 30
  return currentMinutes <= graceCutoff ? 'ON_TIME' : 'LATE'
}

export function getWindowBounds(
  date: Date,
  windowStart: string,
  windowEnd: string,
  timezone: string
): { start: Date; end: Date } {
  const [startH, startM] = windowStart.split(':').map(Number)
  const [endH, endM] = windowEnd.split(':').map(Number)

  const localMidnight = toZonedTime(date, timezone)
  localMidnight.setHours(0, 0, 0, 0)

  const localStart = new Date(localMidnight)
  localStart.setHours(startH ?? 0, startM ?? 0)

  const localEnd = new Date(localMidnight)
  localEnd.setHours(endH ?? 0, endM ?? 0)

  return {
    start: fromZonedTime(localStart, timezone),
    end: fromZonedTime(localEnd, timezone),
  }
}
