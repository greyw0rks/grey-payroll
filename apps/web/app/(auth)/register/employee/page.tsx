'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import Link from 'next/link'

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

export default function EmployeeRegisterPage() {
  const { address } = useAccount()
  const router = useRouter()
  const { session } = useClerk()

  const [step, setStep] = useState<'invite' | 'profile'>('invite')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState('')
  const [checkingInvite, setCheckingInvite] = useState(false)
  const [companyName, setCompanyName] = useState('')

  const [form, setForm] = useState({ phoneNumber: '', emergencyContact: '' })

  async function verifyInvite() {
    setCheckingInvite(true)
    setError(null)
    try {
      const res = await fetch(`/api/employees/invite/verify?code=${invite}`)
      if (!res.ok) throw new Error('Invalid or expired invitation code')
      const verified = await res.json()
      setCompanyName(verified.companyName)
      setStep('profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code')
    } finally {
      setCheckingInvite(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/employees/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: invite, walletAddress: address, ...form }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Registration failed')
      }

      // Navigate to / — the root server page checks the DB directly and
      // redirects to /home without depending on JWT propagation.
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#F4F3EE' }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-display font-semibold" style={{ color: '#16181C' }}>
            Join your team
          </h1>
          <p className="text-sm" style={{ color: '#8A8D91' }}>Enter your invitation code to get started.</p>
        </div>

        {step === 'invite' && (
          <div className="rounded-2xl border p-6 space-y-4" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
            <div>
              <label htmlFor="invitation-code" style={labelStyle}>Invitation code</label>
              <input
                id="invitation-code"
                style={{ ...inputStyle, textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '18px' }}
                value={invite}
                onChange={e => setInvite(e.target.value.toUpperCase())}
                placeholder="GRY-XXXX-XXXX"
                maxLength={13}
              />
            </div>
            {error && (
              <p className="text-sm rounded-xl p-3" style={{ background: '#FCEBEB', color: '#791F1F' }}>{error}</p>
            )}
            <button
              onClick={verifyInvite}
              disabled={invite.length < 6 || checkingInvite}
              className="w-full py-3 rounded-full text-sm font-medium"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              {checkingInvite ? 'Verifying…' : 'Verify code'}
            </button>
          </div>
        )}

        {step === 'profile' && (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border p-6 space-y-5"
            style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
          >
            <div className="p-3 rounded-xl" style={{ background: '#E8FBF0', border: '1px solid #3DDC84' }}>
              <p className="text-sm font-medium" style={{ color: '#0B3D20' }}>Join {companyName} by Grey</p>
              <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>
                Code: <span style={{ fontFamily: 'var(--font-jbmono)' }}>{invite}</span>
              </p>
            </div>

            <div>
              <label style={labelStyle}>Connect salary wallet</label>
              <div className="flex justify-center py-2">
                <ConnectButton />
              </div>
              {address && (
                <p className="text-xs text-center mt-1" style={{ color: '#8A8D91' }}>
                  USDC will be sent to:{' '}
                  <span style={{ fontFamily: 'var(--font-jbmono)' }}>
                    {address.slice(0, 6)}…{address.slice(-4)}
                  </span>
                </p>
              )}
            </div>

            <div>
              <label style={labelStyle}>Phone number</label>
              <input
                style={inputStyle}
                type="tel"
                value={form.phoneNumber}
                onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))}
                placeholder="+234 801 234 5678"
              />
            </div>

            <div>
              <label style={labelStyle}>Emergency contact</label>
              <input
                style={inputStyle}
                value={form.emergencyContact}
                onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))}
                placeholder="Name — phone number"
              />
            </div>

            {error && (
              <p className="text-sm rounded-xl p-3" style={{ background: '#FCEBEB', color: '#791F1F' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-full text-sm font-medium"
              style={{ background: '#3DDC84', color: '#0B3D20' }}
            >
              {submitting ? 'Activating account…' : 'Activate account'}
            </button>
          </form>
        )}

        <p className="text-center text-sm" style={{ color: '#8A8D91' }}>
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium" style={{ color: '#0B3D20' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
