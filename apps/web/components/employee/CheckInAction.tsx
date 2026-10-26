'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
export function CheckInAction({ employeeId, checkedIn, onLeave }: { employeeId: string; checkedIn: boolean; onLeave: boolean }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(checkedIn)
  const [error, setError] = useState('')
  return <div className="checkin-action"><button className="grey-button grey-button-primary" disabled={done || saving || onLeave} onClick={async () => {
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/employees/${employeeId}/checkin`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) { if (response.status === 409 && data.error === 'Already checked in today') { setDone(true); router.refresh(); return }; throw new Error(data.error || 'Could not check in. Try again.') }
      if (!data.checkIn?.id) throw new Error('Could not confirm attendance. Refresh and try again.')
      setDone(true); router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check in. Try again.') }
    finally { setSaving(false) }
  }}>{done ? 'Checked in today' : onLeave ? 'On approved leave' : saving ? 'Recording attendance…' : 'Check in for today'}</button><p role={error ? 'alert' : 'status'} className={error ? 'form-error' : 'muted'}>{error || (done ? 'Your attendance is recorded. Come back tomorrow.' : onLeave ? 'Enjoy your time off. No check-in is needed.' : 'One check-in per day. Your employer can see your attendance.')}</p></div>
}
