/**
 * BalancePanel — employer funded balance, wallet USDC, deposit/withdraw.
 *
 * Correctness guarantees:
 * - Both deposit and withdraw route through executeControlledTx, which:
 *   - Simulates first; blocks on simulation failure.
 *   - Estimates gas with 30% headroom; BLOCKS on estimation failure (no guessing).
 *   - Enforces Arc 20 Gwei maxFeePerGas floor.
 *   - Checks native wallet balance ≥ gas + value; BLOCKS if insufficient.
 *   - Re-reads live chain/account from wallet provider immediately before send.
 *   - Passes gas and maxFeePerGas to the actual writeContract call.
 *   - Returns unknown on timeout/RPC error; only reverted receipt is definite failure.
 * - After a confirmed receipt, verifies the matching Deposited/Withdrawn event
 *   from the expected contract and employer with exact amount before showing success.
 * - Wallet display uses exact bigint from nativeBal.value (no parseFloat).
 * - Withdraw-all uses exact contractBal bigint from ledger read.
 * - Pending/timeout status is "unknown" — not "failed" with balance assumed unchanged.
 */
import React, { useState, useCallback } from 'react'
import {
  useAccount,
  useBalance,
  usePublicClient,
  useWalletClient,
  useSwitchChain,
} from 'wagmi'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from './Button'
import { useEmployerBalance } from '@/grey/hooks'
import { parseNativeUsdc, formatNativeUsdc, validateAmountStr } from '@/grey/money'
import { GREY_PAYROLL_ABI } from '@/grey/abi'
import { parseContractError } from '@/grey/errors'
import { executeControlledTx } from '@/grey/txController'
import { decodeEventLog } from 'viem'
import type { Hex } from 'viem'
import { toast } from 'sonner'

interface BalancePanelProps {
  contractAddress: `0x${string}`
  chainId: number
  onBalanceChange?: () => void
}

type OpState = 'idle' | 'pending' | 'success' | 'unknown' | 'error'

/**
 * Verify a Deposited or Withdrawn event exists in the receipt logs
 * from the expected contract+employer with the exact amount.
 */
function verifyBalanceEvent(
  logs: Array<{ address: Hex; topics: readonly Hex[]; data: Hex }>,
  contractAddress: string,
  employer: string,
  eventName: 'Deposited' | 'Withdrawn',
  expectedAmount: bigint,
): { ok: boolean; detail: string } {
  const contractLower = contractAddress.toLowerCase()
  for (const log of logs) {
    if (log.address.toLowerCase() !== contractLower) continue
    try {
      const decoded = decodeEventLog({
        abi: GREY_PAYROLL_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: false,
      })
      if (decoded.eventName !== eventName) continue
      const args = decoded.args as { employer: string; amount: bigint }
      if (args.employer.toLowerCase() !== employer.toLowerCase()) continue
      if (args.amount !== expectedAmount) {
        return {
          ok: false,
          detail: `${eventName} event found but amount ${args.amount} ≠ expected ${expectedAmount}.`,
        }
      }
      return { ok: true, detail: `${eventName} event verified: ${expectedAmount} wei.` }
    } catch {
      // skip unparseable log
    }
  }
  return { ok: false, detail: `No matching ${eventName} event found in receipt.` }
}

