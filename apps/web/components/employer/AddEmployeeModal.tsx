'use client'

import { useState, useRef } from 'react'
import { ModalOverlay } from '@/components/ui/ModalOverlay'

interface ParsedEmployee {
  firstName: string
  lastName: string
  jobTitle: string
  monthlySalary: string
  currency: string
  startDate: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

interface AddedEmployee {
  name: string
  role: string
  salary: number
  avatar: string
  inviteCode: string
}

interface Props {
  onClose: () => void
  onAdded: (emp: AddedEmployee) => void
}

const CURRENCIES: { label: string; value: string }[] = [
  { label: 'USDC', value: 'USDC' },
  { label: 'cUSD', value: 'CUSD' },
]

const CONFIDENCE_STYLE: Record<string, [string, string]> = {
  HIGH:   ['#1D9E75', '#E8FBF0'],
  MEDIUM: ['#854F0B', '#FEF3DD'],
  LOW:    ['#791F1F', '#FCEBEB'],
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

export function AddEmployeeModal({ onClose, onAdded }: Props) {
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [parsing, setParsing] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedEmployee | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    firstName: '', lastName: '', jobTitle: '',
    monthlySalary: '', currency: 'USDC', startDate: '',
  })

  function update(field: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setParsing(true)
    // Simulate AI parse — replace with: POST /api/upload then /api/documents/parse
    await new Promise(r => setTimeout(r, 900))
    const mock: ParsedEmployee = {
      firstName: 'Amaka', lastName: 'Eze',
      jobTitle: 'Backend Engineer',
      monthlySalary: '580000', currency: 'NGN',
      startDate: '2025-01-12', confidence: 'HIGH',
    }
    setParsed(mock)
    setForm({
      firstName: mock.firstName, lastName: mock.lastName,
      jobTitle: mock.jobTitle, monthlySalary: mock.monthlySalary,
      currency: mock.currency, startDate: mock.startDate,
    })
    setParsing(false)
    setStep('review')
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          jobTitle: form.jobTitle,
          monthlySalary: Number(form.monthlySalary),
          currency: form.currency,
          startDate: form.startDate,
          ipfsDocHash: null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to add employee')
      }
      const data = await res.json()
      const code: string = data.inviteCode
      setInviteCode(code)
      setStep('done')
      onAdded({
        name: `${form.firstName} ${form.lastName}`,
        role: form.jobTitle,
        salary: Number(form.monthlySalary),
        avatar: (form.firstName[0] ?? 'A') + (form.lastName[0] ?? 'E'),
        inviteCode: code,
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <ModalOverlay onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: '#ECEBE6' }}>
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: '#16181C' }}>
            {step === 'upload' && 'Add employee'}
            {step === 'review' && 'Review details'}
            {step === 'done'   && 'Invite code ready'}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>
            {step === 'upload' && 'Upload employment letter or fill in manually'}
            {step === 'review' && 'Check the details before generating the invite code'}
            {step === 'done'   && 'Share this code with the employee to complete registration'}
          </p>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ background: '#F4F3EE', color: '#8A8D91' }}>✕</button>
      </div>

      <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">

        {/* ─── Step 1: Upload ─── */}
        {step === 'upload' && (
          <>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

            {parsing ? (
              <div className="flex flex-col items-center py-10 space-y-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                  style={{ background: '#E8FBF0' }}
                >
                  🤖
                </div>
                <p className="text-sm font-medium" style={{ color: '#16181C' }}>Parsing document…</p>
                <p className="text-xs" style={{ color: '#8A8D91' }}>Claude is extracting employee details</p>
                <div className="flex gap-1 mt-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: '#3DDC84', opacity: 0.4 + i * 0.3 }} />
                  ))}
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed py-10 flex flex-col items-center gap-3 transition hover:opacity-80"
                  style={{ borderColor: '#ECEBE6' }}
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                    style={{ background: '#F4F3EE' }}
                  >
                    📄
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium" style={{ color: '#16181C' }}>Click to upload employment letter</p>
                    <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>PDF, JPG, or PNG — Claude extracts all the details</p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px" style={{ background: '#ECEBE6' }} />
                  <span className="text-xs" style={{ color: '#8A8D91' }}>or</span>
                  <div className="flex-1 h-px" style={{ background: '#ECEBE6' }} />
                </div>

                <button
                  onClick={() => setStep('review')}
                  className="w-full py-3 rounded-full text-sm font-medium border transition"
                  style={{ borderColor: '#ECEBE6', color: '#16181C' }}
                >
                  Fill in manually
                </button>
              </>
            )}
          </>
        )}

        {/* ─── Step 2: Review & Edit ─── */}
        {step === 'review' && (
          <>
            {parsed && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                style={{ background: (CONFIDENCE_STYLE as Record<string, [string, string]>)[parsed.confidence]![1], color: (CONFIDENCE_STYLE as Record<string, [string, string]>)[parsed.confidence]![0] }}
              >
                <span>🤖</span>
                <span>Extracted from <strong>{fileName}</strong> — {parsed.confidence.toLowerCase()} confidence</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>First name</label>
                <input style={inputStyle} value={form.firstName} onChange={e => update('firstName', e.target.value)} placeholder="Amaka" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Last name</label>
                <input style={inputStyle} value={form.lastName} onChange={e => update('lastName', e.target.value)} placeholder="Eze" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Job title</label>
              <input style={inputStyle} value={form.jobTitle} onChange={e => update('jobTitle', e.target.value)} placeholder="Backend Engineer" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Monthly salary</label>
                <input style={inputStyle} type="number" value={form.monthlySalary} onChange={e => update('monthlySalary', e.target.value)} placeholder="580000" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Currency</label>
                <select style={inputStyle} value={form.currency} onChange={e => update('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Start date</label>
              <input style={inputStyle} type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} />
            </div>
          </>
        )}

        {/* ─── Step 3: Done ─── */}
        {step === 'done' && (
          <>
            <div className="flex flex-col items-center py-4 space-y-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
                style={{ background: '#E8FBF0' }}
              >
                ✓
              </div>
              <div className="text-center">
                <p className="font-display font-semibold" style={{ color: '#16181C' }}>
                  {form.firstName} {form.lastName} added
                </p>
                <p className="text-sm mt-0.5" style={{ color: '#8A8D91' }}>
                  Share the invite code below. It expires in 7 days.
                </p>
              </div>
            </div>

            <div className="rounded-xl p-5 text-center space-y-3" style={{ background: '#F4F3EE' }}>
              <p className="text-xs font-medium" style={{ color: '#8A8D91' }}>Invite code</p>
              <p
                className="text-3xl font-bold tracking-widest"
                style={{ fontFamily: 'var(--font-jbmono)', color: '#16181C' }}
              >
                {inviteCode}
              </p>
              <button
                onClick={handleCopy}
                className="text-sm font-medium px-5 py-2 rounded-full"
                style={{ background: copied ? '#E8FBF0' : '#3DDC84', color: copied ? '#1D9E75' : '#0B3D20' }}
              >
                {copied ? 'Copied!' : 'Copy code'}
              </button>
            </div>

            <div className="rounded-xl p-4 text-sm space-y-1" style={{ background: '#FFFFFF', border: '1px solid #ECEBE6' }}>
              {[
                ['Role', form.jobTitle],
                ['Monthly salary', `${Number(form.monthlySalary).toLocaleString()} ${CURRENCIES.find(c => c.value === form.currency)?.label ?? form.currency}`],
                ['Start date', new Date(form.startDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span style={{ color: '#8A8D91' }}>{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-2 border-t space-y-2" style={{ borderColor: '#ECEBE6' }}>
        {step === 'review' && (
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.firstName || !form.lastName || !form.jobTitle || !form.monthlySalary}
            className="w-full py-3 rounded-full text-sm font-semibold transition"
            style={{ background: '#3DDC84', color: '#0B3D20' }}
          >
            {submitting ? 'Generating…' : 'Generate invite code →'}
          </button>
        )}
        {step === 'review' && (
          <button onClick={() => setStep('upload')} className="w-full py-2 text-sm" style={{ color: '#8A8D91' }}>
            ← Back
          </button>
        )}
        {step === 'done' && (
          <div className="flex gap-3">
            <button
              onClick={() => { setStep('upload'); setParsed(null); setFileName(null); setForm({ firstName:'',lastName:'',jobTitle:'',monthlySalary:'',currency:'NGN',startDate:'' }) }}
              className="flex-1 py-3 rounded-full text-sm font-medium border"
              style={{ borderColor: '#ECEBE6', color: '#16181C' }}
            >
              Add another
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-full text-sm font-semibold"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
