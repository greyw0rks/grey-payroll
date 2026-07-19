'use client'

import { useState, useRef } from 'react'
import { ModalOverlay } from '@/components/ui/ModalOverlay'

interface Props {
  employeeId: string
  employeeName: string
  monthlySalary?: number
  onClose: () => void
  onConfirm: () => Promise<void>
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

function formatAmount(amount: number, currency = 'USDC') {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + currency
}

export function TerminateModal({ employeeName, monthlySalary = 0, onClose, onConfirm }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [parsing, setParsing] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const [form, setForm] = useState({
    effectiveDate: new Date().toISOString().split('T')[0],
    severance: 'none' as 'none' | 'pay',
    severanceAmount: '',
    severanceNote: '',
  })

  const salaryOwed = Math.round(monthlySalary * (new Date().getDate() / 30))
  const severancePay = form.severance === 'pay' ? Number(form.severanceAmount) || 0 : 0
  const totalPayout = salaryOwed + severancePay

  async function handleFile(file: File) {
    setFileName(file.name)
    setParsing(true)
    // Simulate AI parse of termination letter
    await new Promise(r => setTimeout(r, 700))
    setParsing(false)
    setStep('review')
  }

  async function handleConfirm() {
    setLoading(true)
    setConfirmError(null)
    try {
      await onConfirm()
      setStep('done')
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to terminate. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: '#ECEBE6' }}>
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: '#16181C' }}>
            {step === 'upload' && `Terminate ${employeeName}`}
            {step === 'review' && 'Review termination'}
            {step === 'done'   && 'Employee terminated'}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>
            {step === 'upload' && 'Upload the termination letter or skip to proceed manually'}
            {step === 'review' && 'Set the effective date and severance terms'}
            {step === 'done'   && 'The employee\'s access has been removed'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
          style={{ background: '#F4F3EE', color: '#8A8D91' }}
        >
          ✕
        </button>
      </div>

      <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

        {/* ─── Step 1: Upload ─── */}
        {step === 'upload' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />

            {parsing ? (
              <div className="flex flex-col items-center py-8 space-y-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: '#FCEBEB' }}>🤖</div>
                <p className="text-sm font-medium" style={{ color: '#16181C' }}>Parsing letter…</p>
                <p className="text-xs" style={{ color: '#8A8D91' }}>Extracting effective date and severance terms</p>
              </div>
            ) : (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed py-8 flex flex-col items-center gap-3 hover:opacity-80 transition"
                  style={{ borderColor: '#ECEBE6' }}
                >
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: '#FCEBEB' }}>📄</div>
                  <div className="text-center">
                    <p className="text-sm font-medium" style={{ color: '#16181C' }}>Upload termination letter</p>
                    <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>Claude will extract the effective date and any severance terms</p>
                  </div>
                </button>

                <button
                  onClick={() => setStep('review')}
                  className="w-full py-3 rounded-full text-sm font-medium border"
                  style={{ borderColor: '#ECEBE6', color: '#16181C' }}
                >
                  Skip — proceed manually
                </button>
              </>
            )}
          </>
        )}

        {/* ─── Step 2: Review ─── */}
        {step === 'review' && (
          <>
            {fileName && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ background: '#FCEBEB', color: '#791F1F' }}>
                <span>📄</span>
                <span>Parsed from <strong>{fileName}</strong> — review and adjust below</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Effective date</label>
              <input
                style={inputStyle}
                type="date"
                value={form.effectiveDate}
                onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))}
              />
            </div>

            {/* Severance options */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#8A8D91' }}>Severance</label>
              <div className="grid grid-cols-2 gap-3">
                {(['none', 'pay'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => setForm(f => ({ ...f, severance: opt }))}
                    className="py-3 rounded-xl text-sm font-medium border-2 text-center transition"
                    style={
                      form.severance === opt
                        ? { borderColor: '#3DDC84', background: '#E8FBF0', color: '#0B3D20' }
                        : { borderColor: '#ECEBE6', background: '#FFFFFF', color: '#8A8D91' }
                    }
                  >
                    {opt === 'none' ? 'No severance' : 'Pay severance'}
                  </button>
                ))}
              </div>
            </div>

            {form.severance === 'pay' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Severance amount (USDC)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    placeholder="e.g. 2000 (2 months)"
                    value={form.severanceAmount}
                    onChange={e => setForm(f => ({ ...f, severanceAmount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Note (optional)</label>
                  <input
                    style={inputStyle}
                    placeholder="e.g. As agreed per employment contract"
                    value={form.severanceNote}
                    onChange={e => setForm(f => ({ ...f, severanceNote: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* Final settlement preview */}
            {monthlySalary > 0 && (
              <div className="rounded-xl p-4 space-y-2 text-sm" style={{ background: '#F4F3EE' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: '#8A8D91' }}>Final settlement</p>
                <div className="flex justify-between">
                  <span style={{ color: '#8A8D91' }}>Salary owed to effective date</span>
                  <span className="font-medium">{formatAmount(salaryOwed)}</span>
                </div>
                {form.severance === 'pay' && (
                  <div className="flex justify-between">
                    <span style={{ color: '#8A8D91' }}>Severance pay</span>
                    <span className="font-medium">{formatAmount(severancePay)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t" style={{ borderColor: '#ECEBE6' }}>
                  <span className="font-semibold">Total payout</span>
                  <span className="font-semibold">{formatAmount(totalPayout)}</span>
                </div>
              </div>
            )}

            {/* Warning */}
            <div className="rounded-xl p-4 text-sm" style={{ background: '#FCEBEB', color: '#791F1F' }}>
              ⚠️ This action is irreversible. {employeeName}&apos;s check-in access will be removed on{' '}
              <strong>
                {form.effectiveDate
                  ? new Date(form.effectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—'}
              </strong>.
            </div>

            {confirmError && (
              <p className="text-sm" style={{ color: '#791F1F' }}>{confirmError}</p>
            )}
          </>
        )}

        {/* ─── Step 3: Done ─── */}
        {step === 'done' && (
          <div className="flex flex-col items-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl" style={{ background: '#FCEBEB' }}>
              ✓
            </div>
            <div className="text-center">
              <p className="font-display font-semibold text-lg" style={{ color: '#16181C' }}>Termination confirmed</p>
              <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>
                {employeeName}&apos;s employment has been ended
              </p>
            </div>
            <div className="w-full rounded-xl p-4 space-y-2 text-sm" style={{ background: '#F4F3EE' }}>
              <div className="flex justify-between">
                <span style={{ color: '#8A8D91' }}>Status</span>
                <span className="font-medium" style={{ color: '#791F1F' }}>Terminated</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-2 border-t space-y-2" style={{ borderColor: '#ECEBE6' }}>
        {step === 'review' && (
          <>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="w-full py-3 rounded-full text-sm font-semibold"
              style={{ background: '#791F1F', color: '#FFFFFF' }}
            >
              {loading ? 'Processing…' : 'Confirm termination'}
            </button>
            <button
              onClick={() => setStep('upload')}
              className="w-full py-2 text-sm"
              style={{ color: '#8A8D91' }}
            >
              ← Back
            </button>
          </>
        )}
        {step === 'done' && (
          <button
            onClick={onClose}
            className="w-full py-3 rounded-full text-sm font-semibold"
            style={{ background: '#3DDC84', color: '#0B3D20' }}
          >
            Back to staff
          </button>
        )}
      </div>
    </ModalOverlay>
  )
}
