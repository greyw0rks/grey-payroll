export { arcTestnet } from './arc'
import { arcTestnet } from './arc'
export const supportedChains = [arcTestnet] as const
export function getExplorerUrl(chainId: number, txHash: string): string {
  if (chainId !== arcTestnet.id) throw new Error('Unsupported payroll chain.')
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash.')
  return `${arcTestnet.blockExplorers.default.url}/tx/${txHash}`
}
