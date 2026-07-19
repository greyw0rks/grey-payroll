'use client'

import { useEffect } from 'react'

interface ModalOverlayProps {
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
}

export function ModalOverlay({ onClose, children, maxWidth = 'sm:max-w-lg' }: ModalOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 ${maxWidth.includes('sm:') ? 'sm:px-6' : 'px-6'}`}
      style={{ background: 'rgba(22,24,28,0.55)' }}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} rounded-t-3xl sm:rounded-2xl pop overflow-hidden`}
        style={{ background: '#FFFFFF' }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
