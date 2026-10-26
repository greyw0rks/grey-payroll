import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@grey/db'
import Link from 'next/link'

export default async function RegisterLandingPage() {
  const { userId } = await auth()
  if (userId) {
    // Already registered — skip the landing page
    const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
    if (employer) redirect('/dashboard')
    const employee = await prisma.employee.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
    if (employee) redirect('/home')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#F4F3EE' }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4"
            style={{ background: '#3DDC84' }}
          >
            <span className="text-lg" style={{ color: '#0B3D20' }}>⚡</span>
          </div>
          <h1 className="text-2xl font-display font-semibold" style={{ color: '#16181C' }}>
            Welcome to Grey
          </h1>
          <p className="text-sm" style={{ color: '#8A8D91' }}>How are you joining?</p>
        </div>

        <div className="space-y-3">
          <Link
            href="/register/employer"
            className="block rounded-2xl border p-5 transition hover:border-[#3DDC84]"
            style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
          >
            <p className="font-display font-semibold text-sm mb-1" style={{ color: '#16181C' }}>
              I&apos;m an employer
            </p>
            <p className="text-sm" style={{ color: '#8A8D91' }}>
              Set up your company and manage payroll
            </p>
          </Link>

          <Link
            href="/register/employee"
            className="block rounded-2xl border p-5 transition hover:border-[#3DDC84]"
            style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
          >
            <p className="font-display font-semibold text-sm mb-1" style={{ color: '#16181C' }}>
              I have an invite code
            </p>
            <p className="text-sm" style={{ color: '#8A8D91' }}>
              Join your team as an employee
            </p>
          </Link>
        </div>

        <p className="text-center text-sm" style={{ color: '#8A8D91' }}>
          Already registered?{' '}
          <Link href="/sign-in" className="font-medium" style={{ color: '#0B3D20' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
