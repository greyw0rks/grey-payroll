/**
 * Grey Payroll — Arc chain configuration.
 * Values sourced from @/onchain-facts registry; never hardcoded.
 */
import { defineChain } from 'viem'
import { requireChain } from '@/onchain-facts'

const arcTestnetFact = requireChain(5042002)
const arcMainnetFact = requireChain(5042)

/** Arc Testnet (chain ID 5042002) — native USDC, 18 decimals. */
export const arcTestnet = defineChain({
  id: arcTestnetFact.chainId,
  name: arcTestnetFact.name,
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: arcTestnetFact.nativeCurrency.decimals, // 18
  },
  rpcUrls: {
    default: { http: arcTestnetFact.rpcUrls as [string, ...string[]] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: arcTestnetFact.explorerBase },
  },
  testnet: true,
})

/** Arc Mainnet (chain ID 5042) — native USDC, 18 decimals. */
export const arcMainnet = defineChain({
  id: arcMainnetFact.chainId,
  name: arcMainnetFact.name,
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: arcMainnetFact.nativeCurrency.decimals, // 18
  },
  rpcUrls: {
    default: { http: arcMainnetFact.rpcUrls as [string, ...string[]] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: arcMainnetFact.explorerBase },
  },
})

export const SUPPORTED_CHAINS = [arcTestnet, arcMainnet] as const
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]['id']

/** Returns the Arc explorer URL for a transaction hash. */
export function explorerTxUrl(chainId: number, txHash: string): string {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId)
  if (!chain) return `https://explorer.testnet.arc.io/tx/${txHash}`
  return `${chain.blockExplorers.default.url}/tx/${txHash}`
}

/** Returns the Arc explorer URL for an address. */
export function explorerAddressUrl(chainId: number, address: string): string {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId)
  if (!chain) return `https://explorer.testnet.arc.io/address/${address}`
  return `${chain.blockExplorers.default.url}/address/${address}`
}
