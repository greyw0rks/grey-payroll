import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@grey/db'

type AuthError = { error: NextResponse }
type EmployerOk = { userId: string; employer: Awaited<ReturnType<typeof prisma.employer.findUniqueOrThrow>> }
type EmployeeOk = { userId: string; employee: Awaited<ReturnType<typeof prisma.employee.findUniqueOrThrow>> }

// Checks the DB directly — avoids Clerk JWT propagation delays.
export async function requireEmployer(): Promise<AuthError | EmployerOk> {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId } })
  if (!employer) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { userId, employer }
}

export async function requireEmployee(): Promise<AuthError | EmployeeOk> {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const employee = await prisma.employee.findUnique({ where: { clerkUserId: userId } })
  if (!employee) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (employee.status !== 'ACTIVE') return { error: NextResponse.json({ error: 'Your employee account is not active. Contact your employer.' }, { status: 403 }) }
  return { userId, employee }
}

export function isAuthError(r: AuthError | EmployerOk | EmployeeOk): r is AuthError {
  return 'error' in r
}
