'use client'
import { useState } from 'react'
import { ModalOverlay } from '@/components/ui/ModalOverlay'
import { toDatabaseAmount } from '@/lib/money'
export function AddEmployeeModal({ onClose, onAdded }: { onClose: () => void; onAdded: (employee: { name: string; role: string; salary: number; avatar: string; inviteCode: string }) => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', jobTitle: '', monthlySalary: '', currency: 'USDC', startDate: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState('')
  const [copied, setCopied] = useState(false)
  const update = (field: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [field]: value }))
  return <ModalOverlay onClose={onClose}><div className="p-6"><div className="flex items-center justify-between mb-6"><h2 className="text-xl font-display">{invite ? 'Invitation ready' : 'Add an employee'}</h2><button type="button" aria-label="Close add employee" className="grey-button grey-button-small" onClick={onClose}>Close</button></div>{invite ? <div className="space-y-5"><p className="text-sm muted">Share this code with {form.firstName} so they can join your company. It expires in seven days.</p><code className="block text-2xl break-all">{invite}</code><button className="grey-button" onClick={async () => { try { await navigator.clipboard.writeText(invite); setCopied(true) } catch { setError('Select the invitation code and copy it manually.') } }}>{copied ? 'Copied' : 'Copy code'}</button>{error ? <p className="form-error text-sm" role="alert">{error}</p> : null}<button className="grey-button grey-button-primary w-full" onClick={() => onAdded({ name: `${form.firstName} ${form.lastName}`, role: form.jobTitle, salary: Number(form.monthlySalary), avatar: form.firstName[0]! + form.lastName[0]!, inviteCode: invite })}>Done</button></div> : <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const response = await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, monthlySalary: toDatabaseAmount(form.monthlySalary) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not add the employee. Try again.')
      setInvite(data.inviteCode)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add the employee.') }
    finally { setSaving(false) }
  }}><p className="text-sm muted">Their invitation gives access to this company’s employee workspace.</p><div className="grid grid-cols-2 gap-4">{(['firstName', 'lastName'] as const).map(field => <label key={field} className="text-sm">{field === 'firstName' ? 'First name' : 'Last name'}<input className="grey-input" autoComplete={field === 'firstName' ? 'given-name' : 'family-name'} required value={form[field]} onChange={event => update(field, event.target.value)} /></label>)}</div><label className="block text-sm">Job title<input className="grey-input" required value={form.jobTitle} onChange={event => update('jobTitle', event.target.value)} /></label><div className="grid grid-cols-2 gap-4"><label className="text-sm">Monthly salary<input className="grey-input" required inputMode="decimal" value={form.monthlySalary} onChange={event => update('monthlySalary', event.target.value)} placeholder="1,200.00" /></label><label className="text-sm">Currency<select className="grey-input" value={form.currency} onChange={event => update('currency', event.target.value)}><option value="USDC">USDC</option></select></label></div><label className="block text-sm">Start date<input className="grey-input" required type="date" value={form.startDate} onChange={event => update('startDate', event.target.value)} /></label>{error ? <p className="form-error text-sm" role="alert">{error}</p> : null}<button className="grey-button grey-button-primary w-full" disabled={saving}>{saving ? 'Generating invitation…' : 'Generate invitation code'}</button></form>}</div></ModalOverlay>
}
