'use client'

import { formatMoney } from '@/lib/money'
import { useState, useEffect } from 'react'
import { WalletSettings } from '@/components/employee/WalletSettings'

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
  startDate: string
  employer: {
    companyName: string
    workingDaysPerMonth: number
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ACTIVE:     ['#1D9E75', '#E8FBF0'],
    PENDING:    ['#854F0B', '#FEF3DD'],
    TERMINATED: ['#791F1F', '#FCEBEB'],
  }
  const [color, bg] = map[status] ?? ['#8A8D91', '#F4F3EE']
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ color, background: bg }}>
      {label}
    </span>
  )
}

function formatAmount(amount: string, currency: string) {
  return formatMoney(String(amount), currency)
}

export default function ProfilePage() {
  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
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
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <p className="text-sm" style={{ color: '#8A8D91' }}>Loading…</p>
      </div>
    )
  }

  if (error || !employee) {
    return (
      <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <p className="text-sm" style={{ color: '#791F1F' }}>{error ?? 'Failed to load'}</p>
      </div>
    )
  }

  const initials = (employee.firstName[0] ?? '') + (employee.lastName[0] ?? '')
  const currencyLabel = employee.currency === 'LEGACY_ASSET' ? 'Historical asset' : employee.currency

  return (
    <div className="space-y-4">
      {/* Avatar + Name */}
      <div
        className="rounded-2xl border p-5 flex items-center gap-4"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center font-display text-lg font-semibold shrink-0"
          style={{ background: '#E8FBF0', color: '#0B3D20' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-display font-semibold text-base" style={{ color: '#16181C' }}>
              {employee.firstName} {employee.lastName}
            </p>
            <StatusPill status={employee.status} />
          </div>
          <p className="text-sm" style={{ color: '#8A8D91' }}>
            {employee.jobTitle} · {employee.employer.companyName}
          </p>
        </div>
      </div>

      {/* Details */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: '#ECEBE6' }}>
          <h2 className="font-display text-sm font-semibold" style={{ color: '#16181C' }}>Employment details</h2>
        </div>
        <div className="divide-y" style={{ borderColor: '#ECEBE6' }}>
          {[
            { label: 'Monthly salary', value: formatAmount(employee.monthlySalary, employee.currency) },
            { label: 'Daily rate', value: formatAmount(employee.dailyRate, employee.currency) },
            { label: 'Currency', value: currencyLabel },
            { label: 'Working days / month', value: String(employee.employer.workingDaysPerMonth) },
            {
              label: 'Start date',
              value: new Date(employee.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-5 py-3.5 text-sm">
              <span style={{ color: '#8A8D91' }}>{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Wallet */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <p className="text-xs font-medium mb-2" style={{ color: '#8A8D91' }}>Wallet address</p>
        {employee.walletAddress ? (
          <p
            className="text-sm break-all"
            style={{ fontFamily: 'var(--font-jbmono)', color: '#16181C' }}
          >
            {employee.walletAddress}
          </p>
        ) : (
          <p className="text-sm" style={{ color: '#8A8D91' }}>No wallet connected yet</p>
        )}
        <WalletSettings address={employee.walletAddress} />
      </div>
    </div>
  )
}
