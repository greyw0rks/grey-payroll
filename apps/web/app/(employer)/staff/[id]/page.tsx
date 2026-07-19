import { auth } from '@clerk/nextjs/server'
import { prisma } from '@grey/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TerminateButton } from '@/components/employer/TerminateButton'

const truncateAddress = (addr: string, n = 6) =>
  `${addr.slice(0, n)}…${addr.slice(-4)}`

export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId } = await auth()
  const { id } = await params

  const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId! } })
  if (!employer) notFound()

  const employee = await prisma.employee.findUnique({
    where: { id, employerId: employer.id },
    include: {
      checkIns: { orderBy: { date: 'desc' }, take: 30 },
      salaryReleases: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!employee) notFound()

  const totalEarned = employee.salaryReleases.reduce(
    (sum: bigint, r: { amount: string }) => sum + BigInt(r.amount),
    BigInt(0)
  )
  const humanEarned = (Number(totalEarned) / 1e6).toFixed(2)

  const statusColor = employee.status === 'ACTIVE'
    ? { color: '#1D9E75', background: '#E8FBF0' }
    : { color: '#791F1F', background: '#FCEBEB' }

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/staff" className="text-sm font-medium" style={{ color: '#8A8D91' }}>
        ← Staff
      </Link>

      <div
        className="rounded-2xl border p-6 flex items-center gap-4"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center font-display font-bold text-xl shrink-0"
          style={{ background: '#E8FBF0', color: '#0B3D20' }}
        >
          {employee.firstName[0]}{employee.lastName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold font-display" style={{ color: '#16181C' }}>
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-sm" style={{ color: '#8A8D91' }}>{employee.jobTitle}</p>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={statusColor}>
          {employee.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Monthly Salary', value: `${(Number(employee.monthlySalary) / 1e6).toFixed(2)} ${employee.currency}` },
          { label: 'Total Earned',   value: `${humanEarned} ${employee.currency}` },
          { label: 'Wallet',         value: employee.walletAddress ? truncateAddress(employee.walletAddress, 6) : '—', mono: true },
          { label: 'Start Date',     value: new Date(employee.startDate).toLocaleDateString() },
        ].map(({ label, value, mono }) => (
          <div
            key={label}
            className="rounded-2xl border p-4 space-y-1"
            style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
          >
            <p className="text-xs" style={{ color: '#8A8D91' }}>{label}</p>
            <p className="font-medium text-sm" style={mono ? { fontFamily: 'var(--font-jbmono)' } : undefined}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
      >
        <div className="p-5 border-b" style={{ borderColor: '#ECEBE6' }}>
          <h2 className="font-display text-sm font-semibold">Recent Check-ins</h2>
        </div>
        {employee.checkIns.length === 0 ? (
          <p className="p-5 text-sm" style={{ color: '#8A8D91' }}>No check-ins yet.</p>
        ) : (
          <ul className="divide-y text-sm" style={{ borderColor: '#ECEBE6' }}>
            {employee.checkIns.map((ci: { id: string; date: Date; status: string }) => {
              const c = ci.status === 'ON_TIME' ? '#1D9E75' : ci.status === 'LATE' ? '#854F0B' : '#791F1F'
              return (
                <li key={ci.id} className="flex justify-between px-5 py-3">
                  <span>{new Date(ci.date).toLocaleDateString()}</span>
                  <span className="font-medium" style={{ color: c }}>{ci.status}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <TerminateButton
        employeeId={employee.id}
        employeeName={`${employee.firstName} ${employee.lastName}`}
        monthlySalary={Number(employee.monthlySalary) / 1e6}
      />
    </div>
  )
}
