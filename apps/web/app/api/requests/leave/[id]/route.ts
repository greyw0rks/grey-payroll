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

  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: { include: { employer: true } } },
  })
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (leave.employee.employer.clerkUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: { status: action === 'approve' ? 'APPROVED' : 'REJECTED' },
  })

  return NextResponse.json({ leave: updated })
}
