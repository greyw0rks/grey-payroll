import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma, Prisma } from '@grey/db'
import { isWithinCheckInWindow, getCompanyDate } from '@/lib/checkin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployee()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const employee = await prisma.employee.findUnique({
    where: { id, clerkUserId: userId },
    include: { employer: true },
  })

  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (employee.status !== 'ACTIVE') return NextResponse.json({ error: 'Account not active' }, { status: 400 })

  const now = new Date()
  const today = getCompanyDate(now, employee.employer.timezone)

  const existing = await prisma.checkIn.findUnique({
    where: { employeeId_date: { employeeId: id, date: today } },
  })
  if (existing && existing.status !== 'MISSED') {
    return NextResponse.json({ error: 'Already checked in today' }, { status: 409 })
  }
  const leave = await prisma.leaveRequest.findFirst({ where: { employeeId: id, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } } })
  if (leave) return NextResponse.json({ error: 'You are on approved leave today.' }, { status: 409 })
  const status = isWithinCheckInWindow(
    now,
    employee.employer.checkInWindowStart,
    employee.employer.checkInWindowEnd,
    employee.employer.timezone
  )

  if (!status) {
    return NextResponse.json({ error: 'Check-in window is closed' }, { status: 400 })
  }

  try {
    const checkIn = await prisma.$transaction(async tx => {
      if (existing) {
        const claimed = await tx.checkIn.updateMany({ where: { id: existing.id, status: 'MISSED' }, data: { timestamp: now, status, amount: employee.dailyRate } })
        if (!claimed.count) return null
        return tx.checkIn.findUnique({ where: { id: existing.id } })
      }
      return tx.checkIn.create({ data: { employeeId: id, date: today, timestamp: now, status, amount: employee.dailyRate } })
    })
    if (!checkIn) return NextResponse.json({ error: 'Already checked in today' }, { status: 409 })
    return NextResponse.json({ checkIn })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'Already checked in today' }, { status: 409 })
    throw error
  }
}
