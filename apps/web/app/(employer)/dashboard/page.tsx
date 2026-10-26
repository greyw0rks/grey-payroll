import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getEmployer, getCompanyOverview } from '@/lib/company-data'
import { formatMoney } from '@/lib/money'
import { TreasuryWidget } from '@/components/employer/TreasuryWidget'
import { CopyInvite } from '@/components/ui/CopyInvite'

export default async function EmployerDashboardPage() {
  const employer = await getEmployer()
  if (!employer) redirect('/register/employer')
  const overview = await getCompanyOverview(employer.id, employer.timezone)
  const invites = overview.employees.filter(employee => employee.status === 'PENDING')
  const checkedInIds = new Set(overview.checkedIn.map(checkIn => checkIn.employeeId))
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: employer.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return <div className="dashboard-stack">
    <div className="page-heading"><div><h1>Company overview</h1><p>{date} · {employer.timezone}</p></div><Link className="grey-button grey-button-primary" href="/staff">Add an employee <span aria-hidden="true">+</span></Link></div>
    <section className="team-summary" aria-label="Today's employee statistics"><dl>
      <div><dt>Active employees</dt><dd>{overview.activeCount}</dd></div>
      <div><dt>At work today</dt><dd>{overview.atWorkCount}</dd></div>
      <div><dt>On leave</dt><dd>{overview.onLeaveCount}</dd></div>
      <div><dt>Yet to check in</dt><dd>{overview.awaitingCheckInCount}</dd></div>
    </dl><div className="summary-footer"><span><span className="status-dot" />Attendance for your company’s current day</span><Link href="/staff">{overview.invitedCount} awaiting signup</Link></div></section>
    <div className="dashboard-columns">
      <section className="grey-panel"><div className="panel-heading"><div><h2>Today’s team</h2><p>Attendance across {employer.companyName}.</p></div><Link className="text-link" href="/staff">View employees</Link></div>
        {overview.activeCount === 0 ? <div className="empty-state"><h3>Your team starts here</h3><p>Add an employee and share their invitation code to welcome them into your company.</p><Link className="grey-button" href="/staff">Add your first employee</Link></div> : <div className="table-scroll"><table className="grey-table"><thead><tr><th>Employee</th><th>Job title</th><th>Today</th></tr></thead><tbody>{overview.employees.filter(employee => employee.status === 'ACTIVE').slice(0, 6).map(employee => <tr key={employee.id}><td><Link className="employee-name" href={`/staff/${employee.id}`}><span className="employee-avatar" aria-hidden="true">{employee.firstName[0]}{employee.lastName[0]}</span>{employee.firstName} {employee.lastName}</Link></td><td>{employee.jobTitle}</td><td><span className={`grey-badge ${overview.onLeaveIds.includes(employee.id) ? 'badge-neutral' : checkedInIds.has(employee.id) ? 'badge-success' : 'badge-neutral'}`}>{overview.onLeaveIds.includes(employee.id) ? 'On leave' : checkedInIds.has(employee.id) ? 'Checked in' : 'Not checked in'}</span></td></tr>)}</tbody></table></div>}
      </section>
      <TreasuryWidget />
    </div>
    <div className="dashboard-columns">
      <section className="grey-panel"><div className="panel-heading"><div><h2>Requests to review</h2><p>Leave, refunds and advances from your team.</p></div><Link className="text-link" href="/inbox">Open inbox</Link></div>
        {overview.requests.length === 0 ? <div className="empty-state compact"><h3>You’re all caught up</h3><p>New employee requests will appear here for your review.</p></div> : <ul className="request-list">{overview.requests.map(request => <li key={request.id}><div><span className="request-person">{request.name} <span className="request-kind">{request.kind}</span></span><p>{request.detail}</p></div><span className="request-amount">{request.amount ? formatMoney(request.amount, request.currency) : 'Pending review'}</span></li>)}</ul>}
      </section>
      <section className="grey-panel"><div className="panel-heading"><div><h2>Company invitations</h2><p>Codes give employees access to your company.</p></div></div>
        {invites.length === 0 ? <div className="empty-state compact"><p>Invitations appear after you add an employee.</p><Link className="text-link" href="/staff">Invite an employee</Link></div> : <ul className="invitation-list">{invites.slice(0, 4).map(employee => <li key={employee.id}><div><strong>{employee.firstName} {employee.lastName}</strong><p>{employee.inviteExpiry && employee.inviteExpiry < new Date() ? 'Invitation expired' : 'Waiting to join'}</p><code>{employee.inviteCode || 'Code unavailable'}</code></div>{employee.inviteCode && (!employee.inviteExpiry || employee.inviteExpiry > new Date()) ? <CopyInvite code={employee.inviteCode} /> : null}</li>)}</ul>}
      </section>
    </div>
    <section className="payroll-summary"><div><h2>Verified Arc payroll this month</h2><p>{overview.releaseCount} salary records matched to finalized Arc receipts</p></div><div className="settled-amount"><strong>{formatMoney(overview.settledUsdc)}</strong></div><Link href="/arc-payroll" className="grey-button">Open Arc payroll</Link></section>
  </div>
}
