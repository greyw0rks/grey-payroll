import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@grey/db'

export default async function RootPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // JWT may not have propagated yet — check the DB directly.
  const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
  if (employer) redirect('/dashboard')

  const employee = await prisma.employee.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
  if (employee) redirect('/home')

  redirect('/register')
}
