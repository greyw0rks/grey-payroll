'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAccount, useSignMessage, useSwitchChain } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { ARC_CHAINS, formatArcMoney, getArcChain, isArcChainId, type ArcChainId } from '@grey/config/arc'
import { DEFAULT_ARC_CHAIN_ID } from '@/lib/arc-chain'

interface TreasuryState {
  status: 'unconfigured' | 'verified' | 'unavailable'
  balance: string | null
  chainId: number
  chainName: string
  explorerBase: string
  contractAddress: string | null
  walletAddress: string | null
  error?: string
}

export function TreasuryWidget() {
  const [treasury, setTreasury] = useState<TreasuryState | null>(null)
  const [chainId, setChainId] = useState<ArcChainId>(DEFAULT_ARC_CHAIN_ID)
  const [contractAddress, setContractAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const account = useAccount(), { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage(), { switchChainAsync } = useSwitchChain()

  async function refresh(signal?: AbortSignal) {
    try {
      const response = await fetch('/api/employer/treasury', { cache: 'no-store', signal })
      const data = await response.json()
      if (signal?.aborted) return
      if (!data.status) throw new Error(data.error || 'Treasury unavailable.')
      setTreasury(data)
      if (isArcChainId(data.chainId)) setChainId(data.chainId)
      setError(null)
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Treasury unavailable.')
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [])

  async function linkTreasury(event: React.FormEvent) {
    event.preventDefault()
    if (!account.address || busy) return
    setBusy(true); setError(null)
    try {
      if (account.chainId !== chainId) await switchChainAsync({ chainId })
      const response = await fetch('/api/employer/treasury/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: contractAddress.trim(), walletAddress: account.address, chainId }),
      })
      const challenge = await response.json()
      if (!response.ok) throw new Error(challenge.error || 'Treasury verification failed.')
      const signature = await signMessageAsync({ message: challenge.message, account: account.address })
      const saved = await fetch('/api/employer/treasury/bind', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: challenge.nonce, signature }),
      })
      const result = await saved.json()
      if (!saved.ok) throw new Error(result.error || 'Could not link the treasury.')
      setEditing(false)
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not link the treasury.')
    } finally {
      setBusy(false)
    }
  }

  const showSetup = editing || treasury?.status === 'unconfigured'
  const selectedChain = getArcChain(chainId)
  const displayedChain = treasury && isArcChainId(treasury.chainId) ? getArcChain(treasury.chainId) : selectedChain

  return <section className="wallet-summary">
    <h2>Remaining treasury balance</h2>
    <p className="wallet-amount">{treasury?.status === 'verified' && treasury.balance !== null ? formatArcMoney(BigInt(treasury.balance)) : !treasury && !error ? 'Loading treasury…' : 'Balance unavailable'}</p>
    <p>{treasury?.status === 'unconfigured' ? `Link your employer wallet and Grey treasury on ${selectedChain.name}.` : treasury?.status === 'verified' ? `Employer ledger · native USDC on ${displayedChain.name}` : treasury?.error || error || `Checking ${displayedChain.name}…`}</p>
    {treasury?.contractAddress ? <a className="wallet-address" href={`${displayedChain.blockExplorers.default.url}/address/${treasury.contractAddress}`} target="_blank" rel="noreferrer">{treasury.contractAddress.slice(0, 8)}…{treasury.contractAddress.slice(-6)}</a> : null}
    {showSetup ? <form className="mt-5 space-y-3" onSubmit={linkTreasury}>
      <label className="block text-sm" htmlFor="arc-chain">Arc network</label>
      <select id="arc-chain" className="w-full rounded-lg border p-3 text-sm" value={chainId} onChange={event => setChainId(Number(event.target.value) as ArcChainId)} disabled={busy}>
        {ARC_CHAINS.map(chain => <option key={chain.id} value={chain.id}>{chain.name}{chain.testnet ? ' · test funds' : ' · real USDC'}</option>)}
      </select>
      <label className="block text-sm" htmlFor="arc-treasury-address">Arc treasury contract</label>
      <input id="arc-treasury-address" className="w-full rounded-lg border p-3 text-sm" value={contractAddress} onChange={event => setContractAddress(event.target.value)} placeholder="0x…" autoComplete="off" required disabled={busy} />
      <p className="text-sm muted">Deploy or attach your treasury in Arc payroll, then link it with a wallet signature.{!selectedChain.testnet ? ' Mainnet uses real USDC; verify the contract address before signing.' : ''}</p>
      {account.address ? <button className="grey-button" type="submit" disabled={busy}>{busy ? 'Verifying and linking…' : 'Sign to link treasury'}</button> : <button className="grey-button" type="button" onClick={openConnectModal}>Connect employer wallet</button>}
    </form> : <div className="mt-5 flex flex-wrap gap-3">
      <Link href="/arc-payroll" className="grey-button">Manage Arc treasury</Link>
      <button className="wallet-link" onClick={() => refresh()}>Refresh</button>
      <button className="wallet-link" onClick={() => { setContractAddress(treasury?.contractAddress || ''); if (treasury && isArcChainId(treasury.chainId)) setChainId(treasury.chainId); setEditing(true) }}>Change linked treasury</button>
    </div>}
    {error ? <p className="mt-3 text-sm" role="alert">{error}</p> : null}
    {showSetup ? <Link href="/arc-payroll" className="wallet-link block mt-3">Open Arc payroll</Link> : null}
  </section>
}
