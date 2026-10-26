import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@grey/db'
import { getEmployee } from '@/lib/company-data'
import { getCompanyDate } from '@/lib/checkin'
import { formatMoney } from '@/lib/money'
import { CheckInAction } from '@/components/employee/CheckInAction'
import { WalletBalance } from '@/components/employee/WalletBalance'

export default async function EmployeeHomePage() {
  const employee = await getEmployee()
  if (!employee) redirect('/register/employee')
  const today = getCompanyDate(new Date(), employee.employer.timezone)
  const monthStart = new Date(today); monthStart.setUTCDate(1)
  const [checkIns, releases, leaves, refunds] = await Promise.all([
    prisma.checkIn.findMany({ where: { employeeId: employee.id, date: { gte: monthStart }, status: { in: ['ON_TIME', 'LATE'] } }, orderBy: { date: 'desc' } }),
    prisma.salaryRelease.findMany({ where: { employeeId: employee.id, arcPaymentItem: { intent: { status: 'CONFIRMED', verifiedAt: { gte: monthStart } } } } }),
    prisma.leaveRequest.findMany({ where: { employeeId: employee.id, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } } }),
    prisma.refundRequest.findMany({ where: { employeeId: employee.id }, include: { arcPaymentItem: { select: { intent: { select: { status: true } } } } }, orderBy: { createdAt: 'desc' }, take: 3 }),
  ])
  const todayCheckIn = checkIns.find(checkIn => checkIn.date.getTime() === today.getTime())
  const earnings = checkIns.reduce((sum, checkIn) => sum + BigInt(checkIn.amount || '0'), 0n)
  const paid = releases.reduce((sum, release) => sum + BigInt(release.amount), 0n)
  return <div className="dashboard-stack employee-dashboard">
    <div className="page-heading"><div><h1>Hello, {employee.firstName}</h1><p>{employee.jobTitle} at {employee.employer.companyName}</p></div><Link className="grey-button" href="/my-requests?kind=leave">Request leave</Link></div>
    <div className="employee-top-grid"><WalletBalance walletAddress={employee.walletAddress} chainId={employee.employer.arcChainId} currency={employee.currency} /><section className="grey-panel attendance-panel"><h2>Today’s check-in</h2><p>{new Intl.DateTimeFormat('en-GB', { timeZone: employee.employer.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p><div className="attendance-window"><span>Check-in window</span><strong>{employee.employer.checkInWindowStart} – {employee.employer.checkInWindowEnd}</strong><span>{employee.employer.timezone}</span></div><CheckInAction employeeId={employee.id} checkedIn={Boolean(todayCheckIn)} onLeave={leaves.length > 0} /></section></div>
    <section className="team-summary" aria-label="My salary summary"><dl><div><dt>Recorded earnings this month</dt><dd className="salary-stat">{formatMoney(earnings, employee.currency)}</dd></div><div><dt>Paid on Arc this month</dt><dd className="salary-stat">{formatMoney(paid, employee.currency)}</dd></div><div><dt>Daily rate</dt><dd className="salary-stat">{formatMoney(employee.dailyRate, employee.currency)}</dd></div><div><dt>Days checked in</dt><dd>{checkIns.length}<span className="stat-denominator"> / {employee.employer.workingDaysPerMonth}</span></dd></div></dl><div className="summary-footer"><span>Recorded earnings reflect attendance. Paid totals reflect server-verified Arc receipts.</span><Link href="/salary">View salary</Link></div></section>
    <div className="dashboard-columns"><section className="grey-panel"><div className="panel-heading"><div><h2>My refunds</h2><p>Expense requests sent to your employer.</p></div><Link className="text-link" href="/my-requests?kind=refund">Request a refund</Link></div>{refunds.length ? <ul className="request-list">{refunds.map(refund => <li key={refund.id}><div><strong>{refund.category}</strong><p>{refund.description || 'Expense refund'}</p><span className={`grey-badge ${refund.status === 'APPROVED' ? 'badge-success' : 'badge-neutral'}`}>{refund.arcPaymentItem?.intent.status === 'CONFIRMED' ? 'Paid on Arc' : !refund.arcPaymentItem && refund.txHash ? 'Historical payment' : refund.status === 'APPROVED' ? 'Approved · awaiting payment' : refund.status.charAt(0) + refund.status.slice(1).toLowerCase()}</span></div><span className="request-amount">{formatMoney(refund.amount, refund.currency)}</span></li>)}</ul> : <div className="empty-state compact"><p>Submit an expense refund to start tracking it here.</p></div>}</section><section className="grey-panel"><div className="panel-heading"><div><h2>Recent attendance</h2><p>Your check-ins for this month.</p></div></div>{checkIns.length ? <ul className="attendance-list">{checkIns.slice(0, 5).map(checkIn => <li key={checkIn.id}><span>{new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(checkIn.date)}</span><span className={`grey-badge ${checkIn.status === 'ON_TIME' ? 'badge-success' : 'badge-neutral'}`}>{checkIn.status === 'ON_TIME' ? 'On time' : 'Late'}</span></li>)}</ul> : <div className="empty-state compact"><p>Your daily check-ins will appear here once you record attendance.</p></div>}</section></div>
  </div>
}
