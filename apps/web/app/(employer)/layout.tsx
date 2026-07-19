import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@grey/db'
import { EmployerShell } from './shell'

export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')

  const jwtRole = (sessionClaims?.publicMetadata as { role?: string } | undefined)?.role
  if (jwtRole !== 'employer') {
    const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
    if (!employer) redirect('/register')
  }

  return <EmployerShell>{children}</EmployerShell>
}
