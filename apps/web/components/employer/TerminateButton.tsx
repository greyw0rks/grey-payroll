'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TerminateModal } from './TerminateModal'

interface Props {
  employeeId: string
  employeeName: string
  monthlySalary?: number
}

export function TerminateButton({ employeeId, employeeName, monthlySalary }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  async function handleConfirm() {
    const res = await fetch(`/api/employees/${employeeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'TERMINATED' }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error ?? 'Failed to terminate')
    }
  }

  return (
    <>
      <div className="rounded-2xl border p-5" style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}>
        <h3 className="font-display text-sm font-semibold mb-1" style={{ color: '#16181C' }}>Offboarding</h3>
        <p className="text-sm mb-4" style={{ color: '#8A8D91' }}>
          Terminate employment and calculate final settlement including any salary owed and optional severance pay.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="text-sm font-medium px-4 py-2 rounded-full border"
          style={{ borderColor: '#791F1F', color: '#791F1F', background: '#FCEBEB' }}
        >
          Terminate employee
        </button>
      </div>

      {open && (
        <TerminateModal
          employeeId={employeeId}
          employeeName={employeeName}
          monthlySalary={monthlySalary}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            await handleConfirm()
            setOpen(false)
            router.push('/staff')
          }}
        />
      )}
    </>
  )
}
