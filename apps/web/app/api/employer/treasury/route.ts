import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextResponse } from 'next/server'
import { readArcTreasury } from '@/lib/arc-treasury'
import { getArcChain, isArcChainId } from '@grey/config/arc'
import { DEFAULT_ARC_CHAIN_ID } from '@/lib/arc-chain'

export async function GET() {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  const employer = identity.employer
  const linked = Boolean(employer.arcTreasuryAddress && employer.arcEmployerWallet)
  const chainId = linked && isArcChainId(employer.arcChainId) ? employer.arcChainId : DEFAULT_ARC_CHAIN_ID
  const chain = getArcChain(chainId)
  const context = { chainId, chainName: chain.name, explorerBase: chain.blockExplorers.default.url, decimals: 18, asset: 'native USDC', contractAddress: employer.arcTreasuryAddress, walletAddress: employer.arcEmployerWallet }
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!linked) return NextResponse.json({ ...context, status: 'unconfigured', balance: null }, { headers })
  try {
    if (!isArcChainId(employer.arcChainId)) throw new Error('Company treasury uses an unsupported Arc network.')
    const proof = await readArcTreasury(employer.arcTreasuryAddress!, employer.arcEmployerWallet!, employer.arcChainId)
    return NextResponse.json({ ...context, ...proof, status: 'verified' }, { headers })
  } catch (error) {
    return NextResponse.json({ ...context, status: 'unavailable', balance: null, error: error instanceof Error ? error.message : 'Arc treasury is unavailable.' }, { status: 503, headers })
  }
}
