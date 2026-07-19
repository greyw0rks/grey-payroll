import { auth } from '@clerk/nextjs/server'
import { prisma } from '@grey/db'
import { redirect } from 'next/navigation'
import { TreasuryWidget } from '@/components/employer/TreasuryWidget'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
    >
      {children}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    PENDING:  ['#854F0B', '#FEF3DD'],
    APPROVED: ['#1D9E75', '#E8FBF0'],
    REJECTED: ['#791F1F', '#FCEBEB'],
  }
  const [color, bg] = map[status] ?? ['#8A8D91', '#F4F3EE']
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap" style={{ color, background: bg }}>
      {label}
    </span>
  )
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
      style={{ background: '#E8FBF0', color: '#0B3D20' }}
    >
      {initials}
    </div>
  )
}

function Bars({ count }: { count: number }) {
  const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
  // Uniform bars since we don't track monthly aggregates yet
  const data = Array.from({ length: 12 }, (_, i) => (i === 11 ? 80 : 60 + Math.floor(Math.sin(i) * 15)))
  const max = Math.max(...data)
  return (
    <div>
      <div className="flex items-end gap-2 h-40">
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md"
            style={{
              height: `${(v / max) * 100}%`,
              background: i === data.length - 1 ? '#3DDC84' : '#E8FBF0',
            }}
          />
        ))}
      </div>
      <div className="flex gap-2 mt-2 text-xs" style={{ color: '#8A8D91' }}>
        {months.map(m => (
          <span key={m} className="flex-1 text-center">{m}</span>
        ))}
      </div>
      <p className="text-xs mt-3 text-center" style={{ color: '#8A8D91' }}>
        {count} active employees · 12 months of payroll
      </p>
    </div>
  )
}

function formatAmount(amount: string) {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' USDC'
}

export default async function EmployerDashboardPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const employer = await prisma.employer.findUnique({
    where: { clerkUserId: userId },
    include: {
      employees: { where: { status: 'ACTIVE' } },
    },
  })

  if (!employer) redirect('/register/employer')

  const [pendingAdvances, pendingRefunds, pendingLeaves] = await Promise.all([
    prisma.advanceRequest.count({
      where: { status: 'PENDING', employee: { employerId: employer.id } },
    }),
    prisma.refundRequest.count({
      where: { status: 'PENDING', employee: { employerId: employer.id } },
    }),
    prisma.leaveRequest.count({
      where: { status: 'PENDING', employee: { employerId: employer.id } },
    }),
  ])

  const pendingRequests = pendingAdvances + pendingRefunds + pendingLeaves

  const recentAdvances = await prisma.advanceRequest.findMany({
    where: { employee: { employerId: employer.id } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      employee: { select: { firstName: true, lastName: true } },
    },
  })

  const activeCount = employer.employees.length

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm mb-1" style={{ color: '#8A8D91' }}>Ready to manage payroll?</p>
        <h1 className="font-display text-2xl font-semibold" style={{ color: '#16181C' }}>
          Welcome back, {employer.companyName}
        </h1>
      </div>

      {/* Metric cards */}
      <div className="flex flex-wrap gap-4">
        {/* Active employees */}
        <Card className="p-5 flex-1 min-w-[220px]">
          <p className="text-sm mb-3" style={{ color: '#8A8D91' }}>Active employees</p>
          <p className="font-display text-2xl font-semibold mb-3" style={{ color: '#16181C' }}>{activeCount}</p>
          <div className="flex items-end gap-1 h-6">
            {[16, 22, 14, 26, 18, 24, 16].map((h, i) => (
              <div
                key={i}
                className="w-1.5 rounded-full"
                style={{ height: h, background: i % 2 === 0 ? '#E8FBF0' : '#3DDC84' }}
              />
            ))}
            <span className="text-xs ml-2" style={{ color: '#8A8D91' }}>this month</span>
          </div>
        </Card>

        {/* Pending requests */}
        <Card className="p-5 flex-1 min-w-[220px]">
          <p className="text-sm mb-3" style={{ color: '#8A8D91' }}>Pending requests</p>
          <p className="font-display text-2xl font-semibold mb-3" style={{ color: '#16181C' }}>{pendingRequests}</p>
          {pendingRequests > 0 ? (
            <p className="text-xs" style={{ color: '#854F0B' }}>
              {pendingAdvances > 0 && `${pendingAdvances} advance${pendingAdvances > 1 ? 's' : ''}`}
              {pendingRefunds > 0 && `${pendingAdvances > 0 ? ', ' : ''}${pendingRefunds} refund${pendingRefunds > 1 ? 's' : ''}`}
              {pendingLeaves > 0 && `${pendingAdvances + pendingRefunds > 0 ? ', ' : ''}${pendingLeaves} leave`}
            </p>
          ) : (
            <p className="text-xs" style={{ color: '#8A8D91' }}>All clear</p>
          )}
        </Card>

        {/* Treasury — live balance pulled by TreasuryWidget in the panel below */}
        <Card className="p-5 flex-1 min-w-[220px]">
          <p className="text-sm mb-3" style={{ color: '#8A8D91' }}>Treasury</p>
          {employer.treasuryContractAddress ? (
            <>
              <p className="font-display text-sm font-semibold mb-1" style={{ color: '#1D9E75' }}>Connected</p>
              <p className="text-xs truncate" style={{ fontFamily: 'var(--font-jbmono)', color: '#8A8D91' }}>
                {employer.treasuryContractAddress.slice(0, 6)}…{employer.treasuryContractAddress.slice(-4)}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-base font-semibold mb-1" style={{ color: '#854F0B' }}>Not set up</p>
              <p className="text-xs" style={{ color: '#8A8D91' }}>Use the panel below to connect</p>
            </>
          )}
        </Card>
      </div>

      {/* Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display text-base font-semibold">Treasury utilisation</h3>
            <span
              className="text-xs px-3 py-1.5 rounded-full"
              style={{ background: '#F4F3EE', color: '#8A8D91' }}
            >
              This year
            </span>
          </div>
          <p className="text-sm mb-5" style={{ color: '#8A8D91' }}>Daily salary releases</p>
          <Bars count={activeCount} />
        </Card>

        <TreasuryWidget treasuryContractAddress={employer.treasuryContractAddress} />
      </div>

      {/* Recent advances */}
      <Card className="overflow-hidden">
        <div
          className="flex items-center justify-between p-5 border-b"
          style={{ borderColor: '#ECEBE6' }}
        >
          <h3 className="font-display text-base font-semibold">Recent advance requests</h3>
          <a href="/inbox" className="text-sm font-medium" style={{ color: '#0B3D20' }}>View all</a>
        </div>

        {recentAdvances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-5">
            <p className="text-sm" style={{ color: '#8A8D91' }}>No advance requests yet</p>
          </div>
        ) : (
          recentAdvances.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-4 p-4 ${i > 0 ? 'border-t' : ''}`}
              style={{ borderColor: '#ECEBE6' }}
            >
              <Avatar initials={(r.employee.firstName[0] ?? '') + (r.employee.lastName[0] ?? '')} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-medium text-sm">{r.employee.firstName} {r.employee.lastName}</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-md"
                    style={{ background: '#FEF3DD', color: '#854F0B' }}
                  >
                    Advance
                  </span>
                </div>
                <p className="text-sm truncate" style={{ color: '#8A8D91' }}>{r.reason}</p>
              </div>
              <span className="font-medium text-sm whitespace-nowrap">{formatAmount(r.amount)}</span>
              <StatusPill status={r.status} />
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
