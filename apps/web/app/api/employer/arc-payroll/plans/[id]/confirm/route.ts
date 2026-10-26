import { NextResponse } from 'next/server'
import { Prisma } from '@grey/db'
import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { confirmCompanyPayment } from '@/lib/arc-payments'
import { PaymentError } from '@/lib/arc-payment-proof'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Record payments from the company dashboard.' }, { status: 403 })
  try {
    const { txHash } = await request.json()
    if (typeof txHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(txHash)) return NextResponse.json({ error: 'Enter the public payment transaction hash.' }, { status: 400 })
    return NextResponse.json(await confirmCompanyPayment(identity.employer.id, (await params).id, txHash), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'This transaction or salary record is already associated with a payment. Keep the original plan and review its history.' }, { status: 409 })
    return NextResponse.json({ error: error instanceof PaymentError ? error.message : 'Receipt verification is unavailable. Keep the original plan and hash; verify again without sending another payment.' }, { status: error instanceof PaymentError ? error.status : 503 })
  }
}
