'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
export function WalletSettings({ address }: { address: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(address || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  return <form className="space-y-3 mt-4" onSubmit={async event => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const response = await fetch('/api/employees/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ walletAddress: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save your wallet.')
      setMessage('Salary wallet saved.'); router.refresh()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not save your wallet.') }
    finally { setSaving(false) }
  }}><label className="block text-sm">Salary wallet address<input className="grey-input" value={value} onChange={event => setValue(event.target.value)} required placeholder="0x…" autoComplete="off" spellCheck={false} /></label><p className="text-xs muted">Your employer uses this address for payroll. Check it carefully before saving.</p><button className="grey-button" disabled={saving}>{saving ? 'Saving…' : 'Save salary wallet'}</button>{message ? <p className="text-sm" role="status">{message}</p> : null}</form>
}
