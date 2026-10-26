import { auth } from '@clerk/nextjs/server'
import { prisma } from '@grey/db'
import { LandingPage } from '@/components/marketing/LandingPage'

export default async function RootPage() {
  const { userId } = await auth()
  if (!userId) return <LandingPage workspaceHref={null} />

  // Keep the public landing page visible after sign-in while making the
  // correct company workspace available without relying on JWT propagation.
  const [employer, employee] = await Promise.all([
    prisma.employer.findUnique({ where: { clerkUserId: userId }, select: { id: true } }),
    prisma.employee.findUnique({ where: { clerkUserId: userId }, select: { id: true } }),
  ])

  return <LandingPage workspaceHref={employer ? '/dashboard' : employee ? '/home' : '/register'} />
}
