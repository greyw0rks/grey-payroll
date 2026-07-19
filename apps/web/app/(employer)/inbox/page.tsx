'use client'

import { useState, useEffect, useCallback } from 'react'

type RequestKind = 'Advance' | 'Refund' | 'Leave'
type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

interface RequestEmployee {
  id: string
  firstName: string
  lastName: string
  jobTitle: string
}

interface Request {
  id: string
  kind: RequestKind
  employeeId: string
  employee: RequestEmployee
  detail: string
  amount: string | null
  status: RequestStatus
  date: string
}

type Verdict = 'APPROVE' | 'REVIEW' | 'REJECT'

interface Insight {
  verdict: Verdict
  confidence: number
  reasoning: string
  flags: string[]
}

type InsightState = Insight | 'loading' | 'error'

const VERDICT_STYLES: Record<Verdict, { color: string; bg: string; label: string }> = {
  APPROVE: { color: '#1D9E75', bg: '#E8FBF0', label: 'Approve' },
  REVIEW:  { color: '#854F0B', bg: '#FEF3DD', label: 'Review' },
  REJECT:  { color: '#791F1F', bg: '#FCEBEB', label: 'Reject' },
}

function AiInsightCard({ state }: { state: InsightState | undefined }) {
  if (!state || state === 'loading') {
    return (
      <div
        className="mx-4 sm:mx-5 mb-3 ml-[3.25rem] rounded-xl px-3 py-2.5 flex items-center gap-2 animate-pulse"
        style={{ background: '#F4F3EE' }}
      >
        <span className="text-xs font-semibold" style={{ color: '#0B3D20' }}>Grey AI</span>
        <span className="text-xs" style={{ color: '#8A8D91' }}>reviewing this request…</span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="mx-4 sm:mx-5 mb-3 ml-[3.25rem] px-3 py-1">
        <span className="text-xs" style={{ color: '#8A8D91' }}>Grey AI · unavailable</span>
      </div>
    )
  }

  const v = VERDICT_STYLES[state.verdict]
  return (
    <div
      className="mx-4 sm:mx-5 mb-3 ml-[3.25rem] rounded-xl px-3 py-2.5 space-y-1.5"
      style={{ background: '#FAFAF8', border: '1px solid #ECEBE6' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: '#0B3D20' }}>Grey AI</span>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ color: v.color, background: v.bg }}
        >
          {v.label}
        </span>
        {state.confidence > 0 && (
          <span className="text-xs" style={{ color: '#8A8D91' }}>· {state.confidence}% confident</span>
        )}
      </div>
      {state.reasoning && (
        <p className="text-xs leading-snug" style={{ color: '#16181C' }}>{state.reasoning}</p>
      )}
      {state.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {state.flags.map((flag, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-md"
              style={{ background: '#FEF3DD', color: '#854F0B' }}
            >
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const FILTERS: { label: string; value: RequestKind | 'All' }[] = [
  { label: 'All',      value: 'All'     },
  { label: 'Advances', value: 'Advance' },
  { label: 'Refunds',  value: 'Refund'  },
  { label: 'Leave',    value: 'Leave'   },
]

const KIND_COLORS: Record<RequestKind, [string, string]> = {
  Advance: ['#854F0B', '#FEF3DD'],
  Refund:  ['#0B3D20', '#E8FBF0'],
  Leave:   ['#16181C', '#F4F3EE'],
}

function formatAmount(amount: string | null) {
  if (!amount) return null
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' USDC'
}

function StatusPill({ status }: { status: RequestStatus }) {
  const map: Record<RequestStatus, [string, string]> = {
    PENDING:  ['#854F0B', '#FEF3DD'],
    APPROVED: ['#1D9E75', '#E8FBF0'],
    REJECTED: ['#791F1F', '#FCEBEB'],
  }
  const [color, bg] = map[status]
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap" style={{ color, background: bg }}>
      {label}
    </span>
  )
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
      style={{ background: '#E8FBF0', color: '#0B3D20' }}
    >
      {initials}
    </div>
  )
}

export default function InboxPage() {
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<RequestKind | 'All'>('All')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [insights, setInsights] = useState<Record<string, InsightState>>({})

  const fetchInsights = useCallback(async (reqs: Request[]) => {
    // Only Advance/Refund get an AI review; run sequentially to avoid a burst.
    const reviewable = reqs.filter(
      r => r.status === 'PENDING' && (r.kind === 'Advance' || r.kind === 'Refund'),
    )
    if (reviewable.length === 0) return
    setInsights(prev => {
      const next = { ...prev }
      for (const r of reviewable) next[r.id] = 'loading'
      return next
    })
    for (const r of reviewable) {
      try {
        const res = await fetch(`/api/requests/${r.kind.toLowerCase()}/${r.id}/review`)
        const data = await res.json()
        setInsights(prev => ({
          ...prev,
          [r.id]: {
            verdict: data.verdict ?? 'REVIEW',
            confidence: data.confidence ?? 0,
            reasoning: data.reasoning ?? '',
            flags: Array.isArray(data.flags) ? data.flags : [],
          },
        }))
      } catch {
        setInsights(prev => ({ ...prev, [r.id]: 'error' }))
      }
    }
  }, [])

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/requests')
      if (!res.ok) throw new Error('Failed to load requests')
      const data = await res.json()
      setRequests(data)
      fetchInsights(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [fetchInsights])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  const visible = filter === 'All' ? requests : requests.filter(r => r.kind === filter)
  const pendingCount = requests.filter(r => r.status === 'PENDING').length

  async function handleApprove(req: Request) {
    setActionLoading(req.id)
    setActionError(null)
    try {
      const endpoint = `/api/requests/${req.kind.toLowerCase()}/${req.id}`
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to approve')
      }
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'APPROVED' } : r))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject(req: Request) {
    setActionLoading(req.id)
    setActionError(null)
    try {
      const endpoint = `/api/requests/${req.kind.toLowerCase()}/${req.id}`
      const body: Record<string, string> = { action: 'reject' }
      if (req.kind === 'Refund' && rejectReason.trim()) {
        body.rejectionReason = rejectReason.trim()
      }
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to decline')
      }
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'REJECTED' } : r))
      setRejectingId(null)
      setRejectReason('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-semibold" style={{ color: '#16181C' }}>
          Requests inbox
        </h1>
        {!loading && pendingCount > 0 && (
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: '#FEF3DD', color: '#854F0B' }}
          >
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className="text-sm font-medium px-4 py-2 rounded-full whitespace-nowrap transition"
            style={
              filter === f.value
                ? { background: '#3DDC84', color: '#0B3D20' }
                : { background: '#FFFFFF', color: '#8A8D91', border: '1px solid #ECEBE6' }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="text-sm px-1" style={{ color: '#791F1F' }}>{actionError}</p>
      )}

      {/* Request list */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm" style={{ color: '#8A8D91' }}>Loading…</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm" style={{ color: '#791F1F' }}>{error}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-5">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-xl"
              style={{ background: '#F4F3EE' }}
            >
              ✓
            </div>
            <p className="font-medium text-sm" style={{ color: '#16181C' }}>All clear</p>
            <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>
              No {filter === 'All' ? '' : filter.toLowerCase() + ' '}requests to show
            </p>
          </div>
        ) : (
          visible.map((req, i) => {
            const [kindColor, kindBg] = KIND_COLORS[req.kind]
            const isLoadingThis = actionLoading === req.id
            const isRejectingThis = rejectingId === req.id
            const initials = (req.employee.firstName[0] ?? '') + (req.employee.lastName[0] ?? '')
            const formatted = formatAmount(req.amount)
            const dateStr = new Date(req.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

            return (
              <div key={req.id} className={`${i > 0 ? 'border-t' : ''}`} style={{ borderColor: '#ECEBE6' }}>
                {/* Main row */}
                <div className="flex items-start gap-4 p-4 sm:p-5">
                  <Avatar initials={initials} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-semibold text-sm" style={{ color: '#16181C' }}>
                        {req.employee.firstName} {req.employee.lastName}
                      </span>
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-md"
                        style={{ background: kindBg, color: kindColor }}
                      >
                        {req.kind}
                      </span>
                    </div>
                    <p className="text-sm mb-0.5" style={{ color: '#8A8D91' }}>{req.detail}</p>
                    <p className="text-xs" style={{ color: '#8A8D91' }}>
                      {req.employee.jobTitle} · {dateStr}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                    {formatted && (
                      <span className="font-semibold text-sm whitespace-nowrap">{formatted}</span>
                    )}
                    <StatusPill status={req.status} />
                  </div>
                </div>

                {/* AI insight (Advance/Refund only) */}
                {req.status === 'PENDING' && (req.kind === 'Advance' || req.kind === 'Refund') && (
                  <AiInsightCard state={insights[req.id]} />
                )}

                {/* Action buttons (only for PENDING) */}
                {req.status === 'PENDING' && (
                  <div className="flex items-center gap-3 px-4 sm:px-5 pb-4 pl-[3.25rem]">
                    <button
                      onClick={() => handleApprove(req)}
                      disabled={isLoadingThis}
                      className="text-xs font-semibold px-4 py-2 rounded-full transition"
                      style={{ background: '#3DDC84', color: '#0B3D20' }}
                    >
                      {isLoadingThis && !isRejectingThis ? '…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => {
                        if (req.kind === 'Refund') {
                          setRejectingId(isRejectingThis ? null : req.id)
                        } else {
                          handleReject(req)
                        }
                      }}
                      disabled={isLoadingThis}
                      className="text-xs font-medium px-4 py-2 rounded-full border transition"
                      style={{ borderColor: '#ECEBE6', color: '#8A8D91' }}
                    >
                      Decline
                    </button>
                  </div>
                )}

                {/* Rejection reason input (Refunds only) */}
                {isRejectingThis && (
                  <div
                    className="mx-4 sm:mx-5 mb-4 rounded-xl p-3 space-y-3"
                    style={{ background: '#F4F3EE' }}
                  >
                    <p className="text-xs font-medium" style={{ color: '#16181C' }}>Reason for declining (optional)</p>
                    <input
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="e.g. Receipt unclear, please resubmit"
                      className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                      style={{ background: '#FFFFFF', border: '1px solid #ECEBE6', color: '#16181C' }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReject(req)}
                        disabled={isLoadingThis}
                        className="text-xs font-semibold px-4 py-1.5 rounded-full"
                        style={{ background: '#791F1F', color: '#FFFFFF' }}
                      >
                        {isLoadingThis ? '…' : 'Confirm decline'}
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectReason('') }}
                        className="text-xs font-medium px-4 py-1.5 rounded-full"
                        style={{ color: '#8A8D91' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
