'use client'

import { useState, useEffect, useCallback } from 'react'

interface CheckIn {
  id: string
  date: string
  status: 'ON_TIME' | 'LATE' | 'MISSED'
  amount: string
}

interface Employer {
  companyName: string
  checkInWindowStart: string
  checkInWindowEnd: string
  timezone: string
  workingDaysPerMonth: number
}

interface EmployeeData {
  id: string
  firstName: string
  lastName: string
  jobTitle: string
  monthlySalary: string
  dailyRate: string
  currency: string
  walletAddress: string | null
  status: string
  employer: Employer
  checkIns: CheckIn[]
}

function formatAmount(amount: string, currency: string) {
  const label = currency === 'CUSD' ? 'cUSD' : currency
  return (
    Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) +
    ' ' +
    label
  )
}

function todayDateString() {
  return new Date().toISOString().split('T')[0] ?? ''
}

function CheckInButton({
  employeeId,
  currency,
  onCheckedIn,
}: {
  employeeId: string
  currency: string
  onCheckedIn: (checkIn: CheckIn) => void
}) {
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle')
  const [showRipple, setShowRipple] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [result, setResult] = useState<CheckIn | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const handlePress = async () => {
    if (state !== 'idle') return
    setState('checking')
    setShowRipple(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}/checkin`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Check-in failed')
      setResult(data)
      setState('done')
      setShowModal(true)
      onCheckedIn(data)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Check-in failed')
      setState('error')
      setShowRipple(false)
    }
  }

  return (
    <>
      <div className="relative flex flex-col items-center py-6">
        <button
          onClick={handlePress}
          disabled={state !== 'idle'}
          className="relative w-36 h-36 rounded-full flex flex-col items-center justify-center select-none transition-transform active:scale-95"
          style={{
            background: state === 'error' ? '#FCEBEB' : '#3DDC84',
            opacity: state !== 'idle' && state !== 'error' ? 0.85 : 1,
          }}
        >
          {showRipple && (
            <span
              className="ripple absolute inset-0 rounded-full"
              style={{ background: '#3DDC84' }}
              onAnimationEnd={() => setShowRipple(false)}
            />
          )}
          <span className="text-2xl" style={{ color: state === 'error' ? '#791F1F' : '#0B3D20' }}>
            {state === 'done' ? '✓' : state === 'checking' ? '…' : state === 'error' ? '!' : '👆'}
          </span>
          <span className="text-sm font-semibold mt-1" style={{ color: state === 'error' ? '#791F1F' : '#0B3D20' }}>
            {state === 'idle' && 'Check in'}
            {state === 'checking' && 'Confirming...'}
            {state === 'done' && 'Checked in'}
            {state === 'error' && 'Try again'}
          </span>
        </button>
        {state === 'error' ? (
          <p className="text-xs mt-4 text-center max-w-xs" style={{ color: '#791F1F' }}>
            {errorMsg}
          </p>
        ) : (
          <p className="text-xs mt-4" style={{ color: '#8A8D91' }}>
            {state === 'done' ? 'Salary released to your wallet' : 'Tap to record today\'s attendance'}
          </p>
        )}
      </div>

      {showModal && result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: 'rgba(22,24,28,0.45)' }}
        >
          <div
            className="pop w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#FFFFFF', border: '2px solid #3DDC84' }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: '#E8FBF0' }}
            >
              <span style={{ color: '#0B3D20' }}>✓</span>
            </div>
            <p className="text-center text-sm mb-1" style={{ color: '#8A8D91' }}>
              {result.status === 'ON_TIME' ? 'On time — salary released on-chain' : 'Checked in late'}
            </p>
            <p className="text-center font-display text-3xl font-semibold mb-4">
              {formatAmount(result.amount, currency)}
            </p>
            <div className="rounded-xl p-3 mb-5 space-y-2 text-sm" style={{ background: '#F4F3EE' }}>
              <div className="flex justify-between">
                <span style={{ color: '#8A8D91' }}>Network</span>
                <span className="font-medium">Celo Sepolia</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: '#8A8D91' }}>Status</span>
                <span
                  className="font-medium"
                  style={{ color: result.status === 'ON_TIME' ? '#1D9E75' : '#854F0B' }}
                >
                  {result.status === 'ON_TIME' ? 'On time' : 'Late'}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowModal(false)}
              className="w-full py-2.5 rounded-full text-sm font-medium"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function EmployeeHomePage() {
  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEmployee = useCallback(async () => {
    try {
      const res = await fetch('/api/employees/me')
      if (!res.ok) throw new Error('Failed to load profile')
      const data = await res.json()
      setEmployee(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEmployee() }, [fetchEmployee])

  const today = todayDateString()

  const todayCheckIn = employee?.checkIns.find(ci => {
    const ciDate = new Date(ci.date).toISOString().split('T')[0] ?? ''
    return ciDate === today
  })

  // This month's earned: sum amounts for current month check-ins
  const now = new Date()
  const monthlyEarned = employee?.checkIns
    .filter(ci => {
      const d = new Date(ci.date)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
    .reduce((sum, ci) => sum + Number(ci.amount), 0) ?? 0

  const daysCheckedIn = employee?.checkIns.filter(ci => {
    const d = new Date(ci.date)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && ci.status !== 'MISSED'
  }).length ?? 0

  const workingDays = employee?.employer.workingDaysPerMonth ?? 22
  const dailyRate = employee?.dailyRate ?? '0'
  const currency = employee?.currency ?? 'USDC'
  const currencyLabel = currency === 'CUSD' ? 'cUSD' : currency

  function handleCheckedIn(ci: CheckIn) {
    setEmployee(prev => {
      if (!prev) return prev
      const withoutToday = prev.checkIns.filter(c => {
        const d = new Date(c.date).toISOString().split('T')[0] ?? ''
        return d !== today
      })
      return { ...prev, checkIns: [ci, ...withoutToday] }
    })
  }

  function truncateAddress(addr: string | null) {
    if (!addr) return '—'
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`
  }

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

  return (
    <div className="space-y-5">
      {/* Check-in card */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <div className="flex items-center justify-between mb-1">
          <div>
            <span className="text-sm" style={{ color: '#8A8D91' }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <p className="font-display text-base font-semibold mt-0.5" style={{ color: '#16181C' }}>
              Hi, {employee.firstName}
            </p>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full"
            style={
              employee.status === 'ACTIVE'
                ? { background: '#E8FBF0', color: '#1D9E75' }
                : { background: '#FEF3DD', color: '#854F0B' }
            }
          >
            {employee.status === 'ACTIVE' ? 'Active' : employee.status}
          </span>
        </div>

        {todayCheckIn ? (
          <div className="flex flex-col items-center py-8 space-y-3">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-3xl"
              style={{ background: '#E8FBF0' }}
            >
              ✓
            </div>
            <p className="font-display text-base font-semibold" style={{ color: '#16181C' }}>
              {todayCheckIn.status === 'ON_TIME' ? 'Checked in on time' : 'Checked in late'}
            </p>
            <p className="text-sm" style={{ color: '#8A8D91' }}>
              {formatAmount(todayCheckIn.amount, currency)} released today
            </p>
            <span
              className="text-xs px-2.5 py-1 rounded-full"
              style={
                todayCheckIn.status === 'ON_TIME'
                  ? { background: '#E8FBF0', color: '#1D9E75' }
                  : { background: '#FEF3DD', color: '#854F0B' }
              }
            >
              {todayCheckIn.status === 'ON_TIME' ? 'On time' : 'Late'}
            </span>
          </div>
        ) : (
          <CheckInButton
            employeeId={employee.id}
            currency={currency}
            onCheckedIn={handleCheckedIn}
          />
        )}

        <div className="text-center text-xs mt-2" style={{ color: '#8A8D91' }}>
          Window: {employee.employer.checkInWindowStart} – {employee.employer.checkInWindowEnd}
        </div>
      </div>

      {/* Earnings summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border p-4" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
          <p className="text-xs mb-1" style={{ color: '#8A8D91' }}>This month earned</p>
          <p className="font-display text-xl font-semibold">
            {monthlyEarned.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {currencyLabel}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#1D9E75' }}>
            {daysCheckedIn} of {workingDays} days
          </p>
        </div>
        <div className="rounded-2xl border p-4" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
          <p className="text-xs mb-1" style={{ color: '#8A8D91' }}>Daily rate</p>
          <p className="font-display text-xl font-semibold">
            {formatAmount(dailyRate, currency)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>Per check-in</p>
        </div>
      </div>

      {/* Wallet */}
      <div className="rounded-2xl p-5" style={{ background: '#16181C' }}>
        <p className="text-sm font-medium mb-2" style={{ color: '#FFFFFF' }}>Wallet</p>
        <p
          className="text-sm mb-1 break-all"
          style={{ fontFamily: 'var(--font-jbmono)', color: '#A8ACB1' }}
        >
          {truncateAddress(employee.walletAddress)}
        </p>
        <p className="text-xs" style={{ color: '#A8ACB1' }}>
          {employee.employer.companyName} · {currencyLabel} payroll
        </p>
      </div>
    </div>
  )
}
