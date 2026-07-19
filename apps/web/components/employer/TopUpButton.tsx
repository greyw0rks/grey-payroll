'use client'

import { useState } from 'react'
import { TopUpModal } from './TopUpModal'

interface Props {
  currentBalance?: number
  bufferFloor?: number
}

export function TopUpButton({ currentBalance, bufferFloor }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 rounded-full text-sm font-medium"
        style={{ background: '#3DDC84', color: '#0B3D20' }}
      >
        Top up now
      </button>
      {open && (
        <TopUpModal
          currentBalance={currentBalance}
          bufferFloor={bufferFloor}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
