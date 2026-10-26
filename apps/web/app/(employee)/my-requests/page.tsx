'use client'

import { formatMoney } from '@/lib/money'
import { useState, useEffect, useCallback } from 'react'

interface AdvanceRequest {
  id: string
  amount: string
  reason: string
  status: string
  createdAt: string
}

interface RefundRequest {
  id: string
  amount: string
  category: string
  description: string
  status: string
  paymentStatus?: string
  currency: string
  createdAt: string
}

interface LeaveRequest {
  id: string
  type: string
  startDate: string
  endDate: string
  totalDays: number
  note: string
  status: string
  createdAt: string
}

interface EmployeeData {
  id: string
  currency: string
  advanceRequests: AdvanceRequest[]
  refundRequests: RefundRequest[]
  leaveRequests: LeaveRequest[]
}

type TabKind = 'All' | 'Advance' | 'Refund' | 'Leave'
type FormKind = 'advance' | 'refund' | 'leave' | null

const TABS: { label: string; value: TabKind }[] = [
  { label: 'All',      value: 'All'     },
  { label: 'Advances', value: 'Advance' },
  { label: 'Refunds',  value: 'Refund'  },
  { label: 'Leave',    value: 'Leave'   },
]

const REFUND_CATEGORIES = ['Transport', 'Meals', 'Software', 'Equipment', 'Other']

const LEAVE_TYPES = [
  { value: 'ANNUAL',       label: 'Annual leave' },
  { value: 'SICK',         label: 'Sick leave' },
  { value: 'MATERNITY',    label: 'Maternity leave' },
  { value: 'PATERNITY',    label: 'Paternity leave' },
  { value: 'COMPASSIONATE',label: 'Compassionate leave' },
  { value: 'STUDY',        label: 'Study leave' },
  { value: 'UNPAID',       label: 'Unpaid leave' },
]

function formatAmount(amount: string, currency: string) {
  return formatMoney(String(amount), currency)
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    PENDING:  ['#854F0B', '#FEF3DD'],
    APPROVED: ['#1D9E75', '#E8FBF0'],
    REJECTED: ['#791F1F', '#FCEBEB'],
    PAID: ['#0B3D20', '#E8FBF0'],
    AWAITING_PAYMENT: ['#854F0B', '#FEF3DD'],
    HISTORICAL: ['#60645F', '#F4F3EE'],
  }
  const [color, bg] = map[status.toUpperCase()] ?? ['#8A8D91', '#F4F3EE']
  const label = status === 'AWAITING_PAYMENT' ? 'Approved · awaiting payment' : status === 'HISTORICAL' ? 'Historical payment' : status === 'PAID' ? 'Paid on Arc' : status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ color, background: bg }}>
      {label}
    </span>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '10px',
  border: '1px solid #ECEBE6',
  background: '#F4F3EE',
  color: '#16181C',
  fontSize: '14px',
  outline: 'none',
}

interface UnifiedRequest {
  id: string
  kind: 'Advance' | 'Refund' | 'Leave'
  detail: string
  amount: string | null
  status: string
  createdAt: string
  currency: string
}

