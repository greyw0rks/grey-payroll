import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const { action, rejectionReason } = await req.json()

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const refund = await prisma.refundRequest.findUnique({
    where: { id },
    include: { employee: { include: { employer: true } } },
  })
  if (!refund) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (refund.employee.employer.clerkUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (refund.status !== 'PENDING' || refund.txHash) return NextResponse.json({ error: 'This refund has already been reviewed or paid.' }, { status: 409 })
  const claimed = await prisma.refundRequest.updateMany({
    where: { id, status: 'PENDING', txHash: null, arcPaymentItem: null },
    data: {
      status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      rejectionReason: action === 'reject' ? (rejectionReason ?? null) : null,
      reviewedById: userId,
    },
  })
  if (claimed.count !== 1) return NextResponse.json({ error: 'This refund was reviewed or reserved by another operation.' }, { status: 409 })
  return NextResponse.json({ refund: await prisma.refundRequest.findUnique({ where: { id } }) })
}
