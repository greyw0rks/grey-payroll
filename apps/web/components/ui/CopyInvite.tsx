'use client'
import { useState } from 'react'
export function CopyInvite({ code }: { code: string }) {
  const [message, setMessage] = useState('Copy code')
  return <button type="button" className="grey-button grey-button-small" onClick={async () => {
    try { await navigator.clipboard.writeText(code); setMessage('Copied') }
    catch { setMessage('Select code to copy') }
  }} aria-label={`${message}: ${code}`}>{message}</button>
}
