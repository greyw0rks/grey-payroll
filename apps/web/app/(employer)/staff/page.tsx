'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AddEmployeeModal } from '@/components/employer/AddEmployeeModal'

type EmployeeStatus = 'ACTIVE' | 'PENDING' | 'TERMINATED'

interface Employee {
  id: string
  firstName: string
  lastName: string
  jobTitle: string
  monthlySalary: string
  currency: string
  status: EmployeeStatus
  walletAddress: string | null
  startDate: string
}

function formatAmount(amount: string, currency: string) {
  return (
    Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) +
    ' ' +
    (currency === 'CUSD' ? 'cUSD' : currency)
  )
}

function StatusPill({ status }: { status: EmployeeStatus }) {
  const map: Record<EmployeeStatus, [string, string]> = {
    ACTIVE:     ['#1D9E75', '#E8FBF0'],
    PENDING:    ['#854F0B', '#FEF3DD'],
    TERMINATED: ['#791F1F', '#FCEBEB'],
  }
  const [color, bg] = map[status] ?? ['#8A8D91', '#F4F3EE']
  const label = status === 'ACTIVE' ? 'Active' : status === 'PENDING' ? 'Pending' : 'Terminated'
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ color, background: bg }}>
      {label}
    </span>
  )
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
      style={{ background: '#E8FBF0', color: '#0B3D20' }}
    >
      {initials}
    </div>
  )
}

function truncateAddress(addr: string | null) {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function StaffPage() {
  const router = useRouter()
  const [staff, setStaff] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const fetchStaff = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/employees')
      if (!res.ok) throw new Error('Failed to load staff')
      const data = await res.json()
      setStaff(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStaff() }, [fetchStaff])

  const activeCount = staff.filter(s => s.status === 'ACTIVE').length

  return (
    <>
      <div className="rounded-2xl border overflow-hidden" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#ECEBE6' }}>
          <div>
            <h3 className="font-display text-base font-semibold">Staff</h3>
            {loading ? (
              <p className="text-sm" style={{ color: '#8A8D91' }}>Loading…</p>
            ) : (
              <p className="text-sm" style={{ color: '#8A8D91' }}>
                {staff.length} employees · {activeCount} active
              </p>
            )}
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="text-sm font-medium px-4 py-2 rounded-full"
            style={{ background: '#3DDC84', color: '#0B3D20' }}
          >
            + Add employee
          </button>
        </div>

        {error && (
          <div className="p-5 text-sm" style={{ color: '#791F1F' }}>
            {error}
          </div>
        )}

        {!loading && !error && staff.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-5">
            <p className="font-medium text-sm" style={{ color: '#16181C' }}>No employees yet</p>
            <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>Add your first employee to get started</p>
          </div>
        )}

        {/* Table */}
        {!loading && staff.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: '#8A8D91' }}>
                  {['Name', 'Role', 'Start date', 'Monthly salary', 'Status', 'Wallet'].map(h => (
                    <th key={h} className="px-5 py-3 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr
                    key={s.id}
                    className="border-t cursor-pointer transition-colors hover:bg-[#F4F3EE]"
                    style={{ borderColor: '#ECEBE6' }}
                    onClick={() => router.push(`/staff/${s.id}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar initials={(s.firstName[0] ?? '') + (s.lastName[0] ?? '')} />
                        <span className="font-medium whitespace-nowrap">{s.firstName} {s.lastName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: '#8A8D91' }}>{s.jobTitle}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: '#8A8D91' }}>
                      {new Date(s.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap font-medium">
                      {formatAmount(s.monthlySalary, s.currency)}
                    </td>
                    <td className="px-5 py-3.5"><StatusPill status={s.status} /></td>
                    <td
                      className="px-5 py-3.5 text-xs"
                      style={{ fontFamily: 'var(--font-jbmono)', color: '#8A8D91' }}
                    >
                      {s.status === 'PENDING' ? 'invite sent' : truncateAddress(s.walletAddress)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <AddEmployeeModal
          onClose={() => setShowModal(false)}
          onAdded={() => {
            setShowModal(false)
            fetchStaff()
          }}
        />
      )}
    </>
  )
}
