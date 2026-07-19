export const DEFAULT_WORKING_DAYS_PER_MONTH = 22

export const DEFAULT_CHECK_IN_WINDOW = {
  start: '07:00',
  end: '10:00',
} as const

export const INVITE_CODE_EXPIRY_DAYS = 7

export const MIN_BUFFER_MONTHS = 2

export const MAX_ADVANCE_PERCENT = 0.5 // 50% of monthly salary

export const ABSENT_PENALTY_PERCENT = 0.1 // 10% of next day's pay

export const TREASURY_ALERT_THRESHOLD_MONTHS = 1 // alert when < 1 month buffer

export const TREASURY_CRITICAL_THRESHOLD_WEEKS = 2 // critical when < 2 weeks

export const LEAVE_DEFAULTS = {
  ANNUAL: 21,        // days/year
  SICK: 10,
  MATERNITY: 112,    // 16 weeks in days
  PATERNITY: 5,
  STUDY: 5,
  COMPASSIONATE: 3,
  UNPAID: Infinity,
} as const

export const REQUEST_AUTO_APPROVE_HOURS = 48

/** Date as YYYYMMDD integer — used as idempotency key in PayrollTreasury */
export function dateToUint(date: Date): number {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return Number(`${y}${m}${d}`)
}
