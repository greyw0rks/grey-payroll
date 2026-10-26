import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 })

  const employee = await prisma.employee.findUnique({
    where: { inviteCode: code },
    include: { employer: { select: { companyName: true } } },
  })

  if (!employee) return NextResponse.json({ error: 'Invalid invitation code' }, { status: 404 })
  if (employee.status !== 'PENDING') return NextResponse.json({ error: 'Code already used' }, { status: 400 })
  if (employee.inviteExpiry && employee.inviteExpiry < new Date()) {
    return NextResponse.json({ error: 'Invitation code has expired' }, { status: 400 })
  }

  return NextResponse.json({
    valid: true,
    firstName: employee.firstName,
    lastName: employee.lastName,
    jobTitle: employee.jobTitle,
    companyName: employee.employer.companyName,
  })
}
