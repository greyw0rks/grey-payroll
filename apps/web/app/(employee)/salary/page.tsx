'use client'

import { useState, useEffect } from 'react'

interface CheckIn {
  id: string
  date: string
  status: 'ON_TIME' | 'LATE' | 'MISSED'
  amount: string
}

interface EmployeeData {
  id: string
  firstName: string
  monthlySalary: string
  dailyRate: string
  currency: string
  employer: {
    workingDaysPerMonth: number
  }
  checkIns: CheckIn[]
}

type DayKind = 'ON_TIME' | 'LATE' | 'MISSED' | 'WEEKEND' | 'FUTURE' | 'BLANK'

const DAY_COLORS: Record<DayKind, string> = {
  ON_TIME: '#3DDC84',
  LATE:    '#F6AD55',
  MISSED:  '#791F1F',
  WEEKEND: '#F4F3EE',
  FUTURE:  'transparent',
  BLANK:   'transparent',
}

const DAY_TEXT: Record<DayKind, string> = {
  ON_TIME: '#0B3D20',
  LATE:    '#7B3B00',
  MISSED:  '#FFFFFF',
  WEEKEND: '#8A8D91',
  FUTURE:  '#8A8D91',
  BLANK:   'transparent',
}

function formatAmount(amount: string | number, currency: string) {
  const label = currency === 'CUSD' ? 'cUSD' : currency
  return (
    Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) +
    ' ' +
    label
  )
}

function isWeekend(year: number, month: number, day: number): boolean {
  const d = new Date(year, month, day).getDay()
  return d === 0 || d === 6
}

export default function SalaryPage() {
  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/employees/me')
        if (!res.ok) throw new Error('Failed to load salary data')
        const data = await res.json()
        setEmployee(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
          <p className="text-sm" style={{ color: '#8A8D91' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error || !employee) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
          <p className="text-sm" style={{ color: '#791F1F' }}>{error ?? 'Failed to load'}</p>
        </div>
      </div>
    )
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0-indexed
  const today = now.getDate()

  const monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // Day of week the month starts on (0=Sun)
  const firstDayOfWeek = new Date(year, month, 1).getDay()

  // Build checkIn lookup: "YYYY-MM-DD" -> CheckIn
  const checkInMap = new Map<string, CheckIn>()
  for (const ci of employee.checkIns) {
    const key = new Date(ci.date).toISOString().split('T')[0] ?? ''
    if (key) checkInMap.set(key, ci)
  }

  function getDayKind(day: number): DayKind {
    if (day > today) return 'FUTURE'
    if (isWeekend(year, month, day)) return 'WEEKEND'
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const ci = checkInMap.get(key)
    if (ci) return ci.status
    return 'MISSED'
  }

  // Calendar cells: leading blanks + days
  const blanks = Array.from({ length: firstDayOfWeek }, (_, i) => i)
  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  // Monthly breakdown
  const currency = employee.currency
  const workingDays = employee.employer.workingDaysPerMonth
  const dailyRate = Number(employee.dailyRate)
  const monthlySalary = Number(employee.monthlySalary)

  const thisMonthCIs = employee.checkIns.filter(ci => {
    const d = new Date(ci.date)
    return d.getFullYear() === year && d.getMonth() === month
  })

  const earnedTotal = thisMonthCIs.reduce((sum, ci) => sum + Number(ci.amount), 0)
  const missedDays = thisMonthCIs.filter(ci => ci.status === 'MISSED').length
  const checkedInDays = thisMonthCIs.filter(ci => ci.status !== 'MISSED').length

  return (
    <div className="space-y-5">
      {/* Calendar */}
      <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <p className="text-sm font-medium mb-4">{monthName}</p>
        <div className="grid grid-cols-7 gap-1.5 mb-4">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={i} className="text-center text-xs font-medium" style={{ color: '#8A8D91' }}>{d}</span>
          ))}
          {/* Leading blanks */}
          {blanks.map(i => (
            <div key={`blank-${i}`} className="aspect-square" />
          ))}
          {/* Days */}
          {dayNumbers.map(day => {
            const kind = getDayKind(day)
            const bg = DAY_COLORS[kind]
            const textColor = DAY_TEXT[kind]
            const isFuture = kind === 'FUTURE'
            return (
              <div
                key={day}
                className="aspect-square rounded-md flex items-center justify-center text-xs font-medium"
                style={{
                  background: bg,
                  border: isFuture ? '1px dashed #ECEBE6' : 'none',
                  color: textColor,
                }}
              >
                {day}
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 text-xs flex-wrap" style={{ color: '#8A8D91' }}>
          {[
            { label: 'On time', bg: '#3DDC84' },
            { label: 'Late',    bg: '#F6AD55' },
            { label: 'Missed',  bg: '#791F1F' },
            { label: 'Weekend', bg: '#F4F3EE' },
          ].map(({ label, bg }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: bg }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Monthly breakdown */}
      <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <p className="text-sm font-medium mb-1">Monthly breakdown</p>
        <p className="text-xs mb-4" style={{ color: '#8A8D91' }}>
          {workingDays} working days × {formatAmount(dailyRate, currency)} daily rate
        </p>
        <div className="space-y-2.5 text-sm">
          <div className="flex justify-between">
            <span style={{ color: '#8A8D91' }}>Monthly salary</span>
            <span className="font-medium">{formatAmount(monthlySalary, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: '#8A8D91' }}>Checked in this month</span>
            <span className="font-medium">{checkedInDays} days</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: '#8A8D91' }}>Earned to date</span>
            <span className="font-medium">{formatAmount(earnedTotal, currency)}</span>
          </div>
          {missedDays > 0 && (
            <div className="flex justify-between border-t pt-2.5" style={{ borderColor: '#ECEBE6' }}>
              <span style={{ color: '#8A8D91' }}>Missed ({missedDays} day{missedDays > 1 ? 's' : ''})</span>
              <span className="font-medium" style={{ color: '#791F1F' }}>
                -{formatAmount(dailyRate * missedDays, currency)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
