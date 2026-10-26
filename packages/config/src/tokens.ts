import { formatUnits, parseUnits } from 'viem'
import { arcTestnet } from './arc'
export const TOKENS = { [arcTestnet.id]: { USDC: { symbol: 'USDC', name: 'Native USDC', decimals: 18, native: true } } } as const
export type SupportedChainId = keyof typeof TOKENS
export function toTokenUnits(amount: string, decimals = 18): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount) || (amount.split('.')[1]?.length || 0) > decimals) throw new Error('Invalid token amount.')
  return parseUnits(amount, decimals)
}
export function fromTokenUnits(amount: bigint, decimals = 18): string { return formatUnits(amount, decimals) }
