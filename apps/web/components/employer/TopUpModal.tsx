'use client'

import { useState } from 'react'
import { ModalOverlay } from '@/components/ui/ModalOverlay'

interface Props {
  currentBalance?: number
  bufferFloor?: number
  onClose: () => void
}

const QUICK_AMOUNTS = [1000, 5000, 10000]

export function TopUpModal({ currentBalance = 18420, bufferFloor = 14200, onClose }: Props) {
  const [amount, setAmount] = useState('')
  const [state, setState] = useState<'input' | 'confirming' | 'success'>('input')
  const [txHash, setTxHash] = useState('')

  const parsed = Number(amount)
  const newBalance = currentBalance + (parsed || 0)

  async function handleDeposit() {
    if (!parsed || parsed <= 0) return
    setState('confirming')
    // Simulate wagmi writeContract → PayrollTreasury.deposit(amount * 1e6)
    await new Promise(r => setTimeout(r, 900))
    setTxHash('0x4e21f3a9c8b0d7e6f1a2...88ac1d')
    setState('success')
    // When live:
    // const { writeContract } = useWriteContract()
    // writeContract({ address: treasuryAddress, abi: PayrollTreasuryABI, functionName: 'deposit', args: [BigInt(parsed * 1e6)] })
  }

  return (
    <ModalOverlay onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: '#ECEBE6' }}>
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: '#16181C' }}>Top up treasury</h2>
          <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>Deposit USDC into your payroll vault</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ background: '#F4F3EE', color: '#8A8D91' }}>✕</button>
      </div>

      <div className="px-6 py-5 space-y-5">

        {state === 'input' && (
          <>
            {/* Balance display */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4" style={{ background: '#F4F3EE' }}>
                <p className="text-xs mb-1" style={{ color: '#8A8D91' }}>Current balance</p>
                <p className="font-display text-lg font-semibold">{currentBalance.toLocaleString()} USDC</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: '#FEF3DD' }}>
                <p className="text-xs mb-1" style={{ color: '#854F0B' }}>Buffer floor (2 mo.)</p>
                <p className="font-display text-lg font-semibold" style={{ color: '#854F0B' }}>
                  {bufferFloor.toLocaleString()} USDC
                </p>
              </div>
            </div>

            {/* Amount input */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#8A8D91' }}>Deposit amount (USDC)</label>
              <div className="relative">
                <span
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium"
                  style={{ color: '#8A8D91' }}
                >
                  $
                </span>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  type="number"
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-3.5 rounded-xl text-lg font-semibold outline-none"
                  style={{ border: '2px solid #ECEBE6', background: '#F4F3EE', color: '#16181C' }}
                />
              </div>
              {/* Quick amounts */}
              <div className="flex gap-2 mt-2">
                {QUICK_AMOUNTS.map(q => (
                  <button
                    key={q}
                    onClick={() => setAmount(prev => String((Number(prev) || 0) + q))}
                    className="text-xs font-medium px-3 py-1.5 rounded-full border transition hover:opacity-80"
                    style={{ borderColor: '#ECEBE6', color: '#16181C', background: '#FFFFFF' }}
                  >
                    +{q.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            {parsed > 0 && (
              <div className="rounded-xl p-4 space-y-2 text-sm" style={{ background: '#E8FBF0' }}>
                <div className="flex justify-between">
                  <span style={{ color: '#8A8D91' }}>Current balance</span>
                  <span>{currentBalance.toLocaleString()} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#8A8D91' }}>Deposit</span>
                  <span className="font-medium" style={{ color: '#1D9E75' }}>+{parsed.toLocaleString()} USDC</span>
                </div>
                <div className="flex justify-between pt-2 border-t" style={{ borderColor: '#C8F0DC' }}>
                  <span className="font-semibold">New balance</span>
                  <span className="font-semibold">{newBalance.toLocaleString()} USDC</span>
                </div>
              </div>
            )}
          </>
        )}

        {state === 'confirming' && (
          <div className="flex flex-col items-center py-10 space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
              style={{ background: '#E8FBF0' }}
            >
              ⛓️
            </div>
            <div className="text-center">
              <p className="font-medium" style={{ color: '#16181C' }}>Confirming on Celo…</p>
              <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>
                Depositing {parsed.toLocaleString()} USDC into treasury
              </p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full"
                  style={{ background: '#3DDC84', opacity: 0.3 + i * 0.35 }}
                />
              ))}
            </div>
          </div>
        )}

        {state === 'success' && (
          <div className="space-y-5">
            <div className="flex flex-col items-center py-6 space-y-3">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
                style={{ background: '#E8FBF0' }}
              >
                ✓
              </div>
              <div className="text-center">
                <p className="font-display font-semibold text-lg" style={{ color: '#16181C' }}>Deposit confirmed</p>
                <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>
                  {parsed.toLocaleString()} USDC added to your treasury
                </p>
              </div>
            </div>

            <div className="rounded-xl p-4 space-y-2 text-sm" style={{ background: '#F4F3EE' }}>
              <div className="flex justify-between">
                <span style={{ color: '#8A8D91' }}>Amount deposited</span>
                <span className="font-medium">{parsed.toLocaleString()} USDC</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: '#8A8D91' }}>New balance</span>
                <span className="font-semibold" style={{ color: '#1D9E75' }}>{newBalance.toLocaleString()} USDC</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t" style={{ borderColor: '#ECEBE6' }}>
                <span style={{ color: '#8A8D91' }}>Tx hash</span>
                <span className="text-xs" style={{ fontFamily: 'var(--font-jbmono)', color: '#1D9E75' }}>
                  {txHash.slice(0, 20)}…
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-2 border-t" style={{ borderColor: '#ECEBE6' }}>
        {state === 'input' && (
          <button
            onClick={handleDeposit}
            disabled={!parsed || parsed <= 0}
            className="w-full py-3 rounded-full text-sm font-semibold"
            style={
              parsed > 0
                ? { background: '#3DDC84', color: '#0B3D20' }
                : { background: '#ECEBE6', color: '#8A8D91' }
            }
          >
            Deposit {parsed > 0 ? `${parsed.toLocaleString()} USDC` : ''}
          </button>
        )}
        {state === 'success' && (
          <button
            onClick={onClose}
            className="w-full py-3 rounded-full text-sm font-semibold"
            style={{ background: '#3DDC84', color: '#0B3D20' }}
          >
            Done
          </button>
        )}
      </div>
    </ModalOverlay>
  )
}
