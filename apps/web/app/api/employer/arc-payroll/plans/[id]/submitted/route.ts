import { NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { requireEmployer, isAuthError } from '@/lib/server-auth'

// Recovery hint only. This route never confirms a payment or writes salary/refund amounts.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Use the company payment workspace.' }, { status: 403 })
  try {
    const { txHash } = await request.json()
    if (typeof txHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(txHash)) return NextResponse.json({ error: 'Enter a valid transaction hash.' }, { status: 400 })
    const changed = await prisma.arcPaymentIntent.updateMany({ where: { id: (await params).id, employerId: identity.employer.id, status: 'PREPARED' }, data: { submittedTxHash: txHash.toLowerCase() } })
    return NextResponse.json({ recorded: changed.count === 1, verified: false }, { status: changed.count ? 200 : 409 })
  } catch { return NextResponse.json({ error: 'Could not save the recovery hash. Keep the hash and original payment plan.' }, { status: 503 }) }
}
