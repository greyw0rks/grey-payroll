import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAddress, isAddress, verifyMessage, type Address } from 'viem'
import { Prisma, prisma } from '@grey/db'
import { getArcChain, isArcChainId, type ArcChainId } from '@grey/config/arc'
import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { verifyArcTreasury } from '@/lib/arc-treasury'

interface BindingChallenge { nonce: string; message: string; expiresAt: number; chainId: ArcChainId; contractAddress: Address; walletAddress: Address; origin: string }
function sameOrigin(request: Request) { return request.headers.get('origin') === new URL(request.url).origin }
export async function POST(request: Request) {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Use the company dashboard to link a treasury.' }, { status: 403 })
  try {
    const body = await request.json()
    if (!isArcChainId(body.chainId) || typeof body.walletAddress !== 'string' || !isAddress(body.walletAddress) || /^0x0{40}$/i.test(body.walletAddress)) return NextResponse.json({ error: 'Select an employer wallet on Arc Mainnet or Arc Testnet.' }, { status: 400 })
    const chain = getArcChain(body.chainId)
    const verified = await verifyArcTreasury(body.contractAddress, body.chainId)
    const nonce = randomUUID(), expiresAt = Date.now() + 5 * 60 * 1000, origin = new URL(request.url).origin
    const walletAddress = getAddress(body.walletAddress), contractAddress = getAddress(verified.address)
    const message = ['Link Grey company treasury', `Company: ${identity.employer.id}`, `Origin: ${origin}`, `Chain: ${body.chainId} (${chain.name})`, `Wallet: ${walletAddress}`, `Contract: ${contractAddress}`, `Nonce: ${nonce}`, `Expires: ${new Date(expiresAt).toISOString()}`, 'This signature links the company wallet and treasury. It does not authorize a payment.'].join('\n')
    const challenge: BindingChallenge = { nonce, message, expiresAt, chainId: body.chainId, walletAddress, contractAddress, origin }
    await prisma.employer.update({ where: { id: identity.employer.id }, data: { arcBindingChallenge: { ...challenge } } })
    return NextResponse.json(challenge, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not verify the Arc treasury.' }, { status: 400 }) }
}
export async function PATCH(request: Request) {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Use the company dashboard to link a treasury.' }, { status: 403 })
  try {
    const { nonce, signature } = await request.json()
    const challenge = identity.employer.arcBindingChallenge as unknown as BindingChallenge | null
    if (!challenge || challenge.nonce !== nonce || challenge.expiresAt <= Date.now() || challenge.origin !== new URL(request.url).origin || !isArcChainId(challenge.chainId)) return NextResponse.json({ error: 'Wallet challenge expired or was already used. Start again.' }, { status: 409 })
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 2048 || !await verifyMessage({ address: challenge.walletAddress, message: challenge.message, signature: signature as `0x${string}` })) return NextResponse.json({ error: 'The employer wallet signature does not match.' }, { status: 400 })
    await verifyArcTreasury(challenge.contractAddress, challenge.chainId)
    const result = await prisma.employer.updateMany({ where: { id: identity.employer.id, arcBindingChallenge: { equals: { ...challenge } } }, data: { arcTreasuryAddress: challenge.contractAddress, arcEmployerWallet: challenge.walletAddress, arcChainId: challenge.chainId, arcBindingChallenge: Prisma.DbNull } })
    if (result.count !== 1) return NextResponse.json({ error: 'Wallet challenge was already used or replaced. Start again.' }, { status: 409 })
    return NextResponse.json({ status: 'linked', chainId: challenge.chainId }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not link the employer wallet.' }, { status: 400 }) }
}
