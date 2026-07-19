'use client'

import { useState } from 'react'
import Link from 'next/link'

const INDUSTRIES = [
  'Technology', 'Finance', 'Healthcare', 'Education', 'Retail',
  'Manufacturing', 'Consulting', 'Media', 'NGO / Non-profit', 'Other',
]

const TIMEZONES = [
  { value: 'Africa/Lagos',     label: 'Africa/Lagos (WAT, UTC+1)' },
  { value: 'Africa/Nairobi',   label: 'Africa/Nairobi (EAT, UTC+3)' },
  { value: 'Africa/Accra',     label: 'Africa/Accra (GMT, UTC+0)' },
  { value: 'Europe/London',    label: 'Europe/London (GMT/BST)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'UTC',              label: 'UTC' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '12px',
  border: '1px solid #ECEBE6',
  background: '#F4F3EE',
  color: '#16181C',
  fontSize: '14px',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#8A8D91',
  marginBottom: '6px',
}

export default function EmployerRegisterPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    companyName: '',
    email: '',
    industry: '',
    country: 'NG',
    timezone: 'Africa/Lagos',
  })

  function update(field: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/employer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Registration failed')
      }

      // Navigate to / — the root server page checks the DB directly and
      // redirects to /dashboard without depending on JWT propagation.
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#F4F3EE' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-display font-semibold" style={{ color: '#16181C' }}>
            Register your company
          </h1>
          <p className="text-sm" style={{ color: '#8A8D91' }}>Set up your Grey payroll account.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border p-6 space-y-5"
          style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
        >
          <div>
            <label style={labelStyle}>Company name</label>
            <input
              style={inputStyle}
              required
              value={form.companyName}
              onChange={e => update('companyName', e.target.value)}
              placeholder="Acme Corp"
            />
          </div>

          <div>
            <label style={labelStyle}>Work email</label>
            <input
              style={inputStyle}
              type="email"
              required
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="cfo@acmecorp.com"
            />
          </div>

          <div>
            <label style={labelStyle}>Industry</label>
            <select
              style={inputStyle}
              required
              value={form.industry}
              onChange={e => update('industry', e.target.value)}
            >
              <option value="">Select industry</option>
              {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Timezone</label>
            <select
              style={inputStyle}
              value={form.timezone}
              onChange={e => update('timezone', e.target.value)}
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm rounded-xl p-3" style={{ background: '#FCEBEB', color: '#791F1F' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-full text-sm font-medium"
            style={{ background: '#3DDC84', color: '#0B3D20' }}
          >
            {submitting ? 'Creating account…' : 'Create company account'}
          </button>
        </form>

        <p className="text-center text-sm" style={{ color: '#8A8D91' }}>
          Have an invite code?{' '}
          <Link href="/register/employee" className="font-medium" style={{ color: '#0B3D20' }}>Join as employee</Link>
        </p>
        <p className="text-center text-sm" style={{ color: '#8A8D91' }}>
          Already registered?{' '}
          <Link href="/sign-in" className="font-medium" style={{ color: '#0B3D20' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
