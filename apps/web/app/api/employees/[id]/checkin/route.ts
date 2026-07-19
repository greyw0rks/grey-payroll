import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { isWithinCheckInWindow } from '@/lib/checkin'

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

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const existing = await prisma.checkIn.findUnique({
    where: { employeeId_date: { employeeId: id, date: today } },
  })
  if (existing && existing.status !== 'MISSED') {
    return NextResponse.json({ error: 'Already checked in today' }, { status: 400 })
  }

  const now = new Date()
  const status = isWithinCheckInWindow(
    now,
    employee.employer.checkInWindowStart,
    employee.employer.checkInWindowEnd,
    employee.employer.timezone
  )

  if (!status) {
    return NextResponse.json({ error: 'Check-in window is closed' }, { status: 400 })
  }

  const checkIn = await prisma.checkIn.upsert({
    where: { employeeId_date: { employeeId: id, date: today } },
    create: { employeeId: id, date: today, timestamp: now, status: status as 'ON_TIME' | 'LATE', amount: employee.dailyRate },
    update: { timestamp: now, status: status as 'ON_TIME' | 'LATE' },
  })

  return NextResponse.json({ checkIn })
}
