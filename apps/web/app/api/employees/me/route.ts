import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await prisma.employee.findUnique({
    where: { clerkUserId: userId },
    include: {
      employer: {
        select: {
          companyName: true,
          checkInWindowStart: true,
          checkInWindowEnd: true,
          timezone: true,
          workingDaysPerMonth: true,
        },
      },
      checkIns: {
        orderBy: { date: 'desc' },
        take: 31,
      },
      advanceRequests: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      refundRequests: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      leaveRequests: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(employee)
}