function buildUnified(employee: EmployeeData): UnifiedRequest[] {
  const currency = employee.currency
  const advances: UnifiedRequest[] = employee.advanceRequests.map(r => ({
    id: r.id, kind: 'Advance', detail: r.reason,
    amount: r.amount, status: r.status, createdAt: r.createdAt, currency,
  }))
  const refunds: UnifiedRequest[] = employee.refundRequests.map(r => ({
    id: r.id, kind: 'Refund',
    detail: r.description ? `${r.category} — ${r.description}` : r.category,
    amount: r.amount, status: r.paymentStatus ?? r.status, createdAt: r.createdAt, currency: r.currency,
  }))
  const leaves: UnifiedRequest[] = employee.leaveRequests.map(r => ({
    id: r.id, kind: 'Leave',
    detail: `${r.type.charAt(0) + r.type.slice(1).toLowerCase()} leave · ${r.totalDays}d`,
    amount: null, status: r.status, createdAt: r.createdAt, currency,
  }))
  return [...advances, ...refunds, ...leaves].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

const KIND_COLORS: Record<string, [string, string]> = {
  Advance: ['#854F0B', '#FEF3DD'],
  Refund:  ['#0B3D20', '#E8FBF0'],
  Leave:   ['#16181C', '#F4F3EE'],
}

export default function EmployeeRequestsPage() {
  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKind>('All')
  const [openForm, setOpenForm] = useState<FormKind>(null)
  useEffect(() => {
    const kind = new URLSearchParams(window.location.search).get('kind')
    if (kind === 'leave' || kind === 'refund') setOpenForm(kind)
  }, [])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Advance form
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceReason, setAdvanceReason] = useState('')

  // Refund form
  const [refundAmount, setRefundAmount] = useState('')
  const [refundCategory, setRefundCategory] = useState(REFUND_CATEGORIES[0]!)
  const [refundDescription, setRefundDescription] = useState('')

  // Leave form
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0]!.value)
  const [leaveStart, setLeaveStart] = useState('')
  const [leaveEnd, setLeaveEnd] = useState('')
  const [leaveNote, setLeaveNote] = useState('')

  const fetchEmployee = useCallback(async () => {
    try {
      const res = await fetch('/api/employees/me')
      if (!res.ok) throw new Error('Failed to load requests')
      const data = await res.json()
      setEmployee(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEmployee() }, [fetchEmployee])

  function clearForms() {
    setAdvanceAmount(''); setAdvanceReason('')
    setRefundAmount(''); setRefundCategory(REFUND_CATEGORIES[0]!); setRefundDescription('')
    setLeaveType(LEAVE_TYPES[0]!.value); setLeaveStart(''); setLeaveEnd(''); setLeaveNote('')
    setFormError(null)
  }

  function toggleForm(kind: FormKind) {
    if (openForm === kind) {
      setOpenForm(null)
    } else {
      clearForms()
      setOpenForm(kind)
    }
  }

  async function submitAdvance() {
    if (!employee || !advanceAmount || !advanceReason) {
      setFormError('Amount and reason are required')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/employees/${employee.id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: advanceAmount, reason: advanceReason }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to submit')
      }
      setOpenForm(null)
      clearForms()
      await fetchEmployee()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRefund() {
    if (!employee || !refundAmount) {
      setFormError('Amount is required')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/employees/${employee.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: refundAmount, category: refundCategory, description: refundDescription }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to submit')
      }
      setOpenForm(null)
      clearForms()
      await fetchEmployee()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitLeave() {
    if (!employee || !leaveStart || !leaveEnd) {
      setFormError('Start and end dates are required')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/employees/${employee.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: leaveType, startDate: leaveStart, endDate: leaveEnd, note: leaveNote }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to submit')
      }
      setOpenForm(null)
      clearForms()
      await fetchEmployee()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const allRequests = employee ? buildUnified(employee) : []
  const visible = tab === 'All' ? allRequests : allRequests.filter(r => r.kind === tab)
  const currency = employee?.currency ?? 'USDC'

  return (
    <div className="space-y-5">
      {/* New request buttons */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { label: 'Advance', kind: 'advance' as FormKind },
          { label: 'Refund',  kind: 'refund'  as FormKind },
          { label: 'Leave',   kind: 'leave'   as FormKind },
        ] as { label: string; kind: FormKind }[]).map(({ label, kind }) => (
          <button
            key={kind}
            onClick={() => toggleForm(kind)}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border text-xs font-medium text-center transition"
            style={
              openForm === kind
                ? { borderColor: '#3DDC84', background: '#E8FBF0', color: '#0B3D20' }
                : { borderColor: '#ECEBE6', background: '#FFFFFF', color: '#16181C' }
            }
          >
            <span style={{ fontSize: '18px', color: '#0B3D20' }}>+</span>
            {label}
          </button>
        ))}
      </div>

      {/* Inline forms */}
      {openForm === 'advance' && (
        <div
          className="rounded-2xl border p-5 space-y-4"
          style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
        >
          <h3 className="font-display text-sm font-semibold" style={{ color: '#16181C' }}>Request advance</h3>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Amount ({currency === 'LEGACY_ASSET' ? 'historical asset' : currency})</label>
            <input
              style={inputStyle}
              type="number"
              min="1"
              placeholder="e.g. 500"
              value={advanceAmount}
              onChange={e => setAdvanceAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Reason</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="e.g. Emergency medical expense"
              value={advanceReason}
              onChange={e => setAdvanceReason(e.target.value)}
            />
          </div>
          {formError && <p className="text-xs" style={{ color: '#791F1F' }}>{formError}</p>}
          <div className="flex gap-3">
            <button
              onClick={submitAdvance}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-full text-sm font-semibold"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              onClick={() => { setOpenForm(null); clearForms() }}
              className="px-4 py-2.5 rounded-full text-sm font-medium"
              style={{ color: '#8A8D91' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {openForm === 'refund' && (
        <div
          className="rounded-2xl border p-5 space-y-4"
          style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
        >
          <h3 className="font-display text-sm font-semibold" style={{ color: '#16181C' }}>Request refund</h3>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Amount ({currency === 'LEGACY_ASSET' ? 'historical asset' : currency})</label>
            <input
              style={inputStyle}
              type="number"
              min="1"
              placeholder="e.g. 50"
              value={refundAmount}
              onChange={e => setRefundAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Category</label>
            <select
              style={inputStyle}
              value={refundCategory}
              onChange={e => setRefundCategory(e.target.value)}
            >
              {REFUND_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Description (optional)</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="e.g. Figma annual subscription"
              value={refundDescription}
              onChange={e => setRefundDescription(e.target.value)}
            />
          </div>
          {formError && <p className="text-xs" style={{ color: '#791F1F' }}>{formError}</p>}
          <div className="flex gap-3">
            <button
              onClick={submitRefund}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-full text-sm font-semibold"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              onClick={() => { setOpenForm(null); clearForms() }}
              className="px-4 py-2.5 rounded-full text-sm font-medium"
              style={{ color: '#8A8D91' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {openForm === 'leave' && (
        <div
          className="rounded-2xl border p-5 space-y-4"
          style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
        >
          <h3 className="font-display text-sm font-semibold" style={{ color: '#16181C' }}>Request leave</h3>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Leave type</label>
            <select
              style={inputStyle}
              value={leaveType}
              onChange={e => setLeaveType(e.target.value)}
            >
              {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Start date</label>
              <input
                style={inputStyle}
                type="date"
                value={leaveStart}
                onChange={e => setLeaveStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>End date</label>
              <input
                style={inputStyle}
                type="date"
                value={leaveEnd}
                onChange={e => setLeaveEnd(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Note (optional)</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="Additional details for your employer"
              value={leaveNote}
              onChange={e => setLeaveNote(e.target.value)}
            />
          </div>
          {formError && <p className="text-xs" style={{ color: '#791F1F' }}>{formError}</p>}
          <div className="flex gap-3">
            <button
              onClick={submitLeave}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-full text-sm font-semibold"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              onClick={() => { setOpenForm(null); clearForms() }}
              className="px-4 py-2.5 rounded-full text-sm font-medium"
              style={{ color: '#8A8D91' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tab filters */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="text-sm font-medium px-4 py-2 rounded-full whitespace-nowrap transition"
            style={
              tab === t.value
                ? { background: '#3DDC84', color: '#0B3D20' }
                : { background: '#FFFFFF', color: '#8A8D91', border: '1px solid #ECEBE6' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Requests list */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <div className="p-4 border-b" style={{ borderColor: '#ECEBE6' }}>
          <p className="text-sm font-medium">Your requests</p>
        </div>

        {loading ? (
          <div className="p-5">
            <p className="text-sm" style={{ color: '#8A8D91' }}>Loading…</p>
          </div>
        ) : error ? (
          <div className="p-5">
            <p className="text-sm" style={{ color: '#791F1F' }}>{error}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-5">
            <p className="text-sm" style={{ color: '#8A8D91' }}>
              No {tab === 'All' ? '' : tab.toLowerCase() + ' '}requests yet
            </p>
          </div>
        ) : (
          visible.map((r, i) => {
            const [kindColor, kindBg] = KIND_COLORS[r.kind] ?? ['#8A8D91', '#F4F3EE']
            const dateStr = new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between p-4 ${i > 0 ? 'border-t' : ''}`}
                style={{ borderColor: '#ECEBE6' }}
              >
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={{ background: kindBg, color: kindColor }}
                    >
                      {r.kind}
                    </span>
                    {r.amount && (
                      <span className="text-sm font-medium">
                        {formatAmount(r.amount, r.currency)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate" style={{ color: '#16181C' }}>{r.detail}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>{dateStr}</p>
                </div>
                <StatusPill status={r.status} />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
