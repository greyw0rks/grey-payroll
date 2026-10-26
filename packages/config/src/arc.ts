import { defineChain, formatUnits } from 'viem'

export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_NATIVE_DECIMALS = 18
export const BUSINESS_AMOUNT_DECIMALS = 6
export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: ARC_NATIVE_DECIMALS },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})
export const arcMainnet = defineChain({
  id: ARC_MAINNET_CHAIN_ID, name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: ARC_NATIVE_DECIMALS },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

export const ARC_CHAINS = [arcMainnet, arcTestnet] as const
export type ArcChainId = (typeof ARC_CHAINS)[number]['id']

export function isArcChainId(chainId: unknown): chainId is ArcChainId {
  return chainId === ARC_MAINNET_CHAIN_ID || chainId === ARC_TESTNET_CHAIN_ID
}

export function getArcChain(chainId: number) {
  const chain = ARC_CHAINS.find(candidate => candidate.id === chainId)
  if (!chain) throw new Error(`Unsupported Arc chain ${chainId}.`)
  return chain
}

// Explicit conversion for a new Arc payment. Existing salary/refund records
// remain six-decimal business amounts; historical records are not rescaled.
export function businessAmountToArc(amount: string): bigint {
  if (!/^\d+$/.test(amount)) throw new Error('Invalid business amount.')
  const result = BigInt(amount) * 10n ** BigInt(ARC_NATIVE_DECIMALS - BUSINESS_AMOUNT_DECIMALS)
  if (result > 2n ** 256n - 1n) throw new Error('Amount exceeds the Arc payment limit.')
  return result
}
export function formatArcMoney(amount: bigint): string {
  const [whole = '0', fraction = ''] = formatUnits(amount, ARC_NATIVE_DECIMALS).split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)} USDC`
}
export const arcPayrollReadAbi = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'employer', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
}] as const
