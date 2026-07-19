import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { generateInviteCode } from '@/lib/invites'
import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { DEFAULT_WORKING_DAYS_PER_MONTH } from '@grey/config/constants'

export async function GET() {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { employer } = auth

  const employees = await prisma.employee.findMany({
    where: { employerId: employer.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(employees)
}

export async function POST(req: NextRequest) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { employer } = auth

  const body = await req.json()
  const { firstName, lastName, jobTitle, monthlySalary, currency, startDate, ipfsDocHash } = body

  const workingDays = employer.workingDaysPerMonth ?? DEFAULT_WORKING_DAYS_PER_MONTH
  const dailyRateBigInt = BigInt(monthlySalary) / BigInt(workingDays)
  const inviteCode = generateInviteCode()
  const inviteExpiry = new Date()
  inviteExpiry.setDate(inviteExpiry.getDate() + 7)

  const employee = await prisma.employee.create({
    data: {
      employerId: employer.id,
      firstName,
      lastName,
      jobTitle,
      monthlySalary: monthlySalary.toString(),
      dailyRate: dailyRateBigInt.toString(),
      currency,
      startDate: new Date(startDate),
      inviteCode,
      inviteExpiry,
      ipfsDocHash,
    },
  })

  return NextResponse.json({ employee, inviteCode })
}
