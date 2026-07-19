import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function PATCH(req: NextRequest) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const body = await req.json()
  const { workingDaysPerMonth, checkInWindowStart, checkInWindowEnd, timezone, gracePeriodDays, absentPenaltyPercent } = body

  const employer = await prisma.employer.update({
    where: { clerkUserId: userId },
    data: { workingDaysPerMonth, checkInWindowStart, checkInWindowEnd, timezone, gracePeriodDays, absentPenaltyPercent },
  })

  return NextResponse.json({ id: employer.id })
}
