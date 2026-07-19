'use client'

import { useState, useEffect } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useChainId,
  useReadContract,
} from 'wagmi'
import { PayrollTreasuryABI } from '@grey/config/abis'
import { ModalOverlay } from '@/components/ui/ModalOverlay'

const USDC_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

const CELO_SEPOLIA_ID = 11142220

// Read from env — set NEXT_PUBLIC_USDC_ADDRESS and NEXT_PUBLIC_TREASURY_USDC_ADDRESS in .env.local
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`

interface Props {
  treasuryContractAddress: string | null
}

// ─── Setup flow (no treasury set yet) ────────────────────────────────────────
function TreasurySetup() {
  const { isConnected } = useAccount()
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/employer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treasuryContractAddress: address }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to save')
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl p-6 space-y-4" style={{ background: '#16181C' }}>
      <div>
        <h3 className="font-display text-base font-semibold" style={{ color: '#FFFFFF' }}>
          Set up treasury
        </h3>
        <p className="text-sm mt-1" style={{ color: '#A8ACB1' }}>
          Connect your wallet, then enter your deployed PayrollTreasury contract address.
        </p>
      </div>

      <ConnectButton chainStatus="icon" showBalance={false} />

      {isConnected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#A8ACB1' }}>
              Treasury contract address (Celo Sepolia)
            </label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="0x..."
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#FFFFFF',
                fontFamily: 'var(--font-jbmono)',
              }}
            />
          </div>

          {error && <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>}

          <button
            onClick={save}
            disabled={saving || !/^0x[0-9a-fA-F]{40}$/.test(address)}
            className="w-full py-3 rounded-full text-sm font-semibold"
            style={{ background: '#3DDC84', color: '#0B3D20' }}
          >
            {saving ? 'Saving…' : 'Save treasury address'}
          </button>

          <p className="text-xs" style={{ color: '#8A8D91' }}>
            Deploy the contract first with{' '}
            <code style={{ fontFamily: 'var(--font-jbmono)' }}>
              forge script script/Deploy.s.sol --rpc-url celo-sepolia --broadcast
            </code>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Top-up modal (two-step: ERC20 approve → deposit) ────────────────────────
function TopUpModal({
  treasuryAddress,
  onClose,
}: {
  treasuryAddress: `0x${string}`
  onClose: () => void
}) {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'input' | 'approving' | 'depositing' | 'success'>('input')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [err, setErr] = useState<string | null>(null)

  const parsed = Number(amount)
  // USDC has 6 decimals
  const amountWei = parsed > 0 ? BigInt(Math.round(parsed * 1_000_000)) : 0n

  const { writeContract: approve, data: approveTxHash } = useWriteContract()
  const { writeContract: deposit, data: depositTxHash } = useWriteContract()

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositTxHash })

  // Once approve confirmed → deposit
  useEffect(() => {
    if (!approveConfirmed) return
    setStep('depositing')
    deposit({
      address: treasuryAddress,
      abi: PayrollTreasuryABI,
      functionName: 'deposit',
      args: [amountWei],
    }, {
      onError: (e) => { setErr(e.message); setStep('input') },
    })
  }, [approveConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Once deposit confirmed → success
  useEffect(() => {
    if (!depositConfirmed || !depositTxHash) return
    setTxHash(depositTxHash)
    setStep('success')
  }, [depositConfirmed, depositTxHash])

  function startDeposit() {
    if (!parsed || parsed <= 0) return
    setErr(null)
    setStep('approving')

    if (USDC_ADDRESS === '0x0000000000000000000000000000000000000000') {
      setErr('NEXT_PUBLIC_USDC_ADDRESS not set in .env.local')
      setStep('input')
      return
    }

    approve({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [treasuryAddress, amountWei],
    }, {
      onError: (e) => { setErr(e.message); setStep('input') },
    })
  }

  const wrongChain = chainId !== CELO_SEPOLIA_ID

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: '#ECEBE6' }}>
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: '#16181C' }}>Top up treasury</h2>
          <p className="text-xs mt-0.5" style={{ color: '#8A8D91' }}>Deposit USDC into your payroll vault on Celo Sepolia</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ background: '#F4F3EE', color: '#8A8D91' }}>✕</button>
      </div>

      <div className="px-6 py-5 space-y-5">
        {wrongChain && step === 'input' && (
          <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: '#FEF3DD' }}>
            <p className="text-sm" style={{ color: '#854F0B' }}>Switch to Celo Sepolia to continue</p>
            <button
              onClick={() => switchChain({ chainId: CELO_SEPOLIA_ID })}
              className="text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: '#854F0B', color: '#FEF3DD' }}
            >
              Switch
            </button>
          </div>
        )}

        {step === 'input' && (
          <>
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#8A8D91' }}>
                Deposit amount (USDC)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: '#8A8D91' }}>$</span>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  type="number"
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-3.5 rounded-xl text-lg font-semibold outline-none"
                  style={{ border: '2px solid #ECEBE6', background: '#F4F3EE', color: '#16181C' }}
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[100, 500, 1000].map(q => (
                  <button
                    key={q}
                    onClick={() => setAmount(String(q))}
                    className="text-xs font-medium px-3 py-1.5 rounded-full border"
                    style={{ borderColor: '#ECEBE6', color: '#16181C', background: '#FFFFFF' }}
                  >
                    +{q}
                  </button>
                ))}
              </div>
            </div>
            {err && <p className="text-sm" style={{ color: '#791F1F' }}>{err}</p>}
          </>
        )}

        {(step === 'approving' || step === 'depositing') && (
          <div className="flex flex-col items-center py-10 space-y-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl" style={{ background: '#E8FBF0' }}>⛓️</div>
            <div className="text-center">
              <p className="font-medium" style={{ color: '#16181C' }}>
                {step === 'approving' ? 'Step 1 of 2 — Approving USDC…' : 'Step 2 of 2 — Depositing…'}
              </p>
              <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>
                {step === 'approving' ? 'Confirm the USDC approval in your wallet' : 'Confirm the deposit transaction in your wallet'}
              </p>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="space-y-5">
            <div className="flex flex-col items-center py-6 space-y-3">
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl" style={{ background: '#E8FBF0' }}>✓</div>
              <div className="text-center">
                <p className="font-display font-semibold text-lg" style={{ color: '#16181C' }}>Deposit confirmed</p>
                <p className="text-sm mt-1" style={{ color: '#8A8D91' }}>{parsed.toLocaleString()} USDC added to your treasury</p>
              </div>
            </div>
            {txHash && (
              <div className="rounded-xl p-4 text-sm" style={{ background: '#F4F3EE' }}>
                <div className="flex justify-between items-center">
                  <span style={{ color: '#8A8D91' }}>Tx hash</span>
                  <a
                    href={`https://sepolia.celoscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline"
                    style={{ fontFamily: 'var(--font-jbmono)', color: '#1D9E75' }}
                  >
                    {txHash.slice(0, 10)}…{txHash.slice(-6)} ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-6 pb-6 pt-2 border-t" style={{ borderColor: '#ECEBE6' }}>
        {step === 'input' && (
          <button
            onClick={startDeposit}
            disabled={!parsed || parsed <= 0 || wrongChain}
            className="w-full py-3 rounded-full text-sm font-semibold"
            style={parsed > 0 && !wrongChain
              ? { background: '#3DDC84', color: '#0B3D20' }
              : { background: '#ECEBE6', color: '#8A8D91' }}
          >
            Deposit {parsed > 0 ? `${parsed.toLocaleString()} USDC` : ''}
          </button>
        )}
        {step === 'success' && (
          <button onClick={onClose} className="w-full py-3 rounded-full text-sm font-semibold" style={{ background: '#3DDC84', color: '#0B3D20' }}>
            Done
          </button>
        )}
      </div>
    </ModalOverlay>
  )
}

