'use client'

import { useState, useEffect } from 'react'

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '10px',
  border: '1px solid #ECEBE6',
  background: '#F4F3EE',
  color: '#16181C',
  fontSize: '14px',
  outline: 'none',
}

interface Settings {
  checkInStart: string
  checkInEnd: string
  workingDays: number
  gracePeriod: number
  penaltyPercent: number
  timezone: string
}

const DEFAULTS: Settings = {
  checkInStart: '07:00',
  checkInEnd: '10:00',
  workingDays: 22,
  gracePeriod: 0,
  penaltyPercent: 10,
  timezone: 'Africa/Lagos',
}

export default function SettingsPage() {
  const [form, setForm] = useState<Settings>(DEFAULTS)
  const [saved, setSaved] = useState<Settings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Employer info for display only
  const [companyName, setCompanyName] = useState('')
  const [treasuryAddress, setTreasuryAddress] = useState<string | null>(null)

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch('/api/employer')
        if (res.ok) {
          const data = await res.json()
          if (data.checkInWindowStart) {
            const loaded: Settings = {
              checkInStart: data.checkInWindowStart ?? DEFAULTS.checkInStart,
              checkInEnd: data.checkInWindowEnd ?? DEFAULTS.checkInEnd,
              workingDays: data.workingDaysPerMonth ?? DEFAULTS.workingDays,
              gracePeriod: data.gracePeriodDays ?? DEFAULTS.gracePeriod,
              penaltyPercent: data.absentPenaltyPercent ?? DEFAULTS.penaltyPercent,
              timezone: data.timezone ?? DEFAULTS.timezone,
            }
            setForm(loaded)
            setSaved(loaded)
            setCompanyName(data.companyName ?? '')
            setTreasuryAddress(data.treasuryContractAddress ?? null)
          }
        }
      } catch {
        setFetchError(null) // Non-fatal — defaults are fine
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved)

  function update<K extends keyof Settings>(field: K, value: Settings[K]) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/employer/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workingDaysPerMonth: form.workingDays,
          checkInWindowStart: form.checkInStart,
          checkInWindowEnd: form.checkInEnd,
          timezone: form.timezone,
          gracePeriodDays: form.gracePeriod,
          absentPenaltyPercent: form.penaltyPercent,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save')
      }
      setSaved(form)
      setToast('Settings saved')
      setTimeout(() => setToast(null), 2500)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Save failed')
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setForm(saved)
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <p className="text-sm" style={{ color: '#8A8D91' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: '#16181C' }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: '#8A8D91' }}>Configure your company payroll and attendance rules</p>
      </div>

      {fetchError && (
        <p className="text-sm px-1" style={{ color: '#791F1F' }}>{fetchError}</p>
      )}

      {/* Company info */}
      <section className="rounded-2xl border overflow-hidden" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: '#ECEBE6' }}>
          <h2 className="font-display text-sm font-semibold" style={{ color: '#16181C' }}>Company</h2>
        </div>
        <div className="p-5 space-y-4">
          {companyName && (
            <div className="flex items-center justify-between py-2 text-sm">
              <span style={{ color: '#8A8D91' }}>Company name</span>
              <span className="font-medium">{companyName}</span>
            </div>
          )}
          <div className="flex items-center justify-between py-2 text-sm border-t" style={{ borderColor: '#ECEBE6' }}>
            <span style={{ color: '#8A8D91' }}>Treasury chain</span>
            <span className="font-medium">Celo Sepolia</span>
          </div>
          <div className="flex items-center justify-between py-2 text-sm border-t" style={{ borderColor: '#ECEBE6' }}>
            <span style={{ color: '#8A8D91' }}>Payroll token</span>
            <span className="font-medium">USDC</span>
          </div>
          <div className="flex items-center justify-between py-2 text-sm border-t" style={{ borderColor: '#ECEBE6' }}>
            <span style={{ color: '#8A8D91' }}>Treasury address</span>
            {treasuryAddress ? (
              <span
                className="text-xs"
                style={{ fontFamily: 'var(--font-jbmono)', color: '#8A8D91' }}
              >
                {treasuryAddress.slice(0, 6)}…{treasuryAddress.slice(-4)}
              </span>
            ) : (
              <span className="text-xs" style={{ color: '#8A8D91' }}>Not connected</span>
            )}
          </div>
        </div>
      </section>

      {/* Attendance */}
      <section className="rounded-2xl border overflow-hidden" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: '#ECEBE6' }}>
          <h2 className="font-display text-sm font-semibold" style={{ color: '#16181C' }}>Attendance &amp; payroll</h2>
        </div>
        <div className="p-5 space-y-4">
          {/* Check-in window */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Check-in window</label>
            <div className="flex items-center gap-3">
              <input
                style={inputStyle}
                type="time"
                value={form.checkInStart}
                onChange={e => update('checkInStart', e.target.value)}
              />
              <span className="text-sm" style={{ color: '#8A8D91' }}>to</span>
              <input
                style={inputStyle}
                type="time"
                value={form.checkInEnd}
                onChange={e => update('checkInEnd', e.target.value)}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: '#8A8D91' }}>
              Employees must check in within this window to receive their daily salary
            </p>
          </div>

          {/* Timezone */}
          <div className="border-t pt-4" style={{ borderColor: '#ECEBE6' }}>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8A8D91' }}>Timezone</label>
            <input
              style={{ ...inputStyle, width: '100%' }}
              value={form.timezone}
              onChange={e => update('timezone', e.target.value)}
              placeholder="Africa/Lagos"
            />
          </div>

          {/* Working days */}
          <div className="border-t pt-4" style={{ borderColor: '#ECEBE6' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: '#16181C' }}>Working days per month</p>
                <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>Used to calculate daily salary rate</p>
              </div>
              <input
                style={{ ...inputStyle, width: '72px', textAlign: 'center' }}
                type="number"
                min={1} max={31}
                value={form.workingDays}
                onChange={e => update('workingDays', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Grace period */}
          <div className="border-t pt-4" style={{ borderColor: '#ECEBE6' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: '#16181C' }}>Grace period</p>
                <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>No-show days allowed before penalty kicks in</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  style={{ ...inputStyle, width: '72px', textAlign: 'center' }}
                  type="number"
                  min={0} max={7}
                  value={form.gracePeriod}
                  onChange={e => update('gracePeriod', Number(e.target.value))}
                />
                <span className="text-xs" style={{ color: '#8A8D91' }}>days</span>
              </div>
            </div>
          </div>

          {/* Penalty */}
          <div className="border-t pt-4" style={{ borderColor: '#ECEBE6' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: '#16181C' }}>Absence penalty</p>
                <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>% of daily rate deducted per extra no-show day</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  style={{ ...inputStyle, width: '72px', textAlign: 'center' }}
                  type="number"
                  min={0} max={100}
                  value={form.penaltyPercent}
                  onChange={e => update('penaltyPercent', Number(e.target.value))}
                />
                <span className="text-xs" style={{ color: '#8A8D91' }}>%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="px-6 py-3 rounded-full text-sm font-semibold transition"
          style={
            isDirty
              ? { background: '#3DDC84', color: '#0B3D20' }
              : { background: '#ECEBE6', color: '#8A8D91' }
          }
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {isDirty && (
          <button
            onClick={handleReset}
            className="px-4 py-3 rounded-full text-sm font-medium"
            style={{ color: '#8A8D91' }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full text-sm font-medium shadow-lg z-50 pop"
          style={{ background: '#16181C', color: '#FFFFFF' }}
        >
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