export function BalancePanel({ contractAddress, chainId, onBalanceChange }: BalancePanelProps) {
  const { address, chainId: walletChainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })

  const wrongChain = walletChainId !== chainId

  // On Arc, native balance IS USDC (18 dec). Show only ONE balance figure.
  const { data: nativeBal, refetch: refetchNative } = useBalance({ address, chainId })
  const { data: contractBal, refetch: refetchContract } = useEmployerBalance(
    contractAddress, address, chainId,
  )

  const [depositStr, setDepositStr] = useState('')
  const [withdrawStr, setWithdrawStr] = useState('')
  const [depositError, setDepositError] = useState<string | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const [depositState, setDepositState] = useState<OpState>('idle')
  const [withdrawState, setWithdrawState] = useState<OpState>('idle')
  const [depositStatusMsg, setDepositStatusMsg] = useState<string | null>(null)
  const [withdrawStatusMsg, setWithdrawStatusMsg] = useState<string | null>(null)

  const depositLocked = depositState === 'pending'
  const withdrawLocked = withdrawState === 'pending'

  const refetchAll = useCallback(() => {
    void refetchContract()
    void refetchNative()
    onBalanceChange?.()
  }, [refetchContract, refetchNative, onBalanceChange])

  // ── Deposit handler ─────────────────────────────────────────────────────────
  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault()
    const err = validateAmountStr(depositStr)
    if (err) { setDepositError(err); return }
    setDepositError(null)

    if (wrongChain) { switchChain({ chainId }); return }
    if (!address || !publicClient || !walletClient) {
      toast.error('Wallet or RPC not available.')
      return
    }

    const amount = parseNativeUsdc(depositStr)
    if (amount === null || amount === 0n) {
      setDepositError('Enter a valid positive amount.')
      return
    }

    setDepositState('pending')
    setDepositStatusMsg('Simulating…')

    // Build IWalletClient wrapper using live RPC reads
    const iwc = buildIWalletClient(walletClient)

    const result = await executeControlledTx(
      {
        address: contractAddress,
        abi: GREY_PAYROLL_ABI,
        functionName: 'deposit',
        value: amount,
        account: address,
        chainId,
      },
      buildIPublicClient(publicClient),
      iwc,
      {
        onStage: (stage) => {
          if (stage === 'simulating' || stage === 'estimating') setDepositStatusMsg('Simulating…')
          else if (stage === 'signing') setDepositStatusMsg('Approve in your wallet…')
          else if (stage === 'confirming') setDepositStatusMsg('Confirming on-chain…')
        },
        onGasEstimate: (gas, fee) => {
          const cost = gas * fee
          setDepositStatusMsg(`Gas est. ~${formatNativeUsdc(cost)} USDC — approve in wallet…`)
        },
      },
    )

    if (result.outcome === 'rejected') {
      setDepositState('error')
      setDepositStatusMsg(result.reason)
      toast.error(parseContractError(new Error(result.reason)))
      return
    }
    if (result.outcome === 'unknown') {
      setDepositState('unknown')
      setDepositStatusMsg(result.reason)
      toast.warning('Deposit outcome unknown — check explorer.')
      return
    }
    if (result.outcome === 'cancelled') {
      setDepositState('unknown')
      setDepositStatusMsg('Deposit transaction was cancelled. No funds moved.')
      toast.warning('Deposit cancelled.')
      return
    }
    if (result.outcome === 'failed') {
      setDepositState('error')
      setDepositStatusMsg('Transaction reverted — deposit not processed.')
      toast.error('Deposit reverted — balance unchanged.')
      return
    }

    // confirmed — verify Deposited event
    const evCheck = verifyBalanceEvent(result.receipt.logs, contractAddress, address, 'Deposited', amount)
    if (!evCheck.ok) {
      setDepositState('error')
      setDepositStatusMsg(`Deposit event mismatch: ${evCheck.detail}`)
      toast.error('Deposit event could not be verified.')
      return
    }

    setDepositState('success')
    setDepositStatusMsg(`Deposited ${formatNativeUsdc(amount)} USDC confirmed.`)
    toast.success('Deposit confirmed')
    setDepositStr('')
    setTimeout(() => setDepositState('idle'), 4000)
    refetchAll()
  }

  // ── Withdraw handler ────────────────────────────────────────────────────────
  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault()
    const err = validateAmountStr(withdrawStr)
    if (err) { setWithdrawError(err); return }
    setWithdrawError(null)

    if (wrongChain) { switchChain({ chainId }); return }
    if (!address || !publicClient || !walletClient) {
      toast.error('Wallet or RPC not available.')
      return
    }

    const amount = parseNativeUsdc(withdrawStr)
    if (amount === null || amount === 0n) {
      setWithdrawError('Enter a valid positive amount.')
      return
    }

    setWithdrawState('pending')
    setWithdrawStatusMsg('Simulating…')

    const iwc = buildIWalletClient(walletClient)

    const result = await executeControlledTx(
      {
        address: contractAddress,
        abi: GREY_PAYROLL_ABI,
        functionName: 'withdraw',
        args: [amount],
        account: address,
        chainId,
      },
      buildIPublicClient(publicClient),
      iwc,
      {
        onStage: (stage) => {
          if (stage === 'simulating' || stage === 'estimating') setWithdrawStatusMsg('Simulating…')
          else if (stage === 'signing') setWithdrawStatusMsg('Approve in your wallet…')
          else if (stage === 'confirming') setWithdrawStatusMsg('Confirming on-chain…')
        },
        onGasEstimate: (gas, fee) => {
          const cost = gas * fee
          setWithdrawStatusMsg(`Gas est. ~${formatNativeUsdc(cost)} USDC — approve in wallet…`)
        },
      },
    )

    if (result.outcome === 'rejected') {
      setWithdrawState('error')
      setWithdrawStatusMsg(result.reason)
      toast.error(parseContractError(new Error(result.reason)))
      return
    }
    if (result.outcome === 'unknown') {
      setWithdrawState('unknown')
      setWithdrawStatusMsg(result.reason)
      toast.warning('Withdrawal outcome unknown — check explorer.')
      return
    }
    if (result.outcome === 'cancelled') {
      setWithdrawState('unknown')
      setWithdrawStatusMsg('Withdrawal transaction was cancelled. No funds moved.')
      toast.warning('Withdrawal cancelled.')
      return
    }
    if (result.outcome === 'failed') {
      setWithdrawState('error')
      setWithdrawStatusMsg('Transaction reverted — withdrawal not processed.')
      toast.error('Withdrawal reverted — balance unchanged.')
      return
    }

    // confirmed — verify Withdrawn event
    const evCheck = verifyBalanceEvent(result.receipt.logs, contractAddress, address, 'Withdrawn', amount)
    if (!evCheck.ok) {
      setWithdrawState('error')
      setWithdrawStatusMsg(`Withdrawal event mismatch: ${evCheck.detail}`)
      toast.error('Withdrawal event could not be verified.')
      return
    }

    setWithdrawState('success')
    setWithdrawStatusMsg(`Withdrawn ${formatNativeUsdc(amount)} USDC confirmed.`)
    toast.success('Withdrawal confirmed')
    setWithdrawStr('')
    setTimeout(() => setWithdrawState('idle'), 4000)
    refetchAll()
  }

  // Exact bigint display — never parseFloat/formatted
  const walletDisplay = nativeBal ? `${formatNativeUsdc(nativeBal.value)} USDC` : '—'
  const contractDisplay = contractBal !== undefined ? `${formatNativeUsdc(contractBal)} USDC` : '—'

  return (
    <div className="space-y-4">
      {/* Balance summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Wallet size={14} className="text-[#6B6B6B]" />
            <span className="text-xs text-[#6B6B6B] font-medium uppercase tracking-wide" style={{ letterSpacing: '0.06em' }}>Wallet</span>
          </div>
          <p className="text-xl font-semibold tabular-nums" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {walletDisplay}
          </p>
          <p className="text-xs text-[#6B6B6B] mt-0.5">Available to deposit</p>
        </div>

        <div className="bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowDownToLine size={14} className="text-[#6B6B6B]" />
            <span className="text-xs text-[#6B6B6B] font-medium uppercase tracking-wide" style={{ letterSpacing: '0.06em' }}>Funded</span>
          </div>
          <p className="text-xl font-semibold tabular-nums" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {contractDisplay}
          </p>
          <p className="text-xs text-[#6B6B6B] mt-0.5">Your contract balance</p>
        </div>
      </div>

      {wrongChain && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-800">Switch wallet to the correct chain first.</p>
          <Button size="sm" variant="secondary" onClick={() => switchChain({ chainId })}>
            Switch Network
          </Button>
        </div>
      )}

      {/* Deposit */}
      <form onSubmit={(e) => { void handleDeposit(e) }} className="bg-white border border-[#E8E6DF] rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-semibold text-[#16181C]">Deposit USDC</h4>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={depositStr}
                onChange={(e) => { setDepositStr(e.target.value); setDepositError(null) }}
                placeholder="0.00"
                aria-label="Deposit amount in USDC"
                disabled={depositLocked}
                className="w-full h-10 pl-3 pr-16 text-sm tabular-nums border border-[#E8E6DF] rounded-lg bg-[#F9F8F5] text-[#16181C] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#16181C] disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B6B6B] font-mono">USDC</span>
            </div>
            {depositError && <p className="mt-1 text-xs text-[#D63B3B]" role="alert">{depositError}</p>}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={depositLocked}
            className="shrink-0"
          >
            Deposit
          </Button>
        </div>
        {depositStatusMsg && depositState !== 'idle' && (
          <p className={`text-xs ${depositState === 'error' ? 'text-[#D63B3B]' : depositState === 'unknown' ? 'text-amber-700' : 'text-[#6B6B6B]'}`} role={depositState === 'error' ? 'alert' : undefined}>
            {depositState === 'error' && <AlertCircle size={11} className="inline mr-1" />}
            {depositStatusMsg}
          </p>
        )}
      </form>

      {/* Withdraw */}
      <form onSubmit={(e) => { void handleWithdraw(e) }} className="bg-white border border-[#E8E6DF] rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-semibold text-[#16181C]">Withdraw USDC</h4>
        <p className="text-xs text-[#6B6B6B]">
          Withdraw uncommitted funds back to your wallet. Only your funded balance is withdrawable.
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={withdrawStr}
                onChange={(e) => { setWithdrawStr(e.target.value); setWithdrawError(null) }}
                placeholder="0.00"
                aria-label="Withdrawal amount in USDC"
                disabled={withdrawLocked}
                className="w-full h-10 pl-3 pr-16 text-sm tabular-nums border border-[#E8E6DF] rounded-lg bg-[#F9F8F5] text-[#16181C] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#16181C] disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B6B6B] font-mono">USDC</span>
            </div>
            {withdrawError && <p className="mt-1 text-xs text-[#D63B3B]" role="alert">{withdrawError}</p>}
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="md"
            loading={withdrawLocked}
            className="shrink-0"
          >
            <ArrowUpFromLine size={15} />
            Withdraw
          </Button>
        </div>
        {/* Withdraw-all: uses exact bigint from ledger, not formatted string */}
        <button
          type="button"
          onClick={() => {
            if (contractBal !== undefined && contractBal > 0n) {
              setWithdrawStr(formatNativeUsdc(contractBal))
            }
          }}
          className="text-xs text-[#16181C] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] rounded"
          disabled={!contractBal || contractBal === 0n || withdrawLocked}
          aria-label="Withdraw full balance"
        >
          Withdraw all
        </button>
        {withdrawStatusMsg && withdrawState !== 'idle' && (
          <p className={`text-xs ${withdrawState === 'error' ? 'text-[#D63B3B]' : withdrawState === 'unknown' ? 'text-amber-700' : 'text-[#6B6B6B]'}`} role={withdrawState === 'error' ? 'alert' : undefined}>
            {withdrawState === 'error' && <AlertCircle size={11} className="inline mr-1" />}
            {withdrawStatusMsg}
          </p>
        )}
      </form>

      {/* Refresh */}
      <button
        type="button"
        onClick={() => { void refetchContract(); void refetchNative() }}
        className="flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-[#16181C] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] rounded"
        aria-label="Refresh balances"
      >
        <RefreshCw size={12} />
        Refresh balances
      </button>
    </div>
  )
}

