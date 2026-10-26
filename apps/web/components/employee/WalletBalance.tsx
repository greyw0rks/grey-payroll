'use client'
import Link from 'next/link'
import { useBalance } from 'wagmi'
import { isAddress } from 'viem'
import { formatArcMoney, getArcChain, isArcChainId } from '@grey/config/arc'
import { DEFAULT_ARC_CHAIN_ID } from '@/lib/arc-chain'

export function WalletBalance({ walletAddress, chainId }: { walletAddress: string | null; chainId?: number; currency?: string }) {
  const address = walletAddress && isAddress(walletAddress) && !/^0x0{40}$/i.test(walletAddress) ? walletAddress : undefined
  const selectedChainId = isArcChainId(chainId) ? chainId : DEFAULT_ARC_CHAIN_ID
  const chain = getArcChain(selectedChainId)
  const { data, isPending, isError, refetch } = useBalance({ address, chainId: selectedChainId, query: { enabled: Boolean(address) } })
  return <section className="wallet-summary"><h2>My wallet balance</h2><p className="wallet-amount">{!address ? 'Balance unavailable' : isPending ? 'Loading balance…' : isError || !data ? 'Balance unavailable' : formatArcMoney(data.value)}</p><p>{!address ? 'Add a salary wallet to view your balance.' : isError ? `Could not load ${chain.name}. Try again.` : `Native USDC on ${chain.name}.`}</p>{!address ? <Link href="/profile" className="wallet-link">Set up my wallet</Link> : isError ? <button className="wallet-link" onClick={() => refetch()}>Refresh balance</button> : <a className="wallet-address" href={`${chain.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">{address.slice(0, 8)}…{address.slice(-6)}</a>}</section>
}
