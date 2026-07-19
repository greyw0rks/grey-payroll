export type Token = {
  symbol: 'USDC' | 'cUSD'
  name: string
  decimals: number
  address: `0x${string}`
}

export const TOKENS = {
  // Celo Mainnet (42220)
  42220: {
    USDC: {
      symbol: 'USDC' as const,
      name: 'USD Coin',
      decimals: 6,
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`,
    },
    cUSD: {
      symbol: 'cUSD' as const,
      name: 'Celo Dollar',
      decimals: 18,
      address: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`,
    },
  },
  // Celo Sepolia Testnet (11142220) — replace Alfajores
  11142220: {
    USDC: {
      symbol: 'USDC' as const,
      name: 'USD Coin',
      decimals: 6,
      // Fill in from USDC_ADDRESS env var after deploying / bridging on Celo Sepolia
      address: (process.env.USDC_ADDRESS_TESTNET ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    },
    cUSD: {
      symbol: 'cUSD' as const,
      name: 'Celo Dollar',
      decimals: 18,
      address: (process.env.CUSD_ADDRESS_TESTNET ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    },
  },
} as const

export type SupportedChainId = keyof typeof TOKENS

export function toTokenUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals))
}

export function fromTokenUnits(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals)
  const whole = amount / divisor
  const fraction = amount % divisor
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 2)
  return `${whole}.${fractionStr}`
}