// ─── Adapter helpers — bridge wagmi clients to IPublicClient / IWalletClient ──

import type { IPublicClient, IWalletClient } from '@/grey/txController'

type WagmiPublicClient = NonNullable<ReturnType<typeof usePublicClient>>

function buildIPublicClient(pc: WagmiPublicClient): IPublicClient {
  return {
    simulateContract: (opts) => (pc.simulateContract as (o: unknown) => Promise<unknown>)(opts),
    estimateContractGas: (opts) => (pc.estimateContractGas as (o: unknown) => Promise<bigint>)(opts),
    estimateFeesPerGas: () => pc.estimateFeesPerGas(),
    getBalance: (opts) => pc.getBalance(opts),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    waitForTransactionReceipt: (opts) => (pc.waitForTransactionReceipt as (o: any) => Promise<import('@/grey/txController').MineableReceipt>)(opts),
    chain: pc.chain,
  }
}

function buildIWalletClient(wc: NonNullable<ReturnType<typeof useWalletClient>['data']>): IWalletClient {
  type FullWc = typeof wc & {
    getAddresses(): Promise<readonly `0x${string}`[]>
    getChainId(): Promise<number>
    writeContract: IWalletClient['writeContract']
  }
  const fullWc = wc as FullWc
  return {
    getAddresses: () => fullWc.getAddresses(),
    getChainId: () => fullWc.getChainId(),
    writeContract: fullWc.writeContract.bind(fullWc),
  }
}
