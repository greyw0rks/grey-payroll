import { auth } from '@clerk/nextjs/server'
import { prisma } from '@grey/db'
import { redirect } from 'next/navigation'
import { getArcChain } from '@grey/config/arc'
import { formatMoney } from '@/lib/money'



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
      employee: { select: { firstName: true, lastName: true, currency: true } },
      arcPaymentItem: { select: { intent: { select: { status: true, txHash: true, verifiedAt: true, chainId: true } } } },
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
          </div>
          <p className="font-medium text-sm" style={{ color: '#16181C' }}>No payroll releases yet</p>
          <p className="text-sm mt-1 text-center" style={{ color: '#8A8D91' }}>
            Review and approve salary payments in Arc payroll.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: '#8A8D91' }}>
                {['Employee', 'Attendance date', 'Amount', 'Settlement', 'Receipt'].map(h => (
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
                    {formatMoney(r.amount, r.arcPaymentItem ? 'USDC' : r.employee.currency)}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">{r.arcPaymentItem?.intent.status === 'CONFIRMED' ? 'Verified on Arc' : 'Historical record'}</td>
                  <td className="px-5 py-3.5">
                    {r.arcPaymentItem?.intent.status === 'CONFIRMED' ? <a className="text-link text-xs" href={`${getArcChain(r.arcPaymentItem.intent.chainId).blockExplorers.default.url}/tx/${r.arcPaymentItem.intent.txHash}`} target="_blank" rel="noopener noreferrer">{truncateTx(r.txHash)}</a> : <span className="text-xs" style={{ fontFamily: 'var(--font-jbmono)' }}>{truncateTx(r.txHash)}</span>}
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
