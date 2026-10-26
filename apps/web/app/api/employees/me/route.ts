import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@grey/db'
import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { getCompanyDate } from '@/lib/checkin'

export async function GET() {
  const identity = await requireEmployee()
  if (isAuthError(identity)) return identity.error
  const { userId } = identity

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
        include: { arcPaymentItem: { select: { intent: { select: { status: true } } } } },
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
  const monthStart = getCompanyDate(new Date(), employee.employer.timezone); monthStart.setUTCDate(1)
  const releases = await prisma.salaryRelease.findMany({ where: { employeeId: employee.id, arcPaymentItem: { intent: { status: 'CONFIRMED', verifiedAt: { gte: monthStart } } } }, select: { amount: true } })
  return NextResponse.json({ ...employee, paidSalaryThisMonth: releases.reduce((sum, item) => sum + BigInt(item.amount), 0n).toString(), refundRequests: employee.refundRequests.map(refund => ({ ...refund, paymentStatus: refund.arcPaymentItem?.intent.status === 'CONFIRMED' ? 'PAID' : !refund.arcPaymentItem && refund.txHash ? 'HISTORICAL' : refund.status === 'APPROVED' ? 'AWAITING_PAYMENT' : refund.status })) })
}

export async function PATCH(request: NextRequest) {
  const identity = await requireEmployee()
  if (isAuthError(identity)) return identity.error
  const { walletAddress } = await request.json()
  if (typeof walletAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress) || /^0x0{40}$/.test(walletAddress)) return NextResponse.json({ error: 'Enter a valid salary wallet address.' }, { status: 400 })
  try {
    const saved = await prisma.$transaction(async tx => {
      // Serialize wallet changes with plan preparation; frozen recipients cannot
      // silently diverge from the salary wallet shown to an employee.
      await tx.$queryRaw`SELECT "id" FROM "Employer" WHERE "id" = ${identity.employee.employerId} FOR UPDATE`
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: identity.employee.id } })
      if (employee.walletAddress?.toLowerCase() !== walletAddress.toLowerCase() && await tx.arcPaymentItem.count({ where: { employeeId: employee.id, intent: { status: 'PREPARED' } } })) return false
      await tx.employee.update({ where: { id: employee.id }, data: { walletAddress: walletAddress.toLowerCase() } })
      return true
    })
    if (!saved) return NextResponse.json({ error: 'A payment to your current wallet is awaiting verification. Ask your employer to verify its original receipt before changing your salary wallet.' }, { status: 409 })
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Could not save this wallet. Check the address and try again.' }, { status: 409 }) }
}
