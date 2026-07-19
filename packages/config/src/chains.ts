import { defineChain } from 'viem'

export const celo = defineChain({
  id: 42220,
  name: 'Celo',
  nativeCurrency: { decimals: 18, name: 'CELO', symbol: 'CELO' },
  rpcUrls: {
    default: { http: [process.env.CELO_RPC_URL ?? 'https://forno.celo.org'] },
  },
  blockExplorers: {
    default: { name: 'Celoscan', url: 'https://celoscan.io' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 13112599,
    },
  },
})

// Celo Sepolia — replaced Alfajores as the Celo testnet (chain ID 11142220)
export const celoSepolia = defineChain({
  id: 11142220,
  name: 'Celo Sepolia',
  nativeCurrency: { decimals: 18, name: 'CELO', symbol: 'CELO' },
  rpcUrls: {
    default: { http: [process.env.CELO_TESTNET_RPC_URL ?? 'https://celo-sepolia.drpc.org'] },
  },
  blockExplorers: {
    default: { name: 'Celoscan Sepolia', url: 'https://sepolia.celoscan.io' },
  },
  testnet: true,
})

export const supportedChains = [celo, celoSepolia] as const

export function getExplorerUrl(chainId: number, txHash: string): string {
  if (chainId === 11142220) return `https://sepolia.celoscan.io/tx/${txHash}`
  if (chainId === 42220) return `https://celoscan.io/tx/${txHash}`
  return `https://celoscan.io/tx/${txHash}`
}
