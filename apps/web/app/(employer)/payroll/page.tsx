import { auth } from '@clerk/nextjs/server'
import { prisma } from '@grey/db'
import { redirect } from 'next/navigation'

function formatAmount(amount: string) {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' USDC'
}

function truncateTx(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

export default async function PayrollPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId } })
  if (!employer) redirect('/register/employer')

  const releases = await prisma.salaryRelease.findMany({
    where: { employee: { employerId: employer.id } },
    include: {
      employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
    >
      <div
        className="flex items-center justify-between p-5 border-b flex-wrap gap-3"
        style={{ borderColor: '#ECEBE6' }}
      >
        <h3 className="font-display text-base font-semibold">Payroll history</h3>
        <span className="text-sm" style={{ color: '#8A8D91' }}>
          {releases.length} release{releases.length !== 1 ? 's' : ''}
        </span>
      </div>

      {releases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-xl"
            style={{ background: '#F4F3EE' }}
          >
            📋
          </div>
          <p className="font-medium text-sm" style={{ color: '#16181C' }}>No payroll releases yet</p>
          <p className="text-sm mt-1 text-center" style={{ color: '#8A8D91' }}>
            Salary is released daily when employees check in.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: '#8A8D91' }}>
                {['Employee', 'Date', 'Amount', 'Tx hash'].map(h => (
                  <th key={h} className="px-5 py-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {releases.map((r, i) => (
                <tr key={r.id} className={`${i > 0 ? 'border-t' : ''}`} style={{ borderColor: '#ECEBE6' }}>
                  <td className="px-5 py-3.5 font-medium whitespace-nowrap">
                    {r.employee.firstName} {r.employee.lastName}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: '#8A8D91' }}>
                    {new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap font-medium">
                    {formatAmount(r.amount)}
                  </td>
                  <td className="px-5 py-3.5">
                    <a
                      href={`https://sepolia.celoscan.io/tx/${r.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs hover:underline"
                      style={{ fontFamily: 'var(--font-jbmono)', color: '#1D9E75' }}
                    >
                      {truncateTx(r.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
