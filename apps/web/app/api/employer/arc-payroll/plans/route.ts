import { NextResponse } from 'next/server'
import { Prisma } from '@grey/db'
import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { listCompanyPayments, createCompanyPayment } from '@/lib/arc-payments'
import { PaymentError } from '@/lib/arc-payment-proof'

export async function GET() {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  return NextResponse.json(await listCompanyPayments(identity.employer.id), { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function POST(request: Request) {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Prepare payments from the company dashboard.' }, { status: 403 })
  try {
    const { selections } = await request.json()
    return NextResponse.json(await createCompanyPayment(identity.employer.id, identity.userId, selections), { status: 201 })
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 409 : 503
    return NextResponse.json({ error: error instanceof PaymentError ? error.message : status === 409 ? 'A record is already reserved in another payment plan. Refresh your company payments.' : 'Could not prepare payment. Refresh and try again; no payment was sent.' }, { status })
  }
}
