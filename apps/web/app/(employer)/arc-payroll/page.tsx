import { redirect } from 'next/navigation'
import { getEmployer } from '@/lib/company-data'
import { listCompanyPayments } from '@/lib/arc-payments'
import { CompanyPayments } from '@/components/employer/CompanyPayments'
import { isArcChainId } from '@grey/config/arc'
export default async function ArcPayrollPage() {
  const employer = await getEmployer()
  if (!employer) redirect('/register')
  const initial = await listCompanyPayments(employer.id)
  return <div className="dashboard-stack"><div className="page-heading"><div><h1>Arc payroll</h1><p>Prepare and record verified salary and refund payments for {employer.companyName}.</p></div></div><CompanyPayments initial={initial} treasuryLinked={Boolean(employer.arcTreasuryAddress && employer.arcEmployerWallet && isArcChainId(employer.arcChainId))} /></div>
}
