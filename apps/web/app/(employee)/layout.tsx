import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@grey/db'
import { EmployeeShell } from './shell'

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')

  const jwtRole = (sessionClaims?.publicMetadata as { role?: string } | undefined)?.role
  if (jwtRole !== 'employee') {
    const employee = await prisma.employee.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
    if (!employee) redirect('/register')
  }

  return <EmployeeShell>{children}</EmployeeShell>
}
