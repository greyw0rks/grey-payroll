import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const { action } = await req.json()

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const advance = await prisma.advanceRequest.findUnique({
    where: { id },
    include: { employee: { include: { employer: true } } },
  })
  if (!advance) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (advance.employee.employer.clerkUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updated = await prisma.advanceRequest.update({
    where: { id },
    data: {
      status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      outstandingBalance: action === 'approve' ? advance.amount : '0',
    },
  })

  return NextResponse.json({ advance: updated })
}
