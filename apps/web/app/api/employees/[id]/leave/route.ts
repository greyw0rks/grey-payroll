import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma, LeaveType } from '@grey/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployee()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const employee = await prisma.employee.findUnique({ where: { id, clerkUserId: userId } })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { type, startDate, endDate, note } = await req.json()
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (!Object.values(LeaveType).includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    return NextResponse.json({ error: 'Choose a valid leave type and an end date on or after the start date.' }, { status: 400 })
  }
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1

  const request = await prisma.leaveRequest.create({
    data: { employeeId: id, type, startDate: start, endDate: end, totalDays, note: note ?? null, status: 'PENDING' },
  })

  return NextResponse.json({ request })
}
