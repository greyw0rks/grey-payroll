import { NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { requireEmployer, isAuthError } from '@/lib/server-auth'

// Returns all pending/recent requests across advance, refund, and leave
// for the employer's staff — combined and sorted by date.
export async function GET() {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { employer } = auth

  const employeeIds = (
    await prisma.employee.findMany({
      where: { employerId: employer.id },
      select: { id: true, firstName: true, lastName: true, jobTitle: true },
    })
  )

  const ids = employeeIds.map(e => e.id)
  const empMap = new Map(employeeIds.map(e => [e.id, e]))

  const [advances, refunds, leaves] = await Promise.all([
    prisma.advanceRequest.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.refundRequest.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ])

  const combined = [
    ...advances.map(r => ({
      id: r.id,
      kind: 'Advance' as const,
      employeeId: r.employeeId,
      employee: empMap.get(r.employeeId)!,
      detail: r.reason,
      amount: r.amount,
      status: r.status,
      date: r.createdAt,
    })),
    ...refunds.map(r => ({
      id: r.id,
      kind: 'Refund' as const,
      employeeId: r.employeeId,
      employee: empMap.get(r.employeeId)!,
      detail: r.description || r.category,
      amount: r.amount,
      status: r.status,
      date: r.createdAt,
    })),
    ...leaves.map(r => ({
      id: r.id,
      kind: 'Leave' as const,
      employeeId: r.employeeId,
      employee: empMap.get(r.employeeId)!,
      detail: `${r.type} leave — ${r.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${r.endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${r.totalDays}d)`,
      amount: null,
      status: r.status,
      date: r.createdAt,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return NextResponse.json(combined)
}
