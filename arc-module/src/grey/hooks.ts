/**
 * Grey Payroll — wagmi hooks for contract interactions.
 */
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useSimulateContract } from 'wagmi'
import { GREY_PAYROLL_ABI } from './abi'

/** Read the employer's funded ledger balance (native USDC, 18 dec). */
export function useEmployerBalance(
  contractAddress: `0x${string}` | undefined,
  employer: `0x${string}` | undefined,
  chainId: number,
) {
  return useReadContract({
    address: contractAddress,
    abi: GREY_PAYROLL_ABI,
    functionName: 'balanceOf',
    args: employer ? [employer] : undefined,
    chainId,
    query: { enabled: Boolean(contractAddress && employer), refetchInterval: 10_000 },
  })
}

/** Read whether an employer has already executed a given run. */
export function useHasExecuted(
  contractAddress: `0x${string}` | undefined,
  employer: `0x${string}` | undefined,
  runId: `0x${string}` | undefined,
  chainId: number,
) {
  return useReadContract({
    address: contractAddress,
    abi: GREY_PAYROLL_ABI,
    functionName: 'hasExecuted',
    args: employer && runId ? [employer, runId] : undefined,
    chainId,
    query: { enabled: Boolean(contractAddress && employer && runId), staleTime: 5_000 },
  })
}

/** Read the contract's total deposited amount. */
export function useTotalDeposited(
  contractAddress: `0x${string}` | undefined,
  chainId: number,
) {
  return useReadContract({
    address: contractAddress,
    abi: GREY_PAYROLL_ABI,
    functionName: 'totalDeposited',
    chainId,
    query: { enabled: Boolean(contractAddress), refetchInterval: 15_000 },
  })
}

/** Simulate + write: deposit native USDC into the employer's ledger. */
export function useDeposit(
  contractAddress: `0x${string}` | undefined,
  amount: bigint,
  enabled: boolean,
) {
  const sim = useSimulateContract({
    address: contractAddress,
    abi: GREY_PAYROLL_ABI,
    functionName: 'deposit',
    value: amount,
    query: { enabled: enabled && Boolean(contractAddress) && amount > 0n },
  })
  const write = useWriteContract()
  return { sim, write }
}

/** Simulate + write: withdraw uncommitted funds. */
export function useWithdraw(
  contractAddress: `0x${string}` | undefined,
  amount: bigint,
  enabled: boolean,
) {
  const sim = useSimulateContract({
    address: contractAddress,
    abi: GREY_PAYROLL_ABI,
    functionName: 'withdraw',
    args: [amount],
    query: { enabled: enabled && Boolean(contractAddress) && amount > 0n },
  })
  const write = useWriteContract()
  return { sim, write }
}

/** Receipt poll hook (re-exported for convenience). */
export { useWaitForTransactionReceipt }