// ─── Treasury funded card ─────────────────────────────────────────────────────
function TreasuryFunded({ treasuryAddress }: { treasuryAddress: `0x${string}` }) {
  const [topUpOpen, setTopUpOpen] = useState(false)
  const { isConnected } = useAccount()

  // Read on-chain balance
  const { data: balance } = useReadContract({
    address: treasuryAddress,
    abi: PayrollTreasuryABI,
    functionName: 'getBalance',
  })

  const balanceUsdc = balance !== undefined
    ? (Number(balance) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '…'

  return (
    <div className="rounded-2xl p-6 space-y-4" style={{ background: '#16181C' }}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-base font-semibold" style={{ color: '#FFFFFF' }}>Treasury</h3>
          <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-jbmono)', color: '#A8ACB1' }}>
            {treasuryAddress.slice(0, 6)}…{treasuryAddress.slice(-4)}
          </p>
        </div>
        <a
          href={`https://sepolia.celoscan.io/address/${treasuryAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline"
          style={{ color: '#A8ACB1' }}
        >
          View ↗
        </a>
      </div>

      <div className="text-center py-4">
        <p className="font-display text-3xl font-semibold" style={{ color: '#FFFFFF' }}>{balanceUsdc}</p>
        <p className="text-sm mt-1" style={{ color: '#A8ACB1' }}>USDC balance</p>
      </div>

      {isConnected ? (
        <button
          onClick={() => setTopUpOpen(true)}
          className="w-full py-3 rounded-full text-sm font-medium"
          style={{ background: '#3DDC84', color: '#0B3D20' }}
        >
          Top up treasury
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs" style={{ color: '#A8ACB1' }}>Connect your wallet to top up</p>
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      )}

      {topUpOpen && (
        <TopUpModal
          treasuryAddress={treasuryAddress}
          onClose={() => setTopUpOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function TreasuryWidget({ treasuryContractAddress }: Props) {
  if (!treasuryContractAddress) return <TreasurySetup />
  return <TreasuryFunded treasuryAddress={treasuryContractAddress as `0x${string}`} />
}
