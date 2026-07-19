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

  const updated = await prisma.refundRequest.update({
    where: { id },
    data: {
      status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      rejectionReason: action === 'reject' ? (rejectionReason ?? null) : null,
    },
  })

  return NextResponse.json({ refund: updated })
}
